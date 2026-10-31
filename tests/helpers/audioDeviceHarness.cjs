const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

const load = (file, modules = {}, globals = {}) => {
  const state = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: state, exports: state.exports, console: { error() {} }, setTimeout, clearTimeout, Date, require: name => modules[name], ...globals })
  return state.exports
}
const settle = async() => { await vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); await vue.nextTick() }
const chromeDevices = () => [{ kind: 'audiooutput', deviceId: 'browser-a', label: 'Wanted output' }, { kind: 'audiooutput', deviceId: 'browser-b', label: 'Other output' }]
const nativeDevices = () => [{ id: 'auto', name: 'Auto' }, { id: 'avfoundation/wanted', name: 'Wanted output' }, { id: 'avfoundation/other', name: 'Other output' }]

function createHarness(initial = {}, mocks = {}) {
  const selection = load('src/common/utils/audioDeviceSelection.ts')
  const setting = vue.reactive({
    'player.playEngine': 'electron',
    'player.mediaDeviceId': 'browser-a',
    'player.mediaDeviceLabel': 'Wanted output',
    'player.mediaDeviceLabel.electron': 'Wanted output',
    'player.mediaDeviceLabel.mpv': 'Wanted output',
    'player.mediaDeviceId.electron': 'browser-a',
    'player.mediaDeviceId.mpv': 'avfoundation/wanted',
    'player.isMediaDeviceRemovedStopPlay': true,
    'player.mpv.path': '',
    ...initial,
  })
  const mounted = []; const unmounted = []; const saved = []; const applied = []; const listeners = new Set()
  let enumerationCount = 0
  const update = patch => { saved.push(JSON.parse(JSON.stringify(patch))); Object.assign(setting, patch) }
  const navigator = {
    mediaDevices: {
      enumerateDevices: async() => { enumerationCount++; return (mocks.electron ?? chromeDevices)() },
      addEventListener: (_event, callback) => listeners.add(callback),
      removeEventListener: (_event, callback) => listeners.delete(callback),
    },
  }
  const store = { appSetting: setting, updateSetting: update, saveMediaDeviceId: (id, label) => update({ 'player.mediaDeviceId': id, ...selection.getAudioDevicePreferenceSetting(selection.rememberAudioDevice(selection.getAudioDevicePreference(setting), setting['player.playEngine'], id, label)) }) }
  const tools = { ...vue, onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback) }
  const service = load('src/renderer/utils/compositions/useAudioDevices.ts', {
    '@common/utils/vueTools': tools,
    '@common/utils/audioDeviceSelection': selection,
    '@renderer/plugins/player/mpv': { listAudioDevices: mocks.mpv ?? (async() => nativeDevices()) },
    '@renderer/store/setting': store,
    '@renderer/plugins/i18n': { useI18n: () => (key, params) => params ? 'Unavailable: ' + params.name : key },
  }, { navigator })
  const events = { changed: 0, paused: 0 }
  const binding = load('src/renderer/core/useApp/usePlayer/useMediaDevice.ts', {
    '@common/utils/vueTools': tools,
    '@common/utils/audioDeviceSelection': selection,
    '@renderer/utils/compositions/useAudioDevices': service,
    '@renderer/store/setting': store,
    '@renderer/core/player/action': { pause: () => { events.paused++ } },
    '@renderer/plugins/Dialog': { dialog: async() => {} },
    '@renderer/store/player/state': { isPlay: { value: mocks.playing ?? false } },
    '@renderer/plugins/player': {
      setMediaDeviceId: async(id, isCurrent = () => true) => {
        if (isCurrent()) applied.push(id)
        if (mocks.bind) await mocks.bind(id, isCurrent)
      },
    },
  }, { navigator, window: { lx: {}, i18n: { t: value => value }, app_event: { playerDeviceChanged: () => { events.changed++ } } } })
  const scope = vue.effectScope()
  let api
  scope.run(() => { binding.default(); api = service.default() })
  return {
    api,
    service,
    setting,
    update,
    applied,
    saved,
    events,
    enumerationCount: () => enumerationCount,
    mount: () => mounted.forEach(callback => callback()),
    changed: () => { for (const listener of listeners) listener() },
    dispose: () => { unmounted.forEach(callback => callback()); scope.stop() },
  }
}
module.exports = { createHarness, load, settle, chromeDevices, nativeDevices }
