const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function loadPlayer() {
  const source = fs.readFileSync('src/renderer/plugins/player/index.ts', 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/import\.meta\.url/g, "'file:///lx-music/player.ts'")
  const appSetting = {
    'player.playEngine': 'electron',
    'player.mediaDeviceId': 'device-a',
    'player.audioVisualization': false,
    'player.vst3.enabled': false,
    'player.soundEffect.convolution.fileName': '',
    'player.soundEffect.pitchShifter.playbackRate': 1,
    'player.soundEffect.panner.enable': false,
    'player.soundEffect.convolution.mainGain': 0,
    'player.soundEffect.convolution.sendGain': 0,
    'player.isMediaDeviceRemovedStopPlay': false,
    'player.isMaxOutputChannelCount': false,
  }
  for (const frequency of [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
    appSetting[`player.soundEffect.biquadFilter.hz${frequency}`] = 0
  }
  const state = { failSink: false, failMediaPlayOnce: false, watches: [], audio: [], contexts: [], metadataRequests: [] }
  const parameter = () => ({ value: 0 })
  const audioNode = () => ({ connect() {}, disconnect() {} })

  class FakeAudio {
    constructor() {
      this.paused = true
      this.src = ''
      this.currentTime = 0
      this.volume = 1
      this.muted = false
      this.defaultPlaybackRate = 1
      this.playbackRate = 1
      this.preservesPitch = true
      this.loop = false
      this.autoplay = false
      this.preload = ''
      this.crossOrigin = ''
      this.srcObject = null
      this.sinkId = 'default'
      this.sinkCalls = []
      this.listeners = new Map()
      state.audio.push(this)
    }

    addEventListener(event, listener) {
      this.listeners.set(event, listener)
    }

    removeEventListener(event, listener) {
      if (this.listeners.get(event) === listener) this.listeners.delete(event)
    }

    load() { if (this.src) queueMicrotask(() => this.listeners.get('loadedmetadata')?.()) }

    getAttribute(attribute) { return attribute === 'src' ? this.src : null }

    removeAttribute(attribute) {
      if (attribute === 'src') this.src = ''
    }

    play() {
      if (state.failMediaPlayOnce && !this.srcObject) {
        state.failMediaPlayOnce = false
        return Promise.reject(new Error('media play rejected'))
      }
      this.paused = false
      return Promise.resolve()
    }

    pause() {
      this.paused = true
    }

    setSinkId(id) {
      this.sinkCalls.push(id)
      if (state.failSink) return Promise.reject(new Error('sink rejected'))
      this.sinkId = id
      return Promise.resolve()
    }
  }

  class FakeAudioContext {
    constructor(options) {
      this.sampleRate = options?.sampleRate ?? 48000
      state.contexts.push(this)
      this.state = 'running'
      this.destination = { channelCount: 2, maxChannelCount: 8, channelCountMode: 'explicit' }
      this.audioWorklet = { addModule: async() => {} }
    }

    createAnalyser() { return Object.assign(audioNode(), { fftSize: 0 }) }
    createBiquadFilter() { return Object.assign(audioNode(), { type: '', frequency: parameter(), Q: parameter(), gain: parameter() }) }
    createGain() { return Object.assign(audioNode(), { gain: parameter() }) }
    createDynamicsCompressor() { return Object.assign(audioNode(), { threshold: parameter(), ratio: parameter() }) }
    createConvolver() { return Object.assign(audioNode(), { buffer: null }) }
    createPanner() { return Object.assign(audioNode(), { positionX: parameter(), positionY: parameter(), positionZ: parameter() }) }
    createMediaElementSource() { return audioNode() }
    createMediaStreamDestination() { return Object.assign(audioNode(), { stream: {} }) }
    resume() { return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
  }

  const appEvent = { on() {}, off() {}, pause() {}, stop() {}, playerDeviceChanged() {} }
  const context = {
    console,
    Promise,
    URL,
    Float32Array,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: { Audio: FakeAudio, AudioContext: FakeAudioContext, app_event: appEvent, lx: { isPlayedStop: false } },
    document: { addEventListener() {}, removeEventListener() {} },
  }
  const noopPlayer = new Proxy({}, { get: (_, name) => name === 'isEmpty' ? () => true : async() => {} })
  const modules = {
    '@renderer/store/setting': { appSetting },
    './mpv': noopPlayer,
    './mpvVideo': noopPlayer,
    './audirvana': noopPlayer,
    '@renderer/store/player/biliVideo': { isBiliVideoActive: () => false },
    '@common/utils/vueTools': {
      watch: (source, callback) => state.watches.push({ source, callback }),
      onBeforeUnmount() {},
    },
    './sourceSampleRate': {
      readSourceSampleRate: (src, signal) => new Promise(resolve => state.metadataRequests.push({ src, signal, resolve })),
    },
    './vst3': {
      createVst3Node: async() => null,
      configureVst3Audio: async() => {},
      closeVst3Audio: async() => {},
      prepareVst3Audio: async() => true,
      resetVst3Audio: () => {},
      restoreVst3Node: () => {},
      vst3Runtime: { error: null },
      cleanVst3Error: error => error,
    },
    '@renderer/core/player/action': { pause() {} },
  }
  const routingSource = fs.readFileSync('src/renderer/plugins/player/routingQueue.ts', 'utf8')
  const routingCompiled = ts.transpileModule(routingSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const routingModule = { exports: {} }
  vm.runInNewContext(routingCompiled, { module: routingModule, exports: routingModule.exports, require })
  modules['./routingQueue'] = routingModule.exports

  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    ...context,
    module,
    exports: module.exports,
    require: name => modules[name],
  })
  return { player: module.exports, appSetting, state, runtime: modules['./vst3'].vst3Runtime }
}

test('a VST routing failure does not poison subsequent resource loading', async() => {
  const { player, appSetting, state } = loadPlayer()
  player.createAudio()
  appSetting['player.audioVisualization'] = true
  state.failSink = true
  state.watches[0].callback()
  await player.setResource('track://after-routing-failure')
  assert.equal(state.audio[0].src, 'track://after-routing-failure')
  state.failSink = false
  await player.setMediaDeviceId('device-a')
  player.setPlay()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(state.audio.some(item => item.src === 'track://after-routing-failure' && !item.paused))
  state.metadataRequests[0].resolve(null)
  await new Promise(resolve => setImmediate(resolve))
})

test('source sample rate ignores stale song probes and clears on stop', async() => {
  const { player, state, runtime } = loadPlayer()
  player.createAudio()
  await player.setResource('https://example.com/first.flac')
  await player.setResource('https://example.com/second.flac')
  assert.equal(state.metadataRequests[0].signal.aborted, true)
  state.metadataRequests[1].resolve(96000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.sourceSampleRate, 96000)
  state.metadataRequests[0].resolve(44100)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.sourceSampleRate, 96000)
  assert.equal(runtime.readingSourceRate, false)
  await player.setStop()
  assert.equal(runtime.sourceSampleRate, 0)
})

