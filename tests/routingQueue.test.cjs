const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function loadRoutingQueue() {
  const source = fs.readFileSync('src/renderer/plugins/player/routingQueue.ts', 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports, module: { exports }, require })
  return exports
}

function sinkTarget(calls, name, gate) {
  return {
    async setSinkId(id) {
      calls.push([name, 'start', id])
      if (gate) await gate.promise
      calls.push([name, 'done', id])
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise(_resolve => { resolve = _resolve })
  return { promise, resolve }
}

test('output sink is applied to the final element for each routing mode', async() => {
  const { applyOutputSink } = loadRoutingQueue()
  const calls = []
  const audio = sinkTarget(calls, 'audio')
  const pipe = sinkTarget(calls, 'pipe')

  await applyOutputSink({ captured: false, audio, outputPipe: pipe }, 'device-a')
  await applyOutputSink({ captured: true, audio, outputPipe: pipe }, '')

  assert.deepEqual(calls, [
    ['audio', 'start', 'device-a'],
    ['audio', 'done', 'device-a'],
    ['pipe', 'start', 'default'],
    ['pipe', 'done', 'default'],
  ])
})

test('routing queue serializes sink changes so an older request cannot finish after a newer one', async() => {
  const { createRoutingQueue } = loadRoutingQueue()
  const queue = createRoutingQueue()
  const gate = deferred()
  const calls = []
  const first = queue.enqueue(() => sinkTarget(calls, 'pipe', gate).setSinkId('device-a'))
  const second = queue.enqueue(() => sinkTarget(calls, 'pipe').setSinkId('device-b'))

  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [['pipe', 'start', 'device-a']])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(calls, [
    ['pipe', 'start', 'device-a'],
    ['pipe', 'done', 'device-a'],
    ['pipe', 'start', 'device-b'],
    ['pipe', 'done', 'device-b'],
  ])
})

test('captured mode refuses to bind a missing output pipe and can retry when it is ready', async() => {
  const { applyOutputSink } = loadRoutingQueue()
  const state = { captured: true, audio: sinkTarget([], 'audio'), outputPipe: null }
  await assert.rejects(
    applyOutputSink(state, 'device-a'),
    /output pipe is not ready/,
  )

  const calls = []
  state.outputPipe = sinkTarget(calls, 'pipe')
  await applyOutputSink(state, 'device-a')
  assert.deepEqual(calls, [
    ['pipe', 'start', 'device-a'],
    ['pipe', 'done', 'device-a'],
  ])
})

test('a failed sink binding leaves the previous route references untouched', async() => {
  const { applyOutputSink } = loadRoutingQueue()
  const audio = {
    async setSinkId() {
      throw new Error('device rejected')
    },
  }
  const state = { captured: false, audio, outputPipe: null }
  await assert.rejects(applyOutputSink(state, 'device-a'), /device rejected/)
  assert.equal(state.audio, audio)
  assert.equal(state.outputPipe, null)
  assert.equal(state.captured, false)
})

test('latest routing requests skip stale tasks that have not started', async() => {
  const { createRoutingQueue } = loadRoutingQueue()
  const queue = createRoutingQueue()
  const gate = deferred()
  const calls = []
  const first = queue.enqueue(() => sinkTarget(calls, 'pipe', gate).setSinkId('device-a'))
  const stale = queue.enqueueLatest('sink', () => sinkTarget(calls, 'pipe').setSinkId('device-b'))
  const latest = queue.enqueueLatest('sink', () => sinkTarget(calls, 'pipe').setSinkId('device-c'))

  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [['pipe', 'start', 'device-a']])
  gate.resolve()
  await Promise.all([first, stale, latest])
  assert.deepEqual(calls, [
    ['pipe', 'start', 'device-a'],
    ['pipe', 'done', 'device-a'],
    ['pipe', 'start', 'device-c'],
    ['pipe', 'done', 'device-c'],
  ])
})
