const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

function load(file, modules = {}, globals = {}) {
  const state = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: state, exports: state.exports, console: { error() {} }, require: name => modules[name], ...globals })
  return state.exports
}
const selection = load('src/common/utils/audioDeviceSelection.ts')
const chromeDevices = () => [{ kind: 'audiooutput', deviceId: 'chromium-a', label: 'Duet 3' }, { kind: 'audiooutput', deviceId: 'chromium-b', label: 'BlackHole 16ch' }]
const nativeDevices = () => [{ id: 'auto', name: 'Auto' }, { id: 'avfoundation/duet', name: 'Duet 3' }, { id: 'avfoundation/blackhole', name: 'BlackHole 16ch' }]
const settle = async() => { await vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); await vue.nextTick() }

function manager(initial = {}, mocks = {}) {
  const setting = vue.reactive({ 'player.playEngine': 'electron', 'player.mediaDeviceId': 'chromium-a', 'player.mediaDeviceLabel': '', 'player.mediaDeviceId.electron': '', 'player.mediaDeviceId.mpv': '', ...initial })
  const mounted = []; const unmounted = []; const saved = []
  let deviceChange
  let removed = false
  const update = patch => {
    saved.push(patch)
    // The real settings layer accepts primitive fields and arrays, not objects.
    Object.assign(setting, Object.fromEntries(Object.entries(patch).filter(([, value]) => value === null || typeof value !== 'object' || Array.isArray(value))))
  }
  const scope = vue.effectScope()
  const mod = load('src/renderer/utils/compositions/useAudioDevices.ts', {
    '@common/utils/vueTools': { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn) },
    '@common/utils/audioDeviceSelection': selection,
    '@renderer/plugins/player/mpv': { listAudioDevices: mocks.mpv ?? (async() => nativeDevices()) },
    '@renderer/store/setting': { appSetting: setting, updateSetting: update },
    '@renderer/plugins/i18n': { useI18n: () => (key, params) => params ? 'Unavailable: ' + params.name : key },
  }, {
    navigator: {
      mediaDevices: {
        enumerateDevices: mocks.electron ?? (async() => chromeDevices()),
        addEventListener: (_event, callback) => { deviceChange = callback },
        removeEventListener: () => { removed = true },
      },
    },
  })
  const api = scope.run(() => mod.default())
  return {
    ...api,
    setting,
    saved,
    update,
    mount: () => { for (const fn of mounted) fn() },
    changed: () => deviceChange(),
    removed: () => removed,
    dispose: () => { for (const fn of unmounted) fn(); scope.stop() },
  }
}

test('switching engines preserves the physical output and both engine-specific IDs', async() => {
  const device = manager()
  device.mount(); await settle()
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Duet 3')
  const mpv = await device.prepareEngineChange('mpv')
  device.update({ ...mpv, 'player.playEngine': 'mpv' }); await settle()
  assert.equal(device.mediaDeviceId.value, 'avfoundation/duet')
  assert.equal(device.mediaDevices.value.find(item => item.deviceId === device.mediaDeviceId.value).label, 'Duet 3')
  const electron = await device.prepareEngineChange('electron')
  device.update({ ...electron, 'player.playEngine': 'electron' }); await settle()
  assert.equal(device.mediaDeviceId.value, 'chromium-a')
  assert.equal(device.setting['player.mediaDeviceId.mpv'], 'avfoundation/duet')
  device.dispose()
})

test('device memory survives primitive-only settings persistence and JSON reload', async() => {
  const first = manager()
  first.mount(); await settle()
  first.update({ ...await first.prepareEngineChange('mpv'), 'player.playEngine': 'mpv' }); await settle()
  const profile = JSON.parse(JSON.stringify(first.setting))
  first.dispose()
  const restarted = manager(profile)
  restarted.mount(); await settle()
  const patch = await restarted.prepareEngineChange('electron')
  assert.equal(patch['player.mediaDeviceId'], 'chromium-a')
  assert.equal(patch['player.mediaDeviceId.mpv'], 'avfoundation/duet')
  assert.equal(typeof profile['player.mediaDeviceLabel'], 'string')
  restarted.dispose()
})

