const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// #19：下载与转换状态拆分——转换失败时标记「下载已完成」（isComplate，随任务持久化），
// 重试只重新转换、复用已下载的源文件；源文件已删除时回退为完整重新下载。

const ROOT = path.join(__dirname, '../src/')
const load = (file, deps, globals = {}) => {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(ROOT + file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, {
    exports,
    require: id => { if (!(id in deps)) throw new Error('unmocked ' + id); return deps[id] },
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    ...globals,
  }, { filename: file })
  return exports
}
const constants = load('common/constants.ts', new Proxy({}, { has: () => true, get: () => ({}) }))
const { DOWNLOAD_STATUS } = constants
const flush = async(ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, ms)) }
const plain = value => JSON.parse(JSON.stringify(value))

const harness = ({ savedTasks = [], autoConvert = true, conversions = [], fileExists = () => true } = {}) => {
  const state = { downloadList: [], downloads: [], conversions: [], updates: [], callbacks: new Map() }
  const appSetting = {
    'download.maxDownloadNum': 3,
    'download.fileName': '歌名 - 歌手',
    'download.skipExistFile': true,
    'download.autoConvert': autoConvert,
    'download.convertFormat': 'mp3',
    'download.deleteSourceAfterConvert': false,
    'download.isEmbedPic': false,
    'download.isEmbedLyric': false,
    'download.isDownloadLrc': false,
    'download.isUseOtherSource': false,
    'download.savePath': '/music',
  }
  const worker = new Proxy({
    createDownloadTasks: async list => list.map(info => ({
      id: `${info.id}_flac_flac`, isComplate: false, status: DOWNLOAD_STATUS.WAITING, statusText: '', downloaded: 0, total: 0, progress: 0, speed: '', writeQueue: 0,
      metadata: { musicInfo: info, url: null, quality: 'flac', ext: 'flac', filePath: '', fileName: `${info.name}.flac` },
    })),
    startTask: async(task, savePath, skip, callback) => { state.downloads.push(task.id); state.callbacks.set(task.id, callback) },
    fileExists: async filePath => fileExists(filePath),
  }, { get: (target, key) => target[key] ?? (async() => {}) })
  const window = {
    i18n: { t: key => key },
    app_event: { downloadListUpdate() {} },
    lx: { worker: { download: worker } },
  }
  const action = load('renderer/store/download/action.ts', {
    '@renderer/utils/ipc': {
      downloadTasksGet: async() => plain(savedTasks),
      downloadTasksCreate: async() => {},
      downloadTasksUpdate: async list => { state.updates.push(...plain(list)) },
      downloadTasksRemove: async() => {},
      addAudioConversionTasks: async params => { state.conversions.push(plain(params)); return [{ id: `c${state.conversions.length}` }] },
      waitAudioConversionTasks: async() => [conversions.shift() ?? { status: 'completed', outputPath: '/music/song.mp3' }],
    },
    'node:path': { ...path.posix, default: path.posix },
    './state': { downloadList: state.downloadList },
    '@common/utils/vueTools': { markRaw: value => value, toRaw: value => value },
    '@renderer/core/music/online': { getMusicUrl: async() => 'http://cdn/song.flac', getPicUrl: async() => '', getLyricInfo: async() => ({}) },
    '../setting': { appSetting },
    '..': { qualityList: { value: {} } },
    '../index': { proxy: {} },
    '@renderer/worker/utils': { proxyCallback: fn => fn },
    '@renderer/utils': { arrPush: (a, b) => { a.push(...b); return a }, arrUnshift: (a, b) => { a.unshift(...b); return a }, joinPath: (...parts) => parts.join('/') },
    '@common/constants': constants,
    './utils': { buildSavePath: () => '/music' },
    '@renderer/core/quality/labels': { qualityShortLabel: () => '' },
    '@renderer/plugins/Dialog': { dialog: async() => {} },
  }, { window })
  const complete = id => state.callbacks.get(id)({ action: 'complete' })
  return { action, state, appSetting, complete }
}
const song = { id: 'm1', name: 'song', singer: 'singer', source: 'wy', meta: {} }

