const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const assert = require('node:assert/strict')
const { test } = require('node:test')

const noop = () => {}
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const tiers = ['master', 'hires', 'flac', '320k', '128k']
const song = (source, qualitys = tiers, id = source) => ({
  id, source, name: 'Same Song', singer: 'Singer', interval: '04:00',
  meta: { albumName: 'Album', qualitys: qualitys.map(type => ({ type })), _qualitys: Object.fromEntries(qualitys.map(type => [type, {}])) },
})
const orders = [
  ['platform', 'apiSource', 'quality'], ['platform', 'quality', 'apiSource'],
  ['apiSource', 'platform', 'quality'], ['apiSource', 'quality', 'platform'],
  ['quality', 'platform', 'apiSource'], ['quality', 'apiSource', 'platform'],
]

// Only services outside recovery are mocked. The planner, URL selection,
// attempt bookkeeping, playback action and event recovery are real modules.
function harness(options = {}) {
  const calls = []
  const hub = new EventEmitter()
  hub.on('error', noop)
  for (const event of ['playerError', 'playerEmptied', 'error', 'pause', 'stop']) hub[event] = () => hub.emit(event)
  const timers = new Map()
  let timerId = 0
  const original = options.original ?? song('wy')
  const alternatives = options.alternatives ?? [song('tx'), song('kg')]
  const player = {
    musicInfo: { id: original.id }, playMusicInfo: { musicInfo: original },
    isPlay: { value: false }, playQuality: { value: '' }, playQualityActual: { value: '' }, playSource: { value: null },
  }
  const appSetting = {
    'player.playQuality': 'master', 'player.playEngine': options.engine ?? 'electron',
    'common.apiSource': 'A', 'player.autoSkipOnError': true,
    'player.playErrorStrategy': options.strategy ?? 'auto',
    'player.playErrorStrategyOrder': [...(options.order ?? orders[0]), 'next'],
    'player.playErrorRetryCount': options.retryCount ?? 0,
    'player.playErrorApiSourceCount': options.apiCount ?? 1,
    ...options.settings,
  }
  const declared = api => options.declared?.[api] ?? { wy: tiers, tx: tiers, kg: tiers }
  const qualityList = { value: declared('A') }
  const win = { lx: { isPlayedStop: false, apiInitPromise: [Promise.resolve(true)] }, app_event: hub, i18n: { t: key => key } }
  const sdk = { findMusic: async() => { calls.push({ search: true }); return options.search ? options.search() : alternatives } }
  for (const source of ['wy', 'tx', 'kg', 'bili']) sdk[source] = {
    getMusicUrl(info, quality) {
      const attempt = { source, id: info.id, quality, apiId: appSetting['common.apiSource'] }
      calls.push(attempt)
      return { promise: Promise.resolve().then(() => options.request ? options.request(attempt) : Promise.reject(new Error('unavailable'))) }
    },
    ...(options.detail ? { getMusicQualityInfo: info => ({ promise: options.detail(info) }) } : {}),
  }
  const modules = new Map()
  const deps = {
    '@renderer/store': { qualityList, userApi: { list: (options.apiIds ?? ['A', 'B']).map(id => ({ id, name: id })) } },
    '@renderer/store/utils': { assertApiSupport: source => !!qualityList.value[source] },
    '@renderer/utils/musicSdk': { default: sdk },
    '@renderer/utils/ipc': {
      getMusicUrl: async() => null, getPlayerLyric: async() => ({}), saveMusicUrl: async() => {}, saveLyric: async() => {},
      probeAudioSource: async url => options.probe ? options.probe(url) : { error: 'No probe evidence' },
    },
    '@renderer/store/setting': { appSetting },
    '@renderer/utils': { toOldMusicInfo: x => x, toNewMusicInfo: x => x, langS2T: x => x },
    '@renderer/utils/index': { getRandom: () => 2 },
    '@renderer/utils/message': { requestMsg: { tooManyRequests: 'rate-limit', cancelRequest: 'cancel' } },
    '@renderer/utils/musicSdk/api-source': { apis: () => ({}) },
    '@renderer/store/list/action': { updateListMusics: noop, updateMusicQuality: async() => {}, addListMusics: noop, removeListMusics: noop },
    '@renderer/store/list/state': { loveList: {} },
    '@renderer/core/dislikeList': { addDislikeInfo: noop },
    '@renderer/store/download/utils': { buildSavePath: () => '/tmp' },
    '@renderer/worker/download/utils': { createDownloadInfo: () => ({ metadata: { fileName: 'test.flac' } }) },
    '@common/utils/nodejs': { joinPath: (...parts) => parts.join('/') },
    '@renderer/utils/musicSdk/bili/api': {},
    '@renderer/store/player/biliVideo': { isBiliVideoActive: () => false, biliPlaybackMode: { value: 'audio' } },
    '@common/utils/vueTools': { onBeforeUnmount: noop },
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/store/player/state': player,
    '@renderer/store/player/action': {
      setAllStatus: noop, setPlayQuality: q => { player.playQuality.value = q },
      setPlayQualityActual: q => { player.playQualityActual.value = q },
      setPlaySource: source => { player.playSource.value = source },
    },
    '@renderer/plugins/player': {
      setStop: async() => { player.isPlay.value = false; hub.playerEmptied() },
      setPause: () => { player.isPlay.value = false }, getCurrentTime: () => 0,
      setResource: async url => {
        calls.push({ resource: url })
        hub.emit('playerLoadstart')
        if (options.load) await options.load(url)
        player.isPlay.value = true
        hub.emit('playerLoadeddata')
        hub.emit('playerPlaying')
      },
    },
    '@renderer/core/apiSource': {
      setUserApi: async id => {
        calls.push({ switchApi: id })
        const initialized = options.initApi ? await options.initApi(id) : true
        appSetting['common.apiSource'] = id
        qualityList.value = declared(id)
        win.lx.apiInitPromise[0] = Promise.resolve(initialized)
      },
    },
  }
  const known = {
    '@renderer/core/music/utils': 'src/renderer/core/music/utils.ts',
    '../music/index': 'src/renderer/core/music/online.ts',
    '@renderer/core/music/online': 'src/renderer/core/music/online.ts',
    '@common/utils/playErrorStrategy': 'src/common/utils/playErrorStrategy.ts',
    '@common/utils/musicQuality': 'src/common/utils/musicQuality.ts',
    '@common/utils/playbackRecovery': 'src/common/utils/playbackRecovery.ts',
    '@renderer/core/player/playbackAttempt': 'src/renderer/core/player/playbackAttempt.ts',
    '@renderer/core/player/playbackIntent': 'src/renderer/core/player/playbackIntent.ts',
    '@renderer/core/player/errorStrategy': 'src/renderer/core/player/errorStrategy.ts',
    '@renderer/core/player': 'src/renderer/core/player/action.ts',
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const exports = {}
    modules.set(file, exports)
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(compiled, {
      exports, require: id => {
        if (file === 'src/renderer/core/player/action.ts' && id === './utils') return {}
        if (id in deps) return deps[id]
        if (id in known) return load(known[id])
        if (id.startsWith('.')) return load(require('node:path').posix.normalize(require('node:path').posix.join(require('node:path').posix.dirname(file), id + '.ts')))
        throw new Error(`Missing dependency ${id}`)
      },
      console: { log: noop, warn: noop, error: noop }, window: win, document: { hidden: true },
      setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id },
      clearTimeout: id => timers.delete(id),
    }, { filename: file })
    return exports
  }
  const intent = load('src/renderer/core/player/playbackIntent.ts')
  const action = load('src/renderer/core/player/action.ts')
  const next = []
  action.playNext = async() => { next.push(true) }
  load('src/renderer/core/useApp/usePlayer/usePlayEvent.ts').default()
  return {
    calls, player, original, next, appSetting, intent, action, hub, load,
    async start() { intent.setPlaybackIntent(true); action.setShouldPlayAfterLoad(true); action.setMusicUrl(original, true); await flush() },
    fire(ms) {
      const timer = [...timers].find(([, item]) => item.ms === ms)
      if (!timer) return false
      timers.delete(timer[0]); timer[1].fn(); return true
    },
  }
}
const requests = h => h.calls.filter(call => call.quality)
const tuple = c => `${c.apiId}/${c.source}/${c.quality}`
const result = c => ({ url: tuple(c), type: c.quality })

