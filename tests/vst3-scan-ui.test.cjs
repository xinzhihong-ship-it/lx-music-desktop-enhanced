const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const vue = require('vue')

const load = (source, mocks, suffix = '') => {
  const compiled = ts.transpileModule(source + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(loaded, loaded.exports, name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    return require(name)
  })
  return loaded.exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const settle = async() => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const names = { vst3_scan: 'scan', vst3_scan_progress: 'progress' }

const mainFixture = () => {
  const handlers = new Map()
  const scans = []
  const root = path.resolve('fixtures')
  const source = fs.readFileSync('src/main/modules/winMain/rendererEvent/vst3.ts', 'utf8')
  let hostAvailable = true
  const loaded = load(source, {
    electron: { app: { isPackaged: false, getAppPath: () => root } },
    'node:fs': { existsSync: () => hostAvailable },
    '@common/mainIpc': { mainHandle: (name, handler) => handlers.set(name, handler) },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: names },
    '@common/utils': { log: { warn() {} } },
    '../../../../../native/vst3-host/client.cjs': {
      defaultDirectories: () => [path.join(root, 'system')],
      scanPlugins: (_executable, directories, report) => {
        const task = deferred()
        scans.push({ ...task, directories, report })
        report({ phase: 'discover', found: 0 })
        return task.promise
      },
    },
    '../../../../../native/vst3-host/chain.cjs': {},
    '../../../../../native/vst3-host/binary.cjs': { validateVst3HostBinary() {} },
  })
  const originalTimer = global.setInterval
  global.setInterval = () => ({ unref() {} })
  try { loaded.default() } finally { global.setInterval = originalTimer }
  const sender = () => ({ events: [], isDestroyed: () => false, send(_name, payload) { this.events.push(payload) } })
  return { scans, sender, root, setHostAvailable: value => { hostAvailable = value }, scan: (webContents, directories) => handlers.get('scan')({ event: { sender: webContents }, params: directories }) }
}

test('scan requests share only matching directories and replay current progress', async() => {
  const fixture = mainFixture()
  const a = path.join(fixture.root, 'custom-a')
  const b = path.join(fixture.root, 'custom-b')
  const first = fixture.sender()
  const late = fixture.sender()
  const pendingA = fixture.scan(first, [a])
  fixture.scans[0].report({ phase: 'probe', current: 0, total: 1, path: a, elapsed: 5000 })
  const sharedA = fixture.scan(late, [a])
  assert.deepEqual(late.events.at(-1), first.events.at(-1))
  const pendingB = fixture.scan(fixture.sender(), [b])
  assert.equal(fixture.scans.length, 1)
  fixture.scans[0].resolve({ plugins: [], warnings: [] })
  const resultA = await pendingA
  assert.deepEqual(resultA.customDirectories, [a])
  assert.deepEqual(resultA.directories, [path.join(fixture.root, 'system'), a])
  assert.deepEqual(await sharedA, resultA)
  await settle()
  assert.equal(fixture.scans.length, 2)
  assert.deepEqual(fixture.scans[1].directories, [path.join(fixture.root, 'system'), b])
  fixture.scans[1].resolve({ plugins: [], warnings: [] })
  assert.deepEqual((await pendingB).customDirectories, [b])
})

test('validation and host startup failures do not retain subscribers', async() => {
  const fixture = mainFixture()
  const invalid = fixture.sender()
  await assert.rejects(fixture.scan(invalid, ['relative']), /Invalid VST3 directories/)
  const unavailable = fixture.sender()
  fixture.setHostAvailable(false)
  await assert.rejects(fixture.scan(unavailable, [fixture.root]), /VST3 host is unavailable/)
  fixture.setHostAvailable(true)
  const valid = fixture.sender()
  const pending = fixture.scan(valid, [fixture.root])
  assert.equal(invalid.events.length, 0)
  assert.equal(unavailable.events.length, 0)
  fixture.scans[0].resolve({ plugins: [], warnings: [] })
  await pending
})

