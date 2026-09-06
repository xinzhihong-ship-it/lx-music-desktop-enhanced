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
  const state = { failSink: false, failMediaPlayOnce: false, watches: [], audio: [] }
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

    load() {}

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
    constructor() {
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
  }

  const appEvent = { on() {}, off() {}, pause() {}, stop() {}, playerDeviceChanged() {} }
  const context = {
    console,
    Promise,
    URL,
    Float32Array,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: { Audio: FakeAudio, AudioContext: FakeAudioContext, app_event: appEvent, lx: { isPlayedStop: false } },
    document: { addEventListener() {}, removeEventListener() {} },
  }
  const noopPlayer = new Proxy({}, { get: () => () => {} })
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
    './vst3': {
      createVst3Node: async() => null,
      configureVst3Audio: async() => {},
      closeVst3Audio: async() => {},
      prepareVst3Audio: async() => true,
      resetVst3Audio: () => {},
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
  return { player: module.exports, appSetting, state }
}

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