test('all six priorities cover every playable combination in the configured order', async t => {
  for (const order of orders) await t.test(order.join(' -> '), async() => {
    const h = harness({ order, request: () => Promise.reject(new Error('unavailable')) })
    await h.start()
    const actual = requests(h).map(tuple)
    const combinations = []
    for (const quality of ['master', 'hires', 'flac', '320k', '128k']) for (const source of ['wy', 'tx', 'kg']) for (const apiId of ['A', 'B']) combinations.push({ quality, source, apiId })
    const values = { platform: ['wy', 'tx', 'kg'], apiSource: ['A', 'B'], quality: ['master', 'hires', 'flac', '320k', '128k'] }
    combinations.sort((a, b) => {
      for (const dim of [...order].reverse()) {
        const field = dim === 'platform' ? 'source' : dim === 'apiSource' ? 'apiId' : 'quality'
        const difference = values[dim].indexOf(a[field]) - values[dim].indexOf(b[field])
        if (difference) return difference
      }
      return 0
    })
    assert.deepEqual(actual, combinations.map(tuple))
    assert.equal(new Set(actual).size, actual.length)
    assert.equal(h.next.length, 1)
  })
})

test('source B / QQ / mother tape is reached before lowering quality', async() => {
  const h = harness({ request: c => c.apiId === 'B' && c.source === 'tx' && c.quality === 'master' ? result(c) : Promise.reject(new Error('unavailable')) })
  await h.start()
  assert.equal(h.calls.at(-1).resource, 'B/tx/master')
  assert(requests(h).every(c => c.quality === 'master'))
  assert.equal(h.next.length, 0)
  assert.equal(h.player.playSource.value, 'tx')
  assert.equal(h.original.source, 'wy')
})

