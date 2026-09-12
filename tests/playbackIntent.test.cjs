const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const noop = () => {}
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const drain = async() => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function harness({ hidden = true, actions = ['next'], retryCount = 0, apiWait = Promise.resolve(), filterWait } = {}) {
  const hub = new EventEmitter()
  const timers = new Map()
  const state = { plays: 0, stops: 0, loads: 0, skips: 0, empty: false, resources: [], unmount: [] }
  let timerId = 0
  const window = { lx: { isPlayedStop: false, apiInitPromise: [Promise.resolve(true)] }, app_event: hub, key_event: new EventEmitter(), i18n: { t: key => key } }
  for (const event of ['playerError', 'pause', 'stop', 'error', 'playerEmptied']) hub[event] = () => hub.emit(event)
  const globals = {
    window, document: { hidden }, console: { log: noop, warn: noop, error: noop },
    setTimeout: (fn, ms = 0) => { const id = ++timerId; timers.set(id, { fn, ms }); return id },
    clearTimeout: id => timers.delete(id),
  }
  const load = (file, deps) => {
    const exports = {}
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(source, { exports, require: id => deps[id] || {}, ...globals }, { filename: file })
    return exports
  }
  const intent = load('src/renderer/core/player/playbackIntent.ts', {})
  const song = { id: 'song', source: 'kw', meta: {} }
  const playerState = { musicInfo: { id: 'song' }, playMusicInfo: { musicInfo: song }, isPlay: { value: false }, playQuality: { value: '128k' }, playedList: [], tempPlayList: [], playInfo: { playerListId: 'list', playerPlayIndex: 0 } }
  const plugin = {
    isEmpty: () => state.empty,
    setPause: () => { playerState.isPlay.value = false; hub.pause() },
    setStop: async() => { state.stops++; playerState.isPlay.value = false; hub.pause(); hub.playerEmptied() },
    setPlay: () => { state.plays++ }, getCurrentTime: () => 12, setCurrentTime: noop,
    setResource: async(src) => { state.resources.push(src) },
    createAudio: noop, applyAudioRoutingNow: async() => {},
  }
  const strategy = { getPlayErrorActions: () => actions, getPlayErrorApiSourceCount: () => 2, getPlayErrorRetryCount: () => retryCount, isPlayErrorHandlingEnabled: () => true }
  const deps = {
    '@common/utils/vueTools': { onBeforeUnmount: fn => state.unmount.push(fn), watch: noop },
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/store/player/state': playerState,
    '@renderer/plugins/player': plugin,
    '@renderer/store/player/action': { setAllStatus: noop, setPlayQuality: noop, setPlay: value => { playerState.isPlay.value = value }, getList: () => [song], setPlayMusicInfo: (listId, song) => { playerState.playMusicInfo.musicInfo = song; playerState.musicInfo.id = song.id; hub.emit('musicToggled') } },
    '@renderer/store/setting': { appSetting: { 'player.playEngine': 'electron', 'common.apiSource': 'a', 'player.togglePlayMethod': 'listLoop' } },
    '@renderer/core/player/errorStrategy': strategy, './errorStrategy': strategy,
    '@renderer/core/music/utils': { QUALITY_RANK: [], getLowerPlayQuality: () => null },
    '../music/utils': { getPlayQuality: () => '128k' },
    '@renderer/store/player/biliVideo': { isBiliVideoActive: () => false, biliPlaybackMode: { value: 'audio' } },
    '@common/utils/playErrorStrategy': { getNextApiSourceId: (_id, tried) => tried.has('b') ? undefined : 'b' },
    '@renderer/store': { userApi: { list: [{ id: 'a' }, { id: 'b' }] } },
    '@renderer/core/apiSource': { setUserApi: () => apiWait },
    './playbackIntent': intent, '@renderer/core/player/playbackIntent': intent,
    './utils': { filterList: () => filterWait?.promise, setPowerSaveBlocker: noop },
    '@renderer/utils': { setTitle: noop },
    '@renderer/core/player/utils': { setPowerSaveBlocker: noop },
    '@renderer/utils/message': { requestMsg: { cancelRequest: 'cancel', tooManyRequests: 'rate-limit' } },
    '@common/hotKey': { HOTKEY_PLAYER: new Proxy({}, { get: (_target, key) => ({ action: key }) }) },
  }
  const urlWait = deferred()
  deps['../music/index'] = { getMusicUrl: () => urlWait.promise, getPicPath: async() => '', getLyricInfo: async() => { throw new Error('no lyrics in test') } }
  const action = load('src/renderer/core/player/action.ts', deps)
  deps['@renderer/core/player'] = {
    ...action,
    setMusicUrl: () => { state.loads++ },
    playNext: async(...args) => { state.skips++; if (filterWait) await action.playNext(...args) },
  }
  load('src/renderer/core/useApp/usePlayer/usePlayEvent.ts', deps).default()
  for (const name of ['useMediaSessionInfo', 'usePlayProgress', 'usePlayEvent', 'useLyric', 'useVolume', 'useWatchList', 'usePlaybackRate', 'useSoundEffect', 'useMaxOutputChannelCount', 'usePreloadNextMusic']) deps[`./${name}`] = { default: noop }
  load('src/renderer/core/useApp/usePlayer/usePlayer.ts', deps).default()
  return {
    state, hub, action, intent, urlWait, timers, playerState,
    fire(ms) {
      const entry = [...timers].find(([, item]) => item.ms === ms)
      if (!entry) return false
      timers.delete(entry[0]); entry[1].fn(); return true
    },
  }
}

