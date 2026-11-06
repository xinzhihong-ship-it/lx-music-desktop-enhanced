const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

// WebDAV 自动同步（#23 #24）：后台自动同步遇到失败 / 冲突时只在状态栏提示（节流），不弹阻塞对话框；
// 手动同步保持原有的对话框交互。

const ROOT = path.join(__dirname, '../src/')
const transpile = file => ts.transpileModule(fs.readFileSync(ROOT + file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const load = (file, deps, globals) => {
  const exports = {}
  vm.runInNewContext(transpile(file), { exports, require: id => { if (!(id in deps)) throw new Error('unmocked ' + id); return deps[id] }, console: { log() {}, warn() {} }, ...globals }, { filename: file })
  return exports
}
const webdavUtils = load('common/utils/webdavSync.ts', {}, {})

const harness = ({ remote = null, lists = { default: [{ id: 'local-song', source: 'kw', name: 'a', singer: 'b', meta: {} }] }, appSettingOverrides = {} } = {}) => {
  const calls = { dialogs: [], confirms: [], status: [], actions: [], overwrites: 0 }
  const timers = []
  const statusText = { value: '' }
  const appSetting = {
    'sync.webdav.enable': true,
    'sync.webdav.autoSync': true,
    'sync.webdav.url': 'https://dav.example/',
    'sync.webdav.username': 'u',
    'sync.webdav.password': 'p',
    'sync.webdav.path': '/LX_Music/',
    'sync.webdav.lastListHash': '',
    'sync.webdav.lastListEtag': '',
    'sync.webdav.lastSyncTime': 0,
    'common.isAgreePact': true,
    ...appSettingOverrides,
  }
  const state = { remote, failWith: null, hold: null }
  const dialog = async options => { calls.dialogs.push(options.message ?? options) }
  dialog.confirm = async options => { calls.confirms.push(options.message); return true }
  const window = { i18n: { t: (key, params) => params ? `${key}${JSON.stringify(params)}` : key }, app_event: new EventEmitter() }
  const sync = load('renderer/core/webdavSync.ts', {
    '@common/utils/vueTools': { ref: value => ({ value }), toRaw: value => value },
    '@common/utils/webdavSync': webdavUtils,
    '@common/constants': { LIST_IDS: { DEFAULT: 'default', LOVE: 'love', TEMP: 'temp' } },
    '@renderer/utils': { filterMusicList: list => list, fixNewMusicInfoQuality: music => music },
    '@renderer/store/list/action': {
      getListMusics: async id => lists[id] ?? [],
      overwriteListFull: async() => { calls.overwrites++ },
      reloadListData: async() => {},
    },
    '@renderer/store/list/state': { defaultList: { id: 'default' }, loveList: { id: 'love' }, userLists: [] },
    '@renderer/store/setting': { appSetting, updateSetting: setting => Object.assign(appSetting, setting) },
    '@renderer/store': { userApi: { list: [] } },
    '@renderer/utils/exportSetting': { createExportSetting: setting => ({ ...setting }), preserveAgreement: setting => setting },
    '@renderer/utils/ipc': {
      getUserApiData: async() => ({}),
      overwriteUserApiData: async() => [],
      sendWebDAVAction: async({ action }) => {
        calls.actions.push(action)
        if (state.hold) await state.hold
        if (state.failWith) throw new Error(state.failWith)
        if (action === 'download') return state.remote
        if (action === 'upload') return { content: '', etag: 'new-etag', lastModified: '' }
        if (action === 'backup') return { backupPath: '/backup.json' }
        return null
      },
    },
    '@renderer/core/apiSource': { setUserApi: async() => {} },
    '@renderer/plugins/Dialog': { dialog },
    '@renderer/store/player/action': { setAllStatus: value => { statusText.value = value; calls.status.push(value) } },
    '@renderer/store/player/state': { statusText },
  }, { window, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimeout: () => {} })
  return { sync, calls, state, appSetting, statusText, timers }
}
const remoteFile = data => ({ content: JSON.stringify({ version: '2', lastModified: 1, data }), etag: 'remote-etag', lastModified: '' })
const remoteLists = songs => ({ defaultList: songs, loveList: [], tempList: [], userList: [] })

test('#23 an automatic sync failure (offline) shows a status-bar notice instead of a blocking dialog', async() => {
  const h = harness()
  h.state.failWith = 'getaddrinfo ENOTFOUND dav.example'
  await h.sync.runWebDAVAutoSync() // 不抛出
  assert.deepEqual(h.calls.dialogs, [])
  assert.equal(h.calls.status.length, 1)
  assert.match(h.calls.status[0], /setting__webdav_auto_sync_failed_status.*ENOTFOUND/)
  assert.equal(h.sync.webdavAutoSyncNotice.value.type, 'failed')
})

test('#23 repeated automatic failures are throttled: the status bar is not spammed', async() => {
  const h = harness()
  h.state.failWith = 'network down'
  for (let i = 0; i < 5; i++) await h.sync.runWebDAVAutoSync()
  assert.equal(h.calls.status.length, 1)
  assert.deepEqual(h.calls.dialogs, [])
})

test('#23 a successful sync clears the notice, and a later failure is reported again', async() => {
  const h = harness({ remote: null })
  h.state.failWith = 'network down'
  await h.sync.runWebDAVAutoSync()
  h.state.failWith = null
  await h.sync.runWebDAVAutoSync() // 云端无文件 → 上传成功
  assert.equal(h.sync.webdavAutoSyncNotice.value, null)
  h.state.failWith = 'network down again'
  await h.sync.runWebDAVAutoSync()
  assert.equal(h.calls.status.length, 2)
})

test('#23 an automatic sync overlapping a running sync is skipped silently', async() => {
  const h = harness()
  let release
  h.state.hold = new Promise(resolve => { release = resolve })
  const manual = h.sync.syncWebDAVLists(true)
  await h.sync.runWebDAVAutoSync()
  assert.deepEqual(h.calls.status, [])
  assert.equal(h.sync.webdavAutoSyncNotice.value, null)
  h.state.hold = null
  release()
  await manual
})

test('#23 the status-bar notice clears itself, but not a newer status message', async() => {
  const h = harness()
  h.state.failWith = 'network down'
  await h.sync.runWebDAVAutoSync()
  const clear = h.timers.find(timer => timer.ms === 8000)
  assert.ok(clear)
  clear.fn()
  assert.equal(h.statusText.value, '')
  const h2 = harness()
  h2.state.failWith = 'network down'
  await h2.sync.runWebDAVAutoSync()
  h2.statusText.value = 'player__loading' // 期间播放器写入了新状态
  h2.timers.find(timer => timer.ms === 8000).fn()
  assert.equal(h2.statusText.value, 'player__loading')
})

test('regression: a manual sync failure still rejects so the settings page can show its dialog', async() => {
  const h = harness()
  h.state.failWith = 'network down'
  await assert.rejects(h.sync.syncWebDAVLists(true), /network down/)
  assert.deepEqual(h.calls.status, [])
})

test('regression: automatic sync is a no-op when disabled', async() => {
  const h = harness({ appSettingOverrides: { 'sync.webdav.autoSync': false } })
  await h.sync.runWebDAVAutoSync()
  assert.deepEqual(h.calls.actions, [])
})