test('audio load failure continues to the next platform, rather than consuming platform recovery', async() => {
  const h = harness({ request: c => c.source === 'wy' ? Promise.reject(new Error('unavailable')) : result(c), load: async url => { if (url.includes('/tx/')) throw new Error('decode failure') } })
  await h.start()
  assert.equal(h.calls.at(-1).resource, 'A/kg/master')
  assert.equal(h.calls.some(c => c.switchApi), false)
  assert.equal(h.next.length, 0)
})

test('a late engine error resumes after the current successful combination', async() => {
  const h = harness({ request: c => c.source === 'wy' ? Promise.reject(new Error('unavailable')) : result(c) })
  await h.start()
  assert.equal(h.calls.at(-1).resource, 'A/tx/master')
  h.hub.playerError()
  await flush()
  assert.equal(h.calls.at(-1).resource, 'A/kg/master')
  assert.equal(requests(h).filter(c => c.source === 'tx').length, 1)
})

test('missing preferred quality tries other platforms/sources before playing lower quality', async() => {
  const h = harness({ original: song('wy', ['flac']), alternatives: [song('tx', ['master'])], request: result })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['A/tx/master'])
  assert.equal(h.player.playQuality.value, 'master')
})

test('unsupported source tiers are skipped and a different source can supply the preferred tier', async() => {
  const h = harness({ declared: { A: { wy: ['flac'], tx: ['flac'], kg: ['flac'] }, B: { wy: tiers, tx: tiers, kg: tiers } }, request: result })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['B/wy/master'])
})

test('quality-first may play lower quality on the original platform without switching platforms or sources', async() => {
  const h = harness({ order: ['quality', 'platform', 'apiSource'], request: c => c.quality === 'flac' ? result(c) : Promise.reject(new Error('unavailable')) })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/master', 'A/wy/hires', 'A/wy/flac'])
  assert.equal(h.calls.some(c => c.search || c.switchApi), false)
})