test('paused background errors cannot start recovery or skip a track', async() => {
  const h = harness()
  h.action.play(); h.action.pause(); h.hub.playerError(); await drain()
  assert.equal(h.state.stops, 0)
  assert.equal(h.state.skips, 0)
})

test('pause cancels delayed error skip, including the initial scheduling callback', async() => {
  for (const armDelay of [false, true]) {
    const h = harness({ hidden: false })
    h.action.play(); h.hub.playerError(); await drain()
    if (armDelay) assert(h.fire(0))
    h.action.pause(); h.fire(0); assert.equal(h.fire(5000), false)
    await drain(); assert.equal(h.state.skips, 0)
  }
})

test('loadeddata clears loading timeout even before playback; pause clears it too', () => {
  for (const event of ['playerLoadeddata', 'pause']) {
    const h = harness()
    h.action.play(); h.hub.emit('playerLoadstart')
    assert([...h.timers.values()].some(timer => timer.ms === 25000))
    if (event === 'pause') h.action.pause()
    else h.hub.emit(event)
    assert.equal(h.fire(25000), false)
  }
})

test('pause invalidates API recovery already waiting asynchronously', async() => {
  const wait = deferred()
  const h = harness({ actions: ['apiSource'], apiWait: wait.promise })
  h.action.play(); h.hub.playerError(); await drain()
  h.action.pause(); wait.resolve(); await drain()
  assert.equal(h.state.loads, 0)
  assert.equal(h.action.getShouldPlayAfterLoad(), false)
  assert.equal(h.intent.getPlaybackIntent(), false)
})

test('late canplay after seek and pause/stop/music change does not resume', () => {
  for (const cancel of ['pause', 'stop', 'musicToggled']) {
    const h = harness()
    h.action.setShouldPlayAfterSeek(true)
    if (cancel === 'musicToggled') h.hub.emit(cancel)
    else h.action[cancel]()
    assert.equal(h.action.getShouldPlayAfterSeek(), false)
    h.hub.emit('playerCanplay')
    assert.equal(h.state.plays, 0)
  }
})

test('normal seek canplay and explicit resume still play', () => {
  const h = harness()
  h.action.play(); h.action.setShouldPlayAfterSeek(true); h.hub.emit('playerCanplay')
  assert.equal(h.state.plays, 2)
  assert.equal(h.action.getShouldPlayAfterSeek(), false)
  h.action.pause(); h.action.play()
  assert.equal(h.state.plays, 3)
})

