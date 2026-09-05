const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function worklet() {
  let Processor
  const messages = []
  class AudioWorkletProcessor {
    constructor() { this.port = { postMessage: value => messages.push(value) } }
  }
  vm.runInNewContext(fs.readFileSync('src/renderer/plugins/player/vst3-worklet.js', 'utf8'), {
    AudioWorkletProcessor,
    registerProcessor: (_, value) => { Processor = value },
  })
  const processor = new Processor()
  const receive = data => processor.port.onmessage({ data })
  receive({ action: 'reset', epoch: 1, active: true })
  return { processor, messages, receive }
}

test('PCM bridge preserves sample order across wraparound with exactly 4096 frames latency', () => {
  const { processor, messages, receive } = worklet()
  for (let frame = 0; frame < 16384; frame += 128) {
    const input = Float32Array.from({ length: 128 }, (_, i) => (frame + i) / 16384)
    const output = [new Float32Array(128), new Float32Array(128)]
    processor.process([[input]], [output])
    for (let i = 0; i < 128; i++) {
      const expected = frame + i < 4096 ? 0 : (frame + i - 4096) / 16384
      assert.equal(output[0][i], expected)
      assert.equal(output[1][i], expected)
    }
    for (const request of messages.splice(0)) {
      assert.equal(request.action, 'process')
      receive({ epoch: request.epoch, sequence: request.sequence, outputs: request.inputs })
    }
  }
  assert.equal(processor.fault, false)
})

test('seek discards old-epoch replies; host stalls gap silently and never pause playback', () => {
  const { processor, messages, receive } = worklet()
  receive({ action: 'reset', epoch: 2, active: true })
  receive({ epoch: 1, sequence: 0, outputs: [Array(512).fill(1), Array(512).fill(1)] })
  // 4096-frame bridge delay plus a transient stall well under the miss limit: stay silent, keep playing.
  for (let frame = 0; frame < 4096 + 2048; frame += 128) {
    const output = [new Float32Array(128), new Float32Array(128)]
    processor.process([[new Float32Array(128)]], [output])
    assert.ok(output.every(channel => channel.every(sample => sample === 0)))
  }
  assert.equal(messages.filter(message => message.action === 'fault').length, 0)
  // Blocks start flowing again and audio resumes after the transient stall.
  let request = messages.find(message => message.action === 'process')
  receive({ epoch: request.epoch, sequence: request.sequence, outputs: request.inputs })
  const output = [new Float32Array(128), new Float32Array(128)]
  // Drain one full block so the tagged sample window comes due.
  for (let frame = 0; frame < 512; frame += 128) {
    processor.process([[new Float32Array(128)]], [output])
    request = messages.find(message => message.action === 'process' && !message.echoed)
    for (const message of messages.splice(0)) {
      if (message.action === 'process') {
        message.echoed = true
        receive({ epoch: message.epoch, sequence: message.sequence, outputs: message.inputs })
      }
    }
  }
  assert.equal(processor.fault, false)
  // Host stalls never pause playback here: a long busy stretch just stays silent until
  // dry passthrough resumes; only protocol corruption or a dead host faults.
  receive({ action: 'reset', epoch: 3, active: true })
  for (let frame = 0; frame < 4096 + 10 * 48000; frame += 128) {
    processor.process([[new Float32Array(128)]], [output])
    assert.ok(output.every(channel => channel.every(sample => sample === 0)))
  }
  assert.equal(messages.filter(message => message.action === 'fault').length, 0)
  assert.equal(processor.fault, false)
})

test('only the latest audio preparation may activate output; pause cancels a pending reset', async() => {
  const ts = require('typescript')
  const pending = []
  const exports = {}
  const source = fs.readFileSync('src/renderer/plugins/player/vst3.ts', 'utf8').replace('import.meta.url', '"file:///vst3.ts"')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === 'electron') return { ipcRenderer: { invoke: () => new Promise(resolve => pending.push(resolve)) } }
      if (name === '@common/utils/vueTools') return { shallowReactive: value => value }
      if (name === '@common/ipcNames') return { WIN_MAIN_RENDERER_EVENT_NAME: { vst3_reset: 'reset' } }
      if (name === '@renderer/store/setting') return { appSetting: { 'player.vst3.enabled': true } }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  const first = exports.prepareVst3Audio()
  await Promise.resolve()
  const second = exports.prepareVst3Audio()
  await Promise.resolve()
  assert.equal(pending.length, 2)
  pending.shift()()
  assert.equal(await first, false)
  pending.shift()()
  assert.equal(await second, true)
  const paused = exports.prepareVst3Audio()
  await Promise.resolve()
  exports.resetVst3Audio(false)
  pending.shift()()
  assert.equal(await paused, false)
})