test('global engine changes use each engine description even when the settings page is closed', async() => {
  const device = manager({}, { electron: async() => [{ kind: 'audiooutput', deviceId: 'chromium-a', label: 'USB Output (Virtual)' }], mpv: async() => [{ id: 'avfoundation/usb', name: 'USB Output' }] })
  device.mount(); await settle()
  device.update({ ...await device.prepareEngineChange('mpv'), 'player.playEngine': 'mpv' }); await settle()
  device.update({ ...await device.prepareEngineChange('electron'), 'player.playEngine': 'electron' }); await settle()
  device.update({ 'player.mediaDeviceId': 'avfoundation/usb', 'player.playEngine': 'mpv' }); await settle()
  assert.equal(device.setting['player.mediaDeviceId.electron'], 'chromium-a')
  assert.equal(device.setting['player.mediaDeviceId.mpv'], 'avfoundation/usb')
  assert.equal(await device.ensureForPlayback(), true)
  device.update({ 'player.mediaDeviceId': 'chromium-a', 'player.playEngine': 'electron' }); await settle()
  assert.equal(device.setting['player.mediaDeviceId.mpv'], 'avfoundation/usb')
  assert.equal(await device.ensureForPlayback(), true)
  device.dispose()
})

test('a restarted MPV profile restores its output in Electron', async() => {
  const device = manager({ 'player.playEngine': 'mpv', 'player.mediaDeviceId': 'avfoundation/blackhole', 'player.mediaDeviceLabel': 'BlackHole 16ch', 'player.mediaDeviceId.electron': 'chromium-b', 'player.mediaDeviceId.mpv': 'avfoundation/blackhole' })
  device.mount(); await settle()
  const patch = await device.prepareEngineChange('electron')
  assert.equal(patch['player.mediaDeviceId'], 'chromium-b')
  device.dispose()
})

test('legacy foreign IDs in either engine are repaired by matching the hardware name', async() => {
  for (const [engine, id, expected] of [['electron', 'avfoundation/blackhole', 'chromium-b'], ['mpv', 'chromium-a', 'avfoundation/duet']]) {
    const device = manager({ 'player.playEngine': engine, 'player.mediaDeviceId': id })
    device.mount(); await settle()
    assert.equal(device.setting['player.mediaDeviceId'], expected)
    assert.ok(device.mediaDevices.value.some(item => item.deviceId === expected && item.label))
    device.dispose()
  }
})

test('an empty list keeps the hardware name visible and restores a changed Chromium ID on reconnect', async() => {
  let devices = []
  const device = manager({ 'player.mediaDeviceLabel': 'Duet 3', 'player.mediaDeviceId.electron': 'chromium-a', 'player.mediaDeviceId.mpv': 'avfoundation/duet' }, { electron: async() => devices })
  device.mount(); await settle()
  assert.equal(device.setting['player.mediaDeviceId'], 'chromium-a')
  assert.ok(device.mediaDevices.value.some(item => item.deviceId === 'chromium-a' && item.label.includes('Duet 3')))
  devices = [{ kind: 'audiooutput', deviceId: 'chromium-new', label: 'Duet 3' }]
  device.changed(); await settle()
  assert.equal(device.setting['player.mediaDeviceId'], 'chromium-new')
  const mapped = await device.prepareEngineChange('mpv')
  assert.equal(mapped['player.mediaDeviceId'], 'avfoundation/duet')
  assert.equal(mapped['player.mediaDeviceId.electron'], 'chromium-new')
  device.dispose()
})