test('explicit play intent is not cancelled by canplay before the UI receives playing', () => {
  const h = harness()
  h.action.play()
  h.playerState.isPlay.value = false
  h.hub.emit('playerCanplay')
  assert.equal(h.state.plays, 2)
})

test('late canplay cannot resume even while engine UI still reports playing', () => {
  const h = harness()
  h.action.play(); h.action.pause()
  h.playerState.isPlay.value = true // Native pause acknowledgement has not arrived yet.
  h.hub.emit('playerCanplay')
  assert.equal(h.state.plays, 1)
})

test('internal pause/error does not cancel normal URL or API recovery', async() => {
  for (const retryCount of [0, 1]) {
    const h = harness({ actions: ['apiSource'], retryCount })
    h.action.play(); h.hub.error(); h.hub.playerError(); await drain()
    assert.equal(h.state.loads, 1)
    assert.equal(h.action.getShouldPlayAfterLoad(), true)
    assert.equal(h.intent.getPlaybackIntent(), true)
  }
})

test('normal foreground and background error skip remains enabled', async() => {
  for (const hidden of [false, true]) {
    const h = harness({ hidden })
    h.action.play(); h.hub.playerError(); await drain()
    if (!hidden) { assert(h.fire(0)); assert(h.fire(5000)) }
    assert.equal(h.state.skips, 1)
  }
})

test('pause while automatic next awaits list filtering prevents switching', async() => {
  const wait = deferred()
  const h = harness({ filterWait: wait })
  h.action.play(); h.hub.playerError(); await drain()
  assert.equal(h.state.skips, 1)
  h.action.pause(); wait.resolve({ filteredList: [{ id: 'next', source: 'kw', meta: {} }], playerIndex: 0 }); await drain()
  assert.equal(h.playerState.playMusicInfo.musicInfo.id, 'song')
  assert.equal(h.intent.getPlaybackIntent(), false)
})

test('automatic next still switches after list filtering when intent is unchanged', async() => {
  const wait = deferred()
  const h = harness({ filterWait: wait })
  h.action.play(); h.hub.playerError(); await drain()
  wait.resolve({ filteredList: [{ id: 'next', source: 'kw', meta: {} }], playerIndex: 0 }); await drain()
  assert.equal(h.playerState.playMusicInfo.musicInfo.id, 'next')
  assert.equal(h.action.getShouldPlayAfterLoad(), true)
  assert.equal(h.intent.getPlaybackIntent(), true)
})

test('pause cancels URL timeout and discards an in-flight URL response', async() => {
  const h = harness()
  h.state.empty = true; h.action.play(); await drain()
  assert([...h.timers.values()].some(timer => timer.ms === 100000))
  h.action.pause(); assert.equal(h.fire(100000), false)
  h.urlWait.resolve('https://example.invalid/song.mp3'); await drain()
  assert.deepEqual(h.state.resources, [])
  assert.equal(h.action.getShouldPlayAfterLoad(), false)
})

test('explicit play during an existing URL request preserves autoplay intent', async() => {
  const h = harness()
  h.state.empty = true
  h.action.setMusicUrl(h.playerState.playMusicInfo.musicInfo)
  await drain()
  h.action.play()
  assert.equal(h.action.getShouldPlayAfterLoad(), true)
  h.urlWait.resolve('https://example.invalid/song.mp3'); await drain()
  assert.equal(h.state.resources.length, 1)
  h.hub.emit('playerCanplay')
  assert.equal(h.state.plays, 1)
})

test('new playback request cannot revive recovery from before a pause', async() => {
  const wait = deferred()
  const h = harness({ actions: ['apiSource'], apiWait: wait.promise })
  h.action.play(); h.hub.playerError(); await drain()
  h.action.pause(); h.action.play(); wait.resolve(); await drain()
  assert.equal(h.state.loads, 0)
  assert.equal(h.intent.getPlaybackIntent(), true)
  h.hub.playerError(); await drain()
  assert.equal(h.state.loads, 1)
})
