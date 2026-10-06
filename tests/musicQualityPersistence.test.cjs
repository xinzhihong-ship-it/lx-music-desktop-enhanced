const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const clone = value => JSON.parse(JSON.stringify(value))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const song = (id = 'wy-song', source = 'wy') => ({
  id, source, name: 'Saved name', singer: 'Saved singer', interval: '03:00',
  meta: { songId: id, albumName: 'Saved album', picUrl: 'saved-cover', accountTrackId: 'entry-id',
    platformData: { token: 'playlist-data' }, qualitys: [{ type: 'flac', size: '20M' }], _qualitys: { flac: { size: '20M' } } },
})
const detail = { types: [{ type: 'flac', size: '20M' }, { type: 'master', size: '80M' }], _types: { flac: { size: '20M' }, master: { size: '80M' } } }

// Real renderer, main IPC handler, list event, worker and SQL helpers run against
// a temporary SQLite file. Only platform services and the IPC transport are fake.
function harness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-quality-'))
  const dbPath = path.join(directory, 'list.sqlite')
  let db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE my_list_music_info (id TEXT, listId TEXT, name TEXT, singer TEXT, source TEXT, interval TEXT, meta TEXT, PRIMARY KEY(id, listId));
    CREATE TABLE my_list_music_info_order (listId TEXT, musicInfoId TEXT, "order" INTEGER);`)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  const state = { queries: 0, saves: 0, writes: 0, failures: options.failures ?? 0, events: [], warnings: [] }
  const handlers = new Map()
  const modules = new Map()
  let worker
  const sharedGlobal = { lx: { worker: { dbService: {} }, event_list: null } }
  const database = {
    prepare(sql) {
      const statement = db.prepare(sql)
      const names = new Set([...sql.matchAll(/@(\w+)/g)].map(match => match[1]))
      const args = values => values.map(value => value && typeof value == 'object'
        ? Object.fromEntries(Object.entries(value).filter(([key]) => names.has(key))) : value)
      return {
        all: (...values) => statement.all(...args(values)),
        get: (...values) => statement.get(...args(values)),
        run: (...values) => { if (/UPDATE/.test(sql)) state.writes++; return statement.run(...args(values)) },
      }
    },
    transaction(fn) {
      return (...values) => {
        db.exec('BEGIN')
        try { const result = fn(...values); db.exec('COMMIT'); return result } catch (err) { db.exec('ROLLBACK'); throw err }
      }
    },
  }
  const deps = {
    '@common/constants': { LIST_IDS: { DEFAULT: 'default', LOVE: 'love', TEMP: 'temp' } },
    '../../db': { getDB: () => database },
    '@common/mainIpc': { mainHandle: (name, fn) => handlers.set(name, fn) },
    '@common/rendererIpc': {
      rendererInvoke: async(name, params) => {
        if (name.endsWith('_update_quality')) {
          state.saves++
          if (state.failures > 0) { state.failures--; throw new Error('save failed') }
          if (options.saveWait) await options.saveWait.promise
        }
        return clone(await handlers.get(name)({ params: params == null ? params : clone(params) }) ?? null)
      },
      rendererOn: () => {}, rendererOff: () => {},
    },
    '@common/utils/vueTools': { toRaw: value => value },
    '@renderer/store/setting': { appSetting: { 'player.playQuality': 'master' } },
    '@renderer/store': { qualityList: { value: {} } },
    '@renderer/utils': { toOldMusicInfo: value => value },
    '@renderer/utils/ipc': {},
    '@renderer/utils/data': { setListUpdateTime: async() => {} },
    '@renderer/store/songList/action': { getListDetailAll: async() => clone(options.refresh ?? []) },
    '@renderer/store/leaderboard/action': { getListDetailAll: async() => clone(options.refresh ?? []) },
    '@renderer/utils/musicSdk': { default: Object.fromEntries(['wy', 'kg', 'tx'].map(source => [source, {
      getMusicQualityInfo: info => { state.queries++; return { promise: Promise.resolve().then(() => options.lookup ? options.lookup(info) : clone(detail)) } },
    }])) },
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const exports = {}
    modules.set(file, exports)
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, global: sharedGlobal, console: { warn: (...args) => state.warnings.push(args) },
      require: id => {
        if (id === 'events') return require(id)
        if (id in deps) return deps[id]
        if (id === '@renderer/store/list/action' || (id === './action' && file.endsWith('/list/syncSourceList.ts'))) return { ...load('src/renderer/store/list/listManage/rendererListManage.ts'), setFetchingListStatus: () => {}, setUpdateTime: () => {} }
        if (id === './utils' && file.endsWith('/music/online.ts')) return {}
        if (file.endsWith('/listManage/rendererListManage.ts') && (id === './action' || id === './state')) return {}
        if (id.startsWith('@common/')) return load(`src/common/${id.slice(8)}.ts`)
        if (id.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), id + '.ts')))
        throw new Error(`Missing dependency ${id} in ${file}`)
      },
    }, { filename: file })
    return exports
  }
  worker = load('src/main/worker/dbService/modules/list/index.ts')
  sharedGlobal.lx.worker.dbService = worker
  sharedGlobal.lx.event_list = new (load('src/main/event/ListEvent.ts').Event)()
  sharedGlobal.lx.event_list.on('list_music_update', updates => state.events.push(clone(updates)))
  load('src/main/modules/commonRenderers/list/rendererEvent.ts').default()
  const online = load('src/renderer/core/music/online.ts')
  return {
    state, worker, online,
    async refresh(listId = 'playlist') { await load('src/renderer/store/list/syncSourceList.ts').default({ id: listId, source: 'wy', sourceListId: 'remote-list' }) },
    async overwrite(listId, musicInfos) { await load('src/renderer/store/list/listManage/rendererListManage.ts').overwriteListMusics({ listId, musicInfos }) },
    add(listId, musicInfo, order = 0) {
      db.prepare('INSERT INTO my_list_music_info VALUES (?, ?, ?, ?, ?, ?, ?)').run(musicInfo.id, listId, musicInfo.name, musicInfo.singer, musicInfo.source, musicInfo.interval, JSON.stringify(musicInfo.meta))
      db.prepare('INSERT INTO my_list_music_info_order VALUES (?, ?, ?)').run(listId, musicInfo.id, order)
    },
    stored(listId, id = 'wy-song') {
      const row = db.prepare('SELECT * FROM my_list_music_info WHERE listId=? AND id=?').get(listId, id)
      return row && { ...row, meta: JSON.parse(row.meta) }
    },
    order(listId, id = 'wy-song') { return db.prepare('SELECT "order" FROM my_list_music_info_order WHERE listId=? AND musicInfoId=?').get(listId, id)?.order },
    remove(listId, id = 'wy-song') { worker.musicsRemove(listId, [id]) },
    restart() {
      db.close(); db = new DatabaseSync(dbPath)
      for (const file of [...modules.keys()]) if (file.startsWith('src/main/worker/dbService/modules/list/')) modules.delete(file)
      worker = load('src/main/worker/dbService/modules/list/index.ts')
      sharedGlobal.lx.worker.dbService = worker
      return worker
    },
  }
}

test('same-platform Master survives closing SQLite and reloading the playlist', async t => {
  const h = harness(t)
  const musicInfo = song()
  h.add('playlist', musicInfo, 7)
  const cached = h.worker.getListMusics('playlist')
  await h.online.loadDetailedQuality(musicInfo, 'master')
  assert.ok(musicInfo.meta._qualitys.master)
  assert.ok(cached[0].meta._qualitys.master)
  assert.equal(h.state.events.length, 1)
  assert.ok(h.restart().getListMusics('playlist')[0].meta._qualitys.master)
  assert.equal(h.stored('playlist').source, 'wy')
  assert.equal(h.stored('playlist').meta.accountTrackId, 'entry-id')
  assert.equal(h.order('playlist'), 7)
})

test('updates all stored copies, preserving each copy’s names, cover and platform data', async t => {
  const h = harness(t)
  const first = song()
  const second = song()
  second.name = 'Edited name'; second.meta.picUrl = 'new-cover'; second.meta.accountTrackId = 'other-entry'
  second.meta.platformData = { own: true }
  h.add('first', first); h.add('second', second)
  await h.online.loadDetailedQuality(first, 'master')
  assert.ok(h.stored('first').meta._qualitys.master)
  const saved = h.stored('second')
  assert.ok(saved.meta._qualitys.master)
  assert.equal(saved.name, 'Edited name')
  assert.equal(saved.meta.picUrl, 'new-cover')
  assert.equal(saved.meta.accountTrackId, 'other-entry')
  assert.deepEqual(saved.meta.platformData, { own: true })
})

test('a late lookup preserves newer metadata and does not restore a removed song', async t => {
  const wait = deferred()
  const h = harness(t, { lookup: () => wait.promise })
  const original = song()
  h.add('kept', original); h.add('removed', original)
  const request = h.online.loadDetailedQuality(clone(original), 'master')
  await new Promise(resolve => setImmediate(resolve))
  const edited = song(); edited.name = 'Renamed'; edited.meta.picUrl = 'edited-cover'
  h.worker.musicsUpdate([{ id: 'kept', musicInfo: edited }])
  h.remove('removed')
  wait.resolve(detail); await request
  assert.equal(h.stored('kept').name, 'Renamed')
  assert.equal(h.stored('kept').meta.picUrl, 'edited-cover')
  assert.ok(h.stored('kept').meta._qualitys.master)
  assert.equal(h.stored('removed'), undefined)
})

test('manual replacement and identical IDs on another platform remain untouched', async t => {
  const h = harness(t)
  const original = song()
  const other = song(original.id, 'tx')
  h.add('other-platform', other)
  h.add('manual', song('replacement', 'kg'))
  await h.online.loadDetailedQuality(original, 'master')
  assert.equal(h.stored('other-platform').meta._qualitys.master, undefined)
  assert.equal(h.stored('manual', 'replacement').source, 'kg')
  assert.equal(h.state.writes, 0)
  assert.equal(h.state.events.length, 0)
})

test('a failed save does not break playback quality and is retried without another lookup', async t => {
  const h = harness(t, { failures: 1 })
  const original = song()
  h.add('playlist', original)
  await h.online.loadDetailedQuality(original, 'master')
  assert.ok(original.meta._qualitys.master)
  assert.equal(h.stored('playlist').meta._qualitys.master, undefined)
  await h.online.loadDetailedQuality(original, 'master')
  assert.equal(h.state.queries, 1)
  assert.equal(h.state.saves, 2)
  assert.ok(h.restart().getListMusics('playlist')[0].meta._qualitys.master)
})

test('concurrent quality lookups share the platform request and do not repeat database writes', async t => {
  const h = harness(t)
  const original = song()
  h.add('playlist', original)
  await Promise.all([h.online.loadDetailedQuality(original), h.online.loadDetailedQuality(original)])
  assert.equal(h.state.queries, 1)
  assert.equal(h.state.writes, 1)
  assert.equal(h.state.events.length, 1)
  await h.online.loadDetailedQuality(original)
  assert.equal(h.state.saves, 1)
})

test('empty or failed detail responses never change saved quality', async t => {
  for (const lookup of [() => ({ types: [], _types: {} }), () => { throw new Error('provider failed') }]) {
    const h = harness(t, { lookup })
    const original = song(); h.add('playlist', original)
    await h.online.loadDetailedQuality(original)
    assert.equal(h.state.saves, 0)
    assert.equal(h.stored('playlist').meta._qualitys.master, undefined)
  }
})

test('partial quality responses retain known tiers and Kugou hashes', async t => {
  const h = harness(t, { lookup: () => ({ types: [{ type: 'master', size: null }], _types: { master: { size: null } } }) })
  const original = song('kg-song', 'kg')
  original.meta.qualitys[0].hash = 'flac-hash'
  original.meta._qualitys.flac.hash = 'flac-hash'
  original.meta._qualitys.master = { size: '80M', hash: 'master-hash' }
  h.add('playlist', original)
  const playbackCopy = clone(original); delete playbackCopy.meta._qualitys.master
  await h.online.loadDetailedQuality(playbackCopy)
  const saved = h.stored('playlist', 'kg-song')
  assert.equal(saved.meta._qualitys.flac.hash, 'flac-hash')
  assert.equal(saved.meta._qualitys.master.hash, 'master-hash')
  assert.ok(saved.meta.qualitys.some(item => item.type === 'master'))
})

test('a song whose identity changes during lookup receives no stale quality update', async t => {
  const wait = deferred()
  const h = harness(t, { lookup: () => wait.promise })
  const original = song(); h.add('playlist', original)
  const request = h.online.loadDetailedQuality(original)
  await new Promise(resolve => setImmediate(resolve))
  original.id = 'changed'; original.source = 'tx'
  wait.resolve(detail); await request
  assert.equal(original.meta._qualitys.master, undefined)
  assert.equal(h.state.saves, 0)
})


test('startup platform refresh retains discovered Master while updating membership and other metadata', async t => {
  const fetched = song(); fetched.name = 'Refreshed title'; fetched.meta.picUrl = 'refreshed-cover'
  const added = song('new-song')
  const h = harness(t, { refresh: [added, fetched] })
  const original = song(); h.add('playlist', original); h.add('playlist', song('removed-song'), 1)
  await h.online.loadDetailedQuality(original)
  h.restart()
  await h.refresh()
  const saved = h.stored('playlist')
  assert.ok(saved.meta._qualitys.master)
  assert.equal(saved.name, 'Refreshed title')
  assert.equal(saved.meta.picUrl, 'refreshed-cover')
  assert.equal(h.stored('playlist', 'removed-song'), undefined)
  assert.equal(h.stored('playlist', 'new-song').meta._qualitys.master, undefined)
  assert.equal(h.order('playlist', 'new-song'), 0)
  assert.equal(h.order('playlist'), 1)
  assert.ok(h.restart().getListMusics('playlist')[1].meta._qualitys.master)
})

test('platform refresh does not copy another platform’s quality, and normal overwrite stays exact', async t => {
  const fetched = song('wy-song', 'tx')
  const h = harness(t, { refresh: [fetched] })
  const original = song(); h.add('playlist', original)
  await h.online.loadDetailedQuality(original)
  await h.refresh()
  assert.equal(h.stored('playlist').source, 'tx')
  assert.equal(h.stored('playlist').meta._qualitys.master, undefined)
  await h.online.loadDetailedQuality(fetched)
  assert.ok(h.stored('playlist').meta._qualitys.master)
  await h.overwrite('playlist', [song('wy-song', 'tx')])
  assert.equal(h.stored('playlist').meta._qualitys.master, undefined)
})
