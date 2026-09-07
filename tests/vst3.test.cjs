const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { startHost, defaultDirectories, findPlugins } = require('../native/vst3-host/client.cjs')
const { Vst3Chain } = require('../native/vst3-host/chain.cjs')
const { randomUUID } = require('node:crypto')

test('default directories are platform-specific', () => {
  assert.deepEqual(defaultDirectories('darwin', '/Users/test', {}), ['/Library/Audio/Plug-Ins/VST3', '/Users/test/Library/Audio/Plug-Ins/VST3'])
  assert.deepEqual(defaultDirectories('linux', '/home/test', {}), ['/home/test/.vst3', '/usr/lib/vst3', '/usr/local/lib/vst3'])
  assert.deepEqual(defaultDirectories('win32', '', { CommonProgramFiles: 'D:\\Common', LOCALAPPDATA: 'D:\\Local' }), ['D:\\Common\\VST3', 'D:\\Local\\Programs\\Common\\VST3'])
})

test('scanner deduplicates bundles, preserves missing paths and stops at bundle boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-vst3-test-'))
  try {
    await fs.mkdir(path.join(root, 'Effect.vst3', 'Nested.vst3'), { recursive: true })
    await fs.writeFile(path.join(root, 'Old.vst2'), '')
    const missing = path.join(root, 'missing')
    const directories = [root, root, missing]
    const result = await findPlugins(directories)
    assert.equal(result.paths.length, 1)
    assert.equal(path.basename(result.paths[0]), 'Effect.vst3')
    assert.equal(result.warnings[0].path, missing)
    assert.deepEqual(directories, [root, root, missing])
    await assert.rejects(findPlugins(['relative']), /absolute/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

const executable = path.resolve('native/vst3-host/target/debug', process.platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host')
test('native errors are recoverable; process exit rejects further requests', async () => {
  const host = await startHost(executable)
  try {
    await assert.rejects(host.request({ command: 'save_state' }), /no plugin/)
    await assert.rejects(host.request({ command: 'load', path: '/missing.vst3', sample_rate: 0, block_size: 512 }), /sample rate/)
    assert.equal(await host.request({ command: 'unload' }), null)
    process.kill(host.pid)
    await assert.rejects(host.request({ command: 'parameters' }), /exited|disconnect|closed|EPIPE|ECONNRESET/)
  } finally { host.close() }
})

test('real plugin loads, processes PCM and round-trips its state', { skip: !process.env.LX_VST3_TEST_PLUGIN }, async () => {
  const host = await startHost(executable)
  try {
    const load = { command: 'load', path: process.env.LX_VST3_TEST_PLUGIN, sample_rate: 48000, block_size: 512 }
    const info = await host.request(load)
    assert.ok(Number.isInteger(info.latency_samples))
    const parameters = await host.request({ command: 'parameters' })
    const parameter = parameters.find(p => !p.is_read_only && p.can_automate)
    if (parameter) await host.request({ command: 'set_parameter', id: parameter.id, value: parameter.value })
    if (process.env.LX_VST3_TEST_EDITOR === '1') {
      await host.request({ command: 'editor', open: true })
      await new Promise(resolve => setTimeout(resolve, 500))
      await host.request({ command: 'editor', open: false })
    }
    const saved = await host.request({ command: 'save_state' })
    assert.ok(saved.state.length > 0)
    await host.request({ command: 'unload' })
    await host.request({ ...load, state: saved.state })
    const payload = Buffer.alloc(512 * 2 * 4)
    const processed = await host.request({ command: 'process_binary', frames: 512 }, payload)
    assert.equal(processed.result.binary_bytes, payload.length)
    const outputBytes = new Uint8Array(processed.payload.length)
    outputBytes.set(processed.payload)
    const outputs = [
      new Float32Array(outputBytes.buffer, 0, 512),
      new Float32Array(outputBytes.buffer, 512 * 4, 512),
    ]
    assert.deepEqual(outputs.map(channel => channel.length), [512, 512])
    assert.ok(outputs.flatMap(channel => [...channel]).every(Number.isFinite))
  } finally { host.close() }
})

test('chain reuses one host, preserves failed-load state and recovers a crashed helper', { skip: !process.env.LX_VST3_TEST_PLUGIN }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-vst3-chain-'))
  const chain = new Vst3Chain(executable, root)
  const plugin = process.env.LX_VST3_TEST_PLUGIN
  const entries = [0, 1].map(() => ({ id: randomUUID(), path: plugin, enabled: true }))
  const allowed = new Set([plugin, '/missing.vst3'])
  try {
    await chain.configure(entries, 48000, allowed)
    const hosts = chain.slots.map(slot => slot.host)
    assert.equal(new Set(hosts.map(host => host.pid)).size, 1)
    await chain.configure([...entries].reverse(), 48000, allowed)
    assert.equal(new Set(chain.slots.map(slot => slot.host.pid)).size, 1)
    assert.equal(chain.slots[0].host.pid, hosts[0].pid)
    await assert.rejects(chain.configure([...entries, { id: randomUUID(), path: '/missing.vst3', enabled: true }], 48000, allowed))
    assert.deepEqual(chain.slots.map(slot => slot.id), entries.map(entry => entry.id).reverse())
    await chain.configure(entries.map(entry => ({ ...entry, enabled: false })), 48000, allowed)
    assert.equal(chain.slots.every(slot => slot.host === null), true)
    for (const entry of entries) assert.ok((await fs.stat(path.join(root, `${entry.id}.json`))).size > 0)
    const inputs = [Array(512).fill(0.25), Array(512).fill(-0.25)]
    assert.deepEqual((await chain.process(inputs)).outputs, inputs)
    await chain.configure(entries, 48000, allowed)
    const crashed = chain.slots[0].host
    process.kill(crashed.pid)
    await assert.rejects(crashed.request({ command: 'parameters', plugin_id: entries[0].id }))
    await chain.configure(entries, 48000, allowed)
    assert.notEqual(chain.slots[0].host.pid, crashed.pid)
    assert.equal((await chain.process(inputs)).outputs.length, 2)
    await assert.rejects(chain.process([[NaN], []]), /Invalid/)
    await assert.rejects(chain.configure([entries[0], entries[0]], 48000, allowed), /Invalid/)
  } finally {
    await chain.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