test('#19 conversion failure keeps the download: marked downloaded (isComplate) with an explicit conversion error', async() => {
  const h = harness({ conversions: [{ status: 'error', error: 'ffmpeg failed' }] })
  await h.action.getDownloadList()
  await h.action.createDownloadTasks([song], 'flac')
  await flush()
  h.complete('m1_flac_flac')
  await flush(5)
  const task = h.state.downloadList[0]
  assert.equal(task.status, DOWNLOAD_STATUS.ERROR)
  assert.equal(task.isComplate, true)
  assert.equal(task.statusText, 'download_status_convert_failed：ffmpeg failed')
  assert.equal(h.action.isConvertFailedTask(task), true)
  await flush(120)
  assert.equal(h.state.updates.filter(u => u.id === task.id).at(-1).isComplate, true, 'must be persisted')
})

test('#19 retrying a failed conversion only reconverts the existing file (no re-download)', async() => {
  const h = harness({ conversions: [{ status: 'error', error: 'ffmpeg failed' }, { status: 'completed', outputPath: '/music/song.mp3' }] })
  await h.action.getDownloadList()
  await h.action.createDownloadTasks([song], 'flac')
  await flush()
  h.complete('m1_flac_flac')
  await flush(5)
  const task = h.state.downloadList[0]
  assert.equal(h.state.downloads.length, 1)
  await h.action.startDownloadTasks([task])
  await flush(5)
  assert.equal(h.state.downloads.length, 1, 'must not download again')
  assert.equal(h.state.conversions.length, 2)
  assert.equal(h.state.conversions[1].filePaths[0], '/music/song.flac', 'reuses the downloaded source file')
  assert.equal(task.status, DOWNLOAD_STATUS.COMPLETED)
  assert.equal(task.metadata.ext, 'mp3')
  assert.equal(task.metadata.filePath, '/music/song.mp3')
})

test('#19 a failed conversion survives a restart and is reconverted from the saved state', async() => {
  const saved = {
    id: 'm1_flac_flac', isComplate: true, status: DOWNLOAD_STATUS.ERROR, statusText: 'download_status_convert_failed', downloaded: 100, total: 100, progress: 100, speed: '', writeQueue: 0,
    metadata: { musicInfo: song, url: 'http://cdn/song.flac', quality: 'flac', ext: 'flac', filePath: '/music/song.flac', fileName: 'song.flac' },
  }
  const h = harness({ savedTasks: [saved] })
  const [task] = await h.action.getDownloadList()
  await h.action.startDownloadTasks([task])
  await flush(5)
  assert.equal(h.state.downloads.length, 0)
  assert.equal(h.state.conversions.length, 1)
  assert.equal(task.status, DOWNLOAD_STATUS.COMPLETED)
})

test('#19 if the downloaded source file was deleted, retry falls back to a full re-download', async() => {
  const saved = {
    id: 'm1_flac_flac', isComplate: true, status: DOWNLOAD_STATUS.ERROR, statusText: 'download_status_convert_failed', downloaded: 100, total: 100, progress: 100, speed: '', writeQueue: 0,
    metadata: { musicInfo: song, url: 'http://cdn/song.flac', quality: 'flac', ext: 'flac', filePath: '/music/song.flac', fileName: 'song.flac' },
  }
  const h = harness({ savedTasks: [saved], fileExists: () => false })
  const [task] = await h.action.getDownloadList()
  await h.action.startDownloadTasks([task])
  await flush(5)
  assert.equal(h.state.conversions.length, 0)
  assert.deepEqual(h.state.downloads, ['m1_flac_flac'])
  assert.equal(task.isComplate, false)
  assert.equal(task.progress, 0)
})

test('#19 regression: downloads with auto-convert off complete as before', async() => {
  const h = harness({ autoConvert: false })
  await h.action.getDownloadList()
  await h.action.createDownloadTasks([song], 'flac')
  await flush()
  h.complete('m1_flac_flac')
  await flush(5)
  assert.equal(h.state.downloadList[0].status, DOWNLOAD_STATUS.COMPLETED)
  assert.equal(h.state.conversions.length, 0)
})

test('#19 regression: a real download error (not conversion) still restarts the download on retry', async() => {
  const h = harness()
  await h.action.getDownloadList()
  await h.action.createDownloadTasks([song], 'flac')
  await flush()
  h.state.callbacks.get('m1_flac_flac')({ action: 'error', data: { message: 'network' } })
  await flush(5)
  const task = h.state.downloadList[0]
  assert.equal(task.status, DOWNLOAD_STATUS.ERROR)
  assert.equal(task.isComplate, false)
  await h.action.startDownloadTasks([task])
  await flush(5)
  assert.equal(h.state.downloads.length, 2, 'download is restarted')
  assert.equal(h.state.conversions.length, 0)
})