test('renderer progress cleanup removes exactly its own IPC handler', () => {
  const ipcRenderer = new EventEmitter()
  const api = load(fs.readFileSync('src/common/rendererIpc.ts', 'utf8'), { electron: { ipcRenderer } })
  const calls = []
  const removeA = api.rendererOn('progress', ({ params }) => calls.push(['a', params]))
  const removeB = api.rendererOn('progress', ({ params }) => calls.push(['b', params]))
  ipcRenderer.emit('progress', {}, 1)
  removeA()
  removeA()
  ipcRenderer.emit('progress', {}, 2)
  removeB()
  assert.equal(ipcRenderer.listenerCount('progress'), 0)
  assert.deepEqual(calls, [['a', 1], ['b', 1], ['b', 2]])
})

const pickerFixture = () => {
  const props = vue.reactive({ show: false })
  const settings = vue.reactive({ 'player.vst3.directories': [path.resolve('custom-a')], 'player.vst3.chain': [] })
  const scans = []
  const callbacks = new Set()
  const cache = new Map()
  let unmount
  const component = fs.readFileSync('src/renderer/components/common/Vst3PluginPicker.vue', 'utf8')
  const script = component.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  const scope = vue.effectScope()
  const originalStorage = global.localStorage
  const originalProps = global.defineProps
  const originalEmits = global.defineEmits
  global.localStorage = { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) }
  global.defineProps = () => props
  global.defineEmits = () => () => {}
  const api = scope.run(() => load(script, {
    '@common/utils/vueTools': { ...vue, onBeforeUnmount: callback => { unmount = callback } },
    vue: { onBeforeUnmount: callback => { unmount = callback } },
    '@renderer/store/setting': { appSetting: settings },
    '@renderer/utils/ipc': {
      scanVst3Plugins: directories => { const task = deferred(); scans.push({ ...task, directories }); return task.promise },
      onVst3ScanProgress: callback => { callbacks.add(callback); return () => callbacks.delete(callback) },
    },
    '@renderer/plugins/player/vst3': { cleanVst3Error: String },
    '@root/lang': { useI18n: () => key => key },
  }, '\nmodule.exports = { scan, plugins, scanned, scanning, progressPercent, progressValue };'))
  return {
    api, props, settings, scans, callbacks, cache,
    finish(index, name = 'Effect') {
      scans[index].resolve({ customDirectories: scans[index].directories, plugins: [{ path: '/Effect.vst3', details: { info: { name, vendor: 'Vendor' } } }], warnings: [] })
    },
    unmount: () => { unmount(); scope.stop() },
    cleanup() {
      unmount(); scope.stop()
      global.localStorage = originalStorage
      global.defineProps = originalProps
      global.defineEmits = originalEmits
    },
  }
}

test('reopening an active picker does not scan again; changed directories discard old results', async() => {
  const f = pickerFixture()
  try {
    f.props.show = true
    await vue.nextTick()
    assert.equal(f.scans.length, 1)
    f.props.show = false
    await vue.nextTick()
    f.props.show = true
    await vue.nextTick()
    assert.equal(f.scans.length, 1)
    f.settings['player.vst3.directories'] = [path.resolve('custom-b')]
    await vue.nextTick()
    f.finish(0, 'Old')
    await settle()
    assert.equal(f.scans.length, 2)
    assert.equal(f.cache.size, 0)
    assert.equal(f.api.plugins.value.length, 0)
    f.finish(1, 'New')
    await settle()
    assert.equal(f.api.plugins.value[0].details.info.name, 'New')
    const cached = JSON.parse(f.cache.get('lx_vst3_scan_cache'))
    assert.deepEqual(cached.directories, [...f.settings['player.vst3.directories']])
    assert.equal(cached.version, 2)
    assert.equal(f.callbacks.size, 0)
    f.props.show = false
    await vue.nextTick()
    f.props.show = true
    await vue.nextTick()
    assert.equal(f.scans.length, 2)
  } finally { f.cleanup() }
})

test('picker ignores results after unmount and never rounds unfinished progress to 100%', async() => {
  const f = pickerFixture()
  try {
    const pending = f.api.scan()
    for (const callback of f.callbacks) callback({ phase: 'probe', current: 199, total: 200, elapsed: 5000 })
    assert.equal(f.api.progressValue.value, 199)
    assert.equal(f.api.progressPercent.value, 99)
    f.unmount()
    assert.equal(f.callbacks.size, 0)
    f.finish(0)
    await pending
    assert.equal(f.api.plugins.value.length, 0)
    assert.equal(f.cache.size, 0)
  } finally { f.cleanup() }
})