test('live sample rate change keeps position and closes the old context', async() => {
  const { player, appSetting, state } = loadPlayer()
  player.createAudio()
  appSetting['player.audioVisualization'] = true
  await player.applyAudioRoutingNow()
  const oldContext = player.getAudioContext()
  const oldAudio = state.audio.find(item => !item.srcObject && item !== state.audio[0])
  oldAudio.src = 'track://current'
  oldAudio.currentTime = 42
  await oldAudio.play()
  appSetting['player.audioSampleRate'] = 96000
  await state.watches.find(watch => watch.source() === 96000).callback()
  assert.equal(player.getAudioContext().sampleRate, 96000)
  assert.equal(player.getCurrentTime(), 42)
  assert.equal(oldContext.state, 'closed')
  assert.equal(oldAudio.src, '')
  assert.ok(state.audio.some(item => item.src === 'track://current' && !item.paused))
})

test('failed live sample rate change restores old context and playback', async() => {
  const { player, appSetting, state } = loadPlayer()
  player.createAudio()
  appSetting['player.audioVisualization'] = true
  await player.applyAudioRoutingNow()
  const oldContext = player.getAudioContext()
  const oldAudio = state.audio.find(item => !item.srcObject && item !== state.audio[0])
  oldAudio.src = 'track://current'
  oldAudio.currentTime = 17
  await oldAudio.play()
  state.failSink = true
  appSetting['player.audioSampleRate'] = 44100
  await state.watches.find(watch => watch.source() === 44100).callback()
  assert.equal(player.getAudioContext(), oldContext)
  assert.equal(oldContext.state, 'running')
  assert.equal(state.contexts.at(-1).state, 'closed')
  assert.equal(oldAudio.paused, false)
  assert.equal(player.getCurrentTime(), 17)
})

test('a rejected sink keeps the old audio source and playback state', async() => {
  const { player, appSetting, state } = loadPlayer()
  player.createAudio()
  const oldAudio = state.audio[0]
  oldAudio.src = 'track://current'
  oldAudio.currentTime = 42
  oldAudio.volume = 0.37
  oldAudio.muted = true
  oldAudio.playbackRate = 1.25
  oldAudio.loop = true
  await oldAudio.play()

  state.failSink = true
  appSetting['player.audioVisualization'] = true
  await assert.rejects(player.applyAudioRoutingNow(), /sink rejected/)

  assert.equal(state.audio[0], oldAudio)
  assert.equal(oldAudio.src, 'track://current')
  assert.equal(oldAudio.currentTime, 42)
  assert.equal(oldAudio.volume, 0.37)
  assert.equal(oldAudio.muted, true)
  assert.equal(oldAudio.playbackRate, 1.25)
  assert.equal(oldAudio.loop, true)
  assert.equal(oldAudio.paused, false)
})

test('a replacement play failure rolls back to the old audio element', async() => {
  const { player, appSetting, state } = loadPlayer()
  player.createAudio()
  const oldAudio = state.audio[0]
  oldAudio.src = 'track://current'
  oldAudio.currentTime = 17
  await oldAudio.play()

  state.failMediaPlayOnce = true
  appSetting['player.audioVisualization'] = true
  await assert.rejects(player.applyAudioRoutingNow(), /media play rejected/)

  assert.equal(state.audio[0], oldAudio)
  assert.equal(oldAudio.src, 'track://current')
  assert.equal(oldAudio.currentTime, 17)
  assert.equal(oldAudio.paused, false)
})

test('visualization switches to outputPipe and disabling it switches back to audio', async() => {
  const { player, appSetting, state } = loadPlayer()
  player.createAudio()
  const oldAudio = state.audio[0]
  oldAudio.src = 'track://current'
  await oldAudio.play()

  appSetting['player.audioVisualization'] = true
  await player.applyAudioRoutingNow()
  const capturedAudio = state.audio[1]
  const outputPipe = state.audio[2]
  assert.deepEqual(capturedAudio.sinkCalls, [])
  assert.deepEqual(outputPipe.sinkCalls, ['device-a'])

  appSetting['player.audioVisualization'] = false
  await player.applyAudioRoutingNow()
  const transparentAudio = state.audio[3]
  assert.deepEqual(transparentAudio.sinkCalls, ['device-a'])
  assert.deepEqual(outputPipe.sinkCalls, ['device-a'])
  assert.equal(oldAudio.paused, true)
})