test('confirmed silent downgrade triggers recovery; inconclusive probes do not', async() => {
  for (const confirmed of [true, false]) {
    const h = harness({ request: result, probe: async url => confirmed && url.includes('/wy/') ? { format: 'flac', sampleRate: 44100, bitsPerSample: 16, bytesRead: 4096 } : { error: 'HTTP 403', bytesRead: 0 } })
    await h.start()
    assert.equal(h.calls.filter(c => c.resource).at(-1).resource, confirmed ? 'A/tx/master' : 'A/wy/master')
    assert.equal(h.next.length, 0)
  }
})

test('failed API initialization skips that source without looping, while respecting the source limit', async() => {
  const h = harness({ apiIds: ['A', 'B', 'C', 'D'], apiCount: 2, initApi: async id => id !== 'B', request: c => c.apiId === 'C' ? result(c) : Promise.reject(new Error('unavailable')) })
  await h.start()
  assert.deepEqual(h.calls.filter(c => c.switchApi).map(c => c.switchApi), ['B', 'C'])
  assert.equal(h.calls.at(-1).resource, 'C/wy/master')
  assert.equal(requests(h).some(c => c.apiId === 'D' || c.apiId === 'B'), false)
})

test('single-action modes only vary their enabled dimension, then stop', async() => {
  for (const [strategy, alternatives, expected] of [
    ['source', [song('tx')], ['A/wy/master', 'A/tx/master']],
    ['quality', [song('tx')], ['A/wy/master', 'A/wy/hires', 'A/wy/flac', 'A/wy/320k', 'A/wy/128k']],
    ['next', [song('tx')], ['A/wy/master']],
  ]) {
    const h = harness({ strategy, alternatives })
    await h.start()
    assert.deepEqual(requests(h).map(tuple), expected)
    assert.equal(h.next.length, strategy === 'next' ? 1 : 0)
  }
})

test('refresh retries the actual platform and quality, then advances without resetting the plan', async() => {
  const h = harness({ retryCount: 1, request: c => c.source === 'wy' ? Promise.reject(new Error('unavailable')) : result(c) })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/master', 'A/wy/master', 'A/tx/master'])
  h.hub.playerError()
  await flush()
  assert.equal(h.calls.at(-1).resource, 'A/kg/master')
})

test('paused/stopped/changed songs cancel recovery waiting on platform search', async() => {
  for (const cancel of ['pause', 'stop', 'song']) {
    const wait = deferred()
    const h = harness({ search: () => wait.promise })
    await h.start()
    if (cancel === 'pause') h.action.pause()
    else if (cancel === 'stop') h.action.stop()
    else { h.player.musicInfo.id = 'new-song'; h.player.playMusicInfo.musicInfo = song('kg', tiers, 'new-song'); h.hub.emit('musicToggled') }
    const count = requests(h).length
    wait.resolve([song('tx')])
    await flush()
    assert.equal(requests(h).length, count)
    assert.equal(h.next.length, 0)
  }
})

test('pause cancels recovery waiting on API initialization', async() => {
  const wait = deferred()
  const h = harness({ order: ['apiSource', 'platform', 'quality'], initApi: () => wait.promise })
  await h.start()
  h.action.pause()
  wait.resolve(true)
  await flush()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/master'])
  assert.equal(h.next.length, 0)
})

test('paused playback ignores a late downgrade probe', async() => {
  const wait = deferred()
  const h = harness({ request: result, probe: () => wait.promise })
  await h.start()
  h.action.pause()
  wait.resolve({ format: 'flac', sampleRate: 44100, bitsPerSample: 16, bytesRead: 4096 })
  await flush()
  assert.equal(requests(h).length, 1)
  assert.equal(h.next.length, 0)
})

test('legacy hires/flac24bit aliases are one tier and remain playable on old scripts', async() => {
  const h = harness({ original: song('wy', ['flac24bit', 'flac']), alternatives: [], declared: { A: { wy: ['flac24bit', 'flac'] } }, settings: { 'player.playQuality': 'hires' }, request: result })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/flac24bit'])
  assert.equal(h.next.length, 0)
})

test('detailed quality data is loaded before discarding a platform for missing preferred quality', async() => {
  const h = harness({ original: song('wy', ['flac']), detail: async() => ({ types: [{ type: 'master' }], _types: { master: {} } }), request: result })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/master'])
})

