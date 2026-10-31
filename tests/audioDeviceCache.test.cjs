const assert = require('node:assert/strict')
const { test } = require('node:test')
const { load } = require('./helpers/audioDeviceHarness.cjs')
const { createAudioDeviceCache } = load('src/main/utils/audioDeviceCache.ts')
const cacheable = rows => rows.length > 1

test('MPV cache shares probes, retries empty results and refreshes a populated catalog', async() => {
  const cache = createAudioDeviceCache()
  let count = 0
  const probe = async() => { count++; return count === 1 ? [] : ['auto', 'output-' + count] }
  assert.deepEqual(await cache.get('binary-a', false, probe, cacheable), [])
  const [first, same] = await Promise.all([cache.get('binary-a', false, probe, cacheable), cache.get('binary-a', false, probe, cacheable)])
  assert.deepEqual(first, ['auto', 'output-2'])
  assert.deepEqual(same, first)
  assert.equal(count, 2)
  assert.deepEqual(await cache.get('binary-a', true, probe, cacheable), ['auto', 'output-3'])
  assert.deepEqual(await cache.get('binary-b', false, probe, cacheable), ['auto', 'output-4'])
})

test('an older MPV probe cannot populate a refreshed binary catalog', async() => {
  const cache = createAudioDeviceCache()
  let finish
  const old = cache.get('binary-a', false, () => new Promise(resolve => { finish = resolve }), cacheable)
  assert.deepEqual(await cache.get('binary-a', true, async() => ['auto', 'new-output'], cacheable), ['auto', 'new-output'])
  finish(['auto', 'stale-output']); await old
  assert.deepEqual(await cache.get('binary-a', false, async() => { throw Error('must use fresh cache') }, cacheable), ['auto', 'new-output'])
})

test('force refresh is validated and passed through the renderer and main IPC endpoints', async() => {
  const ipc = []
  const renderer = load('src/renderer/plugins/player/mpv.ts', {
    electron: { ipcRenderer: { on() {} } },
    '@common/rendererIpc': { rendererInvoke: async(name, options) => { ipc.push({ name, options }); return [] } },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { mpv_listAudioDevices: 'list-outputs' } },
  })
  await renderer.listAudioDevices({ forceRefresh: true })
  assert.equal(ipc[0].options.forceRefresh, true)
  const handlers = new Map(); const probes = []
  const main = load('src/main/modules/winMain/rendererEvent/mpv.ts', {
    '@common/mainIpc': { mainHandle: (name, handler) => handlers.set(name, handler) },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { mpv_listAudioDevices: 'list-outputs' } },
    '@common/utils': { log: { info() {} } },
    '../mpvController': { MpvController: { listAudioDevices: async options => { probes.push(options); return [] } } },
  })
  main.default()
  await handlers.get('list-outputs')({ params: { forceRefresh: true } })
  await handlers.get('list-outputs')({ params: { forceRefresh: 'true' } })
  assert.equal(probes[0].forceRefresh, true)
  assert.equal(probes[1].forceRefresh, false)
})

test('MPV parsing keeps same-name hardware and full names with parentheses', () => {
  const { parseMpvAudioDevices } = load('src/common/utils/mpvDeviceList.ts')
  const rows = parseMpvAudioDevices("  'coreaudio/uid-a' (USB Output (Rear))\n  'avfoundation/uid-a' (USB Output (Rear))\n  'avfoundation/uid-b' (USB Output (Rear))", true)
  assert.equal(rows.length, 3)
  assert.equal(rows[1].id, 'avfoundation/uid-a')
  assert.equal(rows[2].id, 'avfoundation/uid-b')
  assert.equal(rows[1].name, 'USB Output (Rear)')
  const windows = parseMpvAudioDevices(" 'wasapi/one' (USB Output)\n 'wasapi/two' (USB Output)", false)
  assert.equal(windows.length, 3)
})

test('a rejected MPV probe can be retried', async() => {
  const cache = createAudioDeviceCache()
  await assert.rejects(cache.get('binary', false, async() => { throw Error('spawn failed') }, cacheable), /spawn failed/)
  assert.deepEqual(await cache.get('binary', false, async() => ['auto', 'restored'], cacheable), ['auto', 'restored'])
})
