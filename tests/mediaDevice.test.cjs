const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function loadMediaDevice(mocks) {
  const source = fs.readFileSync('src/renderer/core/useApp/usePlayer/useMediaDevice.ts', 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const watchCallbacks = []
  let deviceChangeCallback
  let listenerAdds = 0
  let listenerRemoves = 0
  const module = { exports: {} }
  const context = {
    console,
    setTimeout,
    clearTimeout,
    navigator: { mediaDevices: {
      enumerateDevices: mocks.enumerateDevices,
      addEventListener: (_event, callback) => { listenerAdds++; deviceChangeCallback = callback },
      removeEventListener: () => { listenerRemoves++ },
    } },
    window: {
      i18n: { t: value => value },
      app_event: { playerDeviceChanged: () => {} },
      lx: { isPlayedStop: false },
    },
  }
  const modules = {
    '@common/utils/vueTools': {
      watch: (_source, callback) => { watchCallbacks.push(callback) },
      onBeforeUnmount: callback => { context.onBeforeUnmount = callback },
    },
    '@renderer/core/player/action': { pause: () => {} },
    '@renderer/plugins/Dialog': { dialog: () => Promise.resolve() },
    '@renderer/plugins/player': { setMediaDeviceId: mocks.setMediaDeviceId },
    '@renderer/store/player/state': { isPlay: { value: false } },
    '@renderer/store/setting': {
      appSetting: mocks.appSetting,
      saveMediaDeviceId: mocks.saveMediaDeviceId,
    },
  }
  vm.runInNewContext(compiled, {
    ...context,
    module,
    exports: module.exports,
    require: name => modules[name],
  })
  return {
    start: module.exports.default,
    triggerSetting: id => watchCallbacks[0](id),
    triggerEngine: engine => watchCallbacks[1](engine),
    triggerDeviceChange: () => deviceChangeCallback(),
    listenerAdds: () => listenerAdds,
    listenerRemoves: () => listenerRemoves,
    unmount: () => context.onBeforeUnmount(),
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

function outputDevice(deviceId) {
  return { kind: 'audiooutput', deviceId, label: deviceId }
}

test('out-of-order device enumeration binds and saves only the latest selection', async() => {
  const appSetting = { 'player.playEngine': 'electron', 'player.mediaDeviceId': 'device-a' }
  const enumerations = []
  const applied = []
  const saved = []
  const mediaDevice = loadMediaDevice({
    appSetting,
    enumerateDevices: () => new Promise(resolve => enumerations.push(resolve)),
    setMediaDeviceId: async id => { applied.push(id) },
    saveMediaDeviceId: id => { saved.push(id) },
  })

  mediaDevice.start()
  appSetting['player.mediaDeviceId'] = 'device-a'
  mediaDevice.triggerSetting('device-a')
  appSetting['player.mediaDeviceId'] = 'device-b'
  mediaDevice.triggerSetting('device-b')
  assert.equal(enumerations.length, 3)

  // B wins even though its enumerateDevices call finishes first.
  enumerations[2]([outputDevice('device-b')])
  enumerations[1]([outputDevice('device-a')])
  enumerations[0]([outputDevice('device-a')])
  await tick()
  await tick()

  assert.deepEqual(applied, ['device-b'])
  assert.deepEqual(saved, ['device-b'])
  assert.equal(appSetting['player.mediaDeviceId'], 'device-b')
  mediaDevice.unmount()
})

test('a temporarily missing device is retried without falling back or persisting default', async() => {
  const appSetting = { 'player.playEngine': 'electron', 'player.mediaDeviceId': 'missing-device' }
  const applied = []
  const saved = []
  const mediaDevice = loadMediaDevice({
    appSetting,
    enumerateDevices: async() => [outputDevice('default')],
    setMediaDeviceId: async id => {
      applied.push(id)
      throw new Error('device is not available')
    },
    saveMediaDeviceId: id => { saved.push(id) },
  })

  mediaDevice.start()
  await tick()
  await tick()

  assert.deepEqual(applied, ['missing-device'])
  assert.deepEqual(saved, [])
  assert.equal(appSetting['player.mediaDeviceId'], 'missing-device')
  mediaDevice.unmount()
})

test('MPV to Electron registers the device listener and retries the persisted device', async() => {
  const appSetting = { 'player.playEngine': 'mpv', 'player.mediaDeviceId': 'device-a' }
  const enumerations = []
  const applied = []
  const mediaDevice = loadMediaDevice({
    appSetting,
    enumerateDevices: () => new Promise(resolve => enumerations.push(resolve)),
    setMediaDeviceId: async id => { applied.push(id) },
    saveMediaDeviceId: () => {},
  })

  mediaDevice.start()
  assert.equal(enumerations.length, 0)
  assert.equal(mediaDevice.listenerAdds(), 0)

  appSetting['player.playEngine'] = 'electron'
  mediaDevice.triggerEngine('electron')
  assert.equal(enumerations.length, 1)
  assert.equal(mediaDevice.listenerAdds(), 1)
  enumerations[0]([outputDevice('device-a')])
  await tick()
  await tick()
  assert.deepEqual(applied, ['device-a'])

  appSetting['player.playEngine'] = 'mpv'
  mediaDevice.triggerEngine('mpv')
  assert.equal(mediaDevice.listenerRemoves(), 1)
  mediaDevice.unmount()
})