test('platform search failures still allow trying sources and lowering quality on the original song', async() => {
  const h = harness({ search: async() => { throw new Error('search timeout') }, request: c => c.apiId === 'B' && c.quality === 'flac' ? result(c) : Promise.reject(new Error('unavailable')) })
  await h.start()
  assert.equal(h.calls.at(-1).resource, 'B/wy/flac')
  assert.equal(h.next.length, 0)
})

test('URL load timeout advances and a late URL cannot replace the new combination', async() => {
  const wait = deferred()
  const h = harness({ request: c => c.source === 'wy' ? wait.promise : result(c) })
  await h.start()
  assert(h.fire(100000))
  await flush()
  assert.equal(h.calls.at(-1).resource, 'A/tx/master')
  wait.resolve({ url: 'late-original-url', type: 'master' })
  await flush()
  assert.equal(h.calls.some(c => c.resource === 'late-original-url'), false)
})

test('a timed-out API initialization advances to another source', async() => {
  const never = deferred()
  const h = harness({ apiIds: ['A', 'B', 'C'], apiCount: 2, initApi: id => id === 'B' ? never.promise : Promise.resolve(true), request: c => c.apiId === 'C' ? result(c) : Promise.reject(new Error('unavailable')) })
  await h.start()
  assert(h.fire(25000))
  await flush()
  assert.equal(h.calls.at(-1).resource, 'C/wy/master')
  assert.equal(h.next.length, 0)
})

test('duplicate old engine/probe failures cannot skip a new source during initialization', async() => {
  const probe = deferred()
  const init = deferred()
  const h = harness({ order: ['apiSource', 'platform', 'quality'], request: result, initApi: () => init.promise, probe: url => url.startsWith('A/') ? probe.promise : Promise.resolve({ error: 'unknown' }) })
  await h.start()
  h.hub.playerError()
  await flush()
  h.hub.playerError()
  probe.resolve({ format: 'flac', sampleRate: 44100, bitsPerSample: 16, bytesRead: 4096 })
  await flush()
  init.resolve(true)
  await flush()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/master', 'B/wy/master'])
  assert.equal(h.calls.at(-1).resource, 'B/wy/master')
  assert.equal(h.next.length, 0)
})

test('exhausted recovery skips once even if the engine sends further errors', async() => {
  const h = harness()
  await h.start()
  assert.equal(h.next.length, 1)
  h.hub.playerError()
  h.hub.playerError()
  await flush()
  assert.equal(h.next.length, 1)
})

test('MPV and Audirvana use the same complete recovery sequence', async() => {
  for (const engine of ['mpv', 'audirvana']) {
    const h = harness({ engine, request: c => c.apiId === 'B' && c.source === 'tx' ? result(c) : Promise.reject(new Error('unavailable')) })
    await h.start()
    assert.equal(h.calls.at(-1).resource, 'B/tx/master')
    assert.equal(h.player.playSource.value, 'tx')
    assert.equal(h.next.length, 0)
  }
})

test('disabled automatic recovery keeps normal available-quality selection', async() => {
  const h = harness({ original: song('wy', ['flac']), settings: { 'player.autoSkipOnError': false }, request: result })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/flac'])
  assert.equal(h.calls.some(c => c.search || c.switchApi), false)
})

test('late URL responses after pause cannot load or change the playback source', async() => {
  const wait = deferred()
  const h = harness({ request: () => wait.promise })
  await h.start()
  h.action.pause()
  wait.resolve({ url: 'paused-request-url', type: 'master' })
  await flush()
  assert.equal(h.calls.some(c => c.resource), false)
  assert.equal(h.player.playSource.value, null)
  assert.equal(h.next.length, 0)
})

test('synchronous quality-detail errors do not prevent lower-tier recovery', async() => {
  const h = harness({ original: song('wy', ['flac']), alternatives: [], strategy: 'quality', detail: () => { throw new Error('provider detail error') }, request: result })
  await h.start()
  assert.deepEqual(requests(h).map(tuple), ['A/wy/flac'])
  assert.equal(h.next.length, 0)
})