test('MPV enumeration failure does not clear the output or prevent configuring MPV', async() => {
  const device = manager({}, { mpv: async() => { throw new Error('mpv is not configured') } })
  device.mount(); await settle()
  const patch = await device.prepareEngineChange('mpv')
  device.update({ ...patch, 'player.playEngine': 'mpv' }); await settle()
  assert.equal(device.setting['player.playEngine'], 'mpv')
  assert.equal(device.setting['player.mediaDeviceId'], 'chromium-a')
  assert.ok(device.mediaDevices.value.some(item => item.deviceId === 'chromium-a' && item.label.includes('Duet 3')))
  device.dispose()
})

test('a late MPV enumeration cannot override a newer engine choice', async() => {
  let complete
  const device = manager({}, { mpv: () => new Promise(resolve => { complete = resolve }) })
  device.mount(); await settle()
  const slow = device.prepareEngineChange('mpv')
  await settle()
  const latest = await device.prepareEngineChange('electron')
  device.update({ ...latest, 'player.playEngine': 'electron' })
  complete(nativeDevices())
  assert.equal(await slow, null)
  await settle()
  assert.equal(device.setting['player.mediaDeviceId'], 'chromium-a')
  device.dispose()
})

test('closing settings discards pending device requests and removes its listener', async() => {
  let complete
  const device = manager({}, { mpv: () => new Promise(resolve => { complete = resolve }) })
  device.mount(); await settle()
  const request = device.prepareEngineChange('mpv')
  await settle(); device.dispose(); complete(nativeDevices())
  assert.equal(await request, null)
  assert.equal(device.removed(), true)
})

test('a device change in MPV invalidates Chromium IDs before switching back', async() => {
  let electron = chromeDevices()
  const device = manager({}, { electron: async() => electron })
  device.mount(); await settle()
  device.update({ ...await device.prepareEngineChange('mpv'), 'player.playEngine': 'mpv' }); await settle()
  electron = [{ kind: 'audiooutput', deviceId: 'chromium-reconnected', label: 'Duet 3' }]
  device.changed(); await settle()
  const patch = await device.prepareEngineChange('electron')
  assert.equal(patch['player.mediaDeviceId'], 'chromium-reconnected')
  assert.equal(patch['player.mediaDeviceId.mpv'], 'avfoundation/duet')
  device.dispose()
})

test('playback refuses a missing output after importing settings on a different computer', async() => {
  const device = manager({ 'player.mediaDeviceId': 'old-browser-id', 'player.mediaDeviceLabel': 'Previous Output', 'player.mediaDeviceId.electron': 'old-browser-id', 'player.mediaDeviceId.mpv': 'alsa/hw:0' })
  device.mount(); await settle()
  await assert.rejects(device.ensureForPlayback('electron'), /Unavailable/)
  assert.notEqual(device.setting['player.mediaDeviceId'], 'chromium-a')
  assert.notEqual(device.setting['player.mediaDeviceId'], 'default')
  device.dispose()
})

test('native video validates its own output mapping before the MPV backend starts', async() => {
  const device = manager({ 'player.mediaDeviceLabel': 'Duet 3', 'player.mediaDeviceId.electron': 'chromium-a', 'player.mediaDeviceId.mpv': 'avfoundation/duet' }, { mpv: async() => [{ id: 'avfoundation/duet', name: 'Different Computer Output' }] })
  device.mount(); await settle()
  await assert.rejects(device.ensureForPlayback('mpv'), /Unavailable/)
  assert.equal(device.setting['player.mediaDeviceId'], 'chromium-a')
  assert.equal(device.setting['player.mediaDeviceId.mpv'], '')
  device.dispose()
})

test('the default output always has a visible option even when Chromium omits it', async() => {
  const device = manager({ 'player.mediaDeviceId': 'default' })
  device.mount(); await settle()
  assert.equal(device.mediaDevices.value[0].deviceId, 'default')
  assert.ok(device.mediaDevices.value[0].label)
  device.dispose()
})
