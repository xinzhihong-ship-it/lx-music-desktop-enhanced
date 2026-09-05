import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFile } from 'node:fs/promises'
import {
  getNextApiSourceId,
  getPlayErrorActions,
  movePlayErrorAction,
  normalizePlayErrorApiSourceCount,
  normalizePlayErrorRetryCount,
  normalizePlayErrorStrategyOrder,
} from '../src/common/utils/playErrorStrategy.ts'

const mocks = globalThis.__issue19Mocks = {
  qualityList: { value: {} },
  userApi: { list: [] },
  appSetting: {},
  musicSdk: {},
  playerState: {
    musicInfo: { id: null },
    playMusicInfo: { musicInfo: null },
    isPlay: { value: false },
    playQuality: { value: '128k' },
  },
}

const virtualModules = new Map([
  ['@renderer/store', 'export const qualityList = globalThis.__issue19Mocks.qualityList; export const userApi = globalThis.__issue19Mocks.userApi'],
  ['@renderer/store/utils', 'export const assertApiSupport = (...args) => globalThis.__issue19Mocks.assertApiSupport(...args)'],
  ['@renderer/utils/musicSdk', 'export default globalThis.__issue19Mocks.musicSdk'],
  ['@renderer/utils/ipc', 'export const getMusicUrl = (...args) => globalThis.__issue19Mocks.getStoreMusicUrl(...args); export const getPlayerLyric = (...args) => globalThis.__issue19Mocks.getStoreLyric(...args)'],
  ['@renderer/store/setting', 'export const appSetting = globalThis.__issue19Mocks.appSetting'],
  ['@renderer/utils', 'export const langS2T = (...args) => globalThis.__issue19Mocks.langS2T(...args); export const toNewMusicInfo = (...args) => globalThis.__issue19Mocks.toNewMusicInfo(...args); export const toOldMusicInfo = (...args) => globalThis.__issue19Mocks.toOldMusicInfo(...args)'],
  ['@renderer/utils/message', 'export const requestMsg = globalThis.__issue19Mocks.requestMsg'],
  ['@renderer/utils/musicSdk/api-source', 'export const apis = (...args) => globalThis.__issue19Mocks.apis(...args)'],
  ['@common/utils/vueTools', 'export const onBeforeUnmount = callback => globalThis.__issue19Mocks.onBeforeUnmount(callback)'],
  ['@renderer/plugins/i18n', 'export const useI18n = () => globalThis.__issue19Mocks.translate'],
  ['@renderer/store/player/state', 'export const musicInfo = globalThis.__issue19Mocks.playerState.musicInfo; export const playMusicInfo = globalThis.__issue19Mocks.playerState.playMusicInfo; export const isPlay = globalThis.__issue19Mocks.playerState.isPlay; export const playQuality = globalThis.__issue19Mocks.playerState.playQuality'],
  ['@renderer/plugins/player', 'export const setStop = (...args) => globalThis.__issue19Mocks.setStop(...args)'],
  ['@renderer/core/player', 'export const getShouldPlayAfterLoad = (...args) => globalThis.__issue19Mocks.getShouldPlayAfterLoad(...args); export const playNext = (...args) => globalThis.__issue19Mocks.playNext(...args); export const setMusicUrl = (...args) => globalThis.__issue19Mocks.setMusicUrl(...args); export const setShouldPlayAfterLoad = (...args) => globalThis.__issue19Mocks.setShouldPlayAfterLoad(...args)'],
  ['@renderer/store/player/action', 'export const setAllStatus = (...args) => globalThis.__issue19Mocks.setAllStatus(...args)'],
  ['@renderer/core/player/errorStrategy', 'export const getPlayErrorActions = (...args) => globalThis.__issue19Mocks.getPlayErrorActions(...args); export const getPlayErrorApiSourceCount = (...args) => globalThis.__issue19Mocks.getPlayErrorApiSourceCount(...args); export const getPlayErrorRetryCount = (...args) => globalThis.__issue19Mocks.getPlayErrorRetryCount(...args); export const isPlayErrorHandlingEnabled = (...args) => globalThis.__issue19Mocks.isPlayErrorHandlingEnabled(...args)'],
  ['@renderer/core/music/utils', 'export const QUALITY_RANK = globalThis.__issue19Mocks.QUALITY_RANK; export const getLowerPlayQuality = (...args) => globalThis.__issue19Mocks.getLowerPlayQuality(...args); export const getPlayQuality = (...args) => globalThis.__issue19Mocks.getPlayQuality(...args)'],
  ['@renderer/store/player/biliVideo', 'export const isBiliVideoActive = (...args) => globalThis.__issue19Mocks.isBiliVideoActive(...args)'],
  ['@renderer/core/apiSource', 'export const setUserApi = (...args) => globalThis.__issue19Mocks.setUserApi(...args)'],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = virtualModules.get(specifier)
    if (source != null) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    if (specifier == '@common/utils/playErrorStrategy') {
      return { url: new URL('../src/common/utils/playErrorStrategy.ts', import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

Object.assign(mocks, {
  assertApiSupport: () => true,
  getStoreMusicUrl: async() => null,
  getStoreLyric: async() => ({ lyric: '' }),
  langS2T: async value => value,
  toNewMusicInfo: value => value,
  toOldMusicInfo: value => value,
  requestMsg: { tooManyRequests: 'too many requests', cancelRequest: 'cancel request' },
  apis: () => ({}),
})

globalThis.window = {
  lx: { isPlayedStop: false, apiInitPromise: [Promise.resolve(true)] },
  i18n: { t: key => key },
}

const { getOtherSource, handleGetOnlineMusicUrl } = await import('../src/renderer/core/music/utils.ts')
const { default: usePlayEvent } = await import('../src/renderer/core/useApp/usePlayer/usePlayEvent.ts')

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

const flushPromises = () => new Promise(resolve => setImmediate(resolve))

test('playback failure order keeps each supported action exactly once', () => {
  assert.deepEqual(
    normalizePlayErrorStrategyOrder(['quality', 'quality', 'invalid', 'next']),
    ['quality', 'apiSource', 'platform', 'next'],
  )
  assert.deepEqual(movePlayErrorAction(['apiSource', 'platform', 'quality', 'next'], 2, 0), [
    'quality', 'apiSource', 'platform', 'next',
  ])
})

test('play next stays last because it terminates the recovery chain', () => {
  assert.deepEqual(
    normalizePlayErrorStrategyOrder(['platform', 'next', 'apiSource', 'quality']),
    ['platform', 'apiSource', 'quality', 'next'],
  )
  assert.deepEqual(movePlayErrorAction(['apiSource', 'platform', 'quality', 'next'], 3, 0), [
    'apiSource', 'platform', 'quality', 'next',
  ])
  assert.deepEqual(movePlayErrorAction(['apiSource', 'platform', 'quality', 'next'], 0, 3), [
    'apiSource', 'platform', 'quality', 'next',
  ])
})

test('legacy strategies keep their original single action', () => {
  assert.deepEqual(getPlayErrorActions('source', []), ['platform'])
  assert.deepEqual(getPlayErrorActions('quality', []), ['quality'])
  assert.deepEqual(getPlayErrorActions('next', []), ['next'])
})

test('retry and source counts are integer and bounded', () => {
  assert.equal(normalizePlayErrorRetryCount('3'), 3)
  assert.equal(normalizePlayErrorRetryCount(99), 5)
  assert.equal(normalizePlayErrorApiSourceCount(0), 1)
  assert.equal(normalizePlayErrorApiSourceCount('bad'), 2)
})

test('automatic source switching follows list order and wraps once', () => {
  assert.equal(getNextApiSourceId('source-b', new Set(['source-b']), ['source-a', 'source-b', 'source-c']), 'source-c')
  assert.equal(getNextApiSourceId('source-c', new Set(['source-b', 'source-c']), ['source-a', 'source-b', 'source-c']), 'source-a')
  assert.equal(getNextApiSourceId('source-a', new Set(['source-a', 'source-b', 'source-c']), ['source-a', 'source-b', 'source-c']), null)
})

test('refresh starts a new source search and an older request cannot overwrite it', async() => {
  const oldRequest = createDeferred()
  const freshRequest = createDeferred()
  let requestCount = 0
  mocks.musicSdk.findMusic = () => (++requestCount == 1 ? oldRequest.promise : freshRequest.promise)
  const musicInfo = {
    id: 'race-song',
    source: 'kw',
    name: 'Race Song',
    singer: 'Singer',
    interval: '03:00',
    meta: { albumName: 'Album' },
  }

  const oldResult = getOtherSource(musicInfo)
  const freshResult = getOtherSource(musicInfo, true)
  assert.equal(requestCount, 2)

  freshRequest.resolve([{ id: 'fresh', source: 'wy' }])
  assert.equal((await freshResult)[0].id, 'fresh')
  oldRequest.resolve([{ id: 'old', source: 'tx' }])
  await oldResult

  assert.equal((await getOtherSource(musicInfo))[0].id, 'fresh')
  assert.equal(requestCount, 2)
})

test('refresh fallback bypasses an already cached source search', async() => {
  let requestCount = 0
  const originalMusic = {
    id: 'refresh-song',
    source: 'kw',
    name: 'Refresh Song',
    singer: 'Singer',
    interval: '03:00',
    meta: { albumName: 'Album', _qualitys: { '128k': true } },
  }
  const oldSource = { id: 'old-source', source: 'tx', name: 'Old', singer: 'Singer', interval: '03:00', meta: { albumName: '', _qualitys: { '128k': true } } }
  const freshSource = { id: 'fresh-source', source: 'wy', name: 'Fresh', singer: 'Singer', interval: '03:00', meta: { albumName: '', _qualitys: { '128k': true } } }
  mocks.musicSdk.findMusic = async() => (++requestCount == 1 ? [oldSource] : [freshSource])
  mocks.musicSdk.kw = { getMusicUrl: () => ({ promise: Promise.reject(new Error('expired')) }) }
  mocks.musicSdk.wy = { getMusicUrl: () => ({ promise: Promise.resolve({ url: 'fresh-url', type: '128k' }) }) }

  await getOtherSource(originalMusic)
  const result = await handleGetOnlineMusicUrl({
    musicInfo: originalMusic,
    quality: '128k',
    isRefresh: true,
    allowToggleSource: true,
    onToggleSource: () => {},
  })

  assert.equal(result.musicInfo.id, 'fresh-source')
  assert.equal(result.url, 'fresh-url')
  assert.equal(requestCount, 2)
})

test('switching songs or stopping cancels an old async recovery before it reloads a URL', async(t) => {
  for (const cancelEvent of ['musicToggled', 'stop']) {
    await t.test(cancelEvent, async() => {
      const listeners = new Map()
      let unmount
      const switchedSource = createDeferred()
      const reloadedMusic = []
      const resumeChanges = []
      window.app_event = {
        on(name, listener) { listeners.set(name, listener) },
        off(name, listener) { if (listeners.get(name) == listener) listeners.delete(name) },
      }
      window.lx.isPlayedStop = false
      window.lx.apiInitPromise[0] = Promise.resolve(true)
      globalThis.document = { hidden: false }
      Object.assign(mocks.appSetting, {
        'common.apiSource': 'source-a',
        'player.playEngine': 'electron',
        'player.playQuality': '320k',
      })
      Object.assign(mocks.playerState, {
        musicInfo: Object.assign(mocks.playerState.musicInfo, { id: 'song-a' }),
        playMusicInfo: Object.assign(mocks.playerState.playMusicInfo, {
          musicInfo: { id: 'song-a', source: 'kw', meta: { _qualitys: { '128k': true } } },
        }),
      })
      mocks.playerState.isPlay.value = true
      mocks.playerState.playQuality.value = '320k'
      mocks.userApi.list = [{ id: 'source-a', name: 'A' }, { id: 'source-b', name: 'B' }]
      Object.assign(mocks, {
        onBeforeUnmount: callback => { unmount = callback },
        translate: key => key,
        setStop: async() => {},
        getShouldPlayAfterLoad: () => false,
        playNext: async() => {},
        setMusicUrl: music => { reloadedMusic.push(music.id) },
        setShouldPlayAfterLoad: value => { resumeChanges.push(value) },
        setAllStatus: () => {},
        getPlayErrorActions: () => ['apiSource'],
        getPlayErrorApiSourceCount: () => 1,
        getPlayErrorRetryCount: () => 0,
        isPlayErrorHandlingEnabled: () => true,
        QUALITY_RANK: ['320k', '128k'],
        getLowerPlayQuality: () => '128k',
        getPlayQuality: () => '320k',
        isBiliVideoActive: () => false,
        setUserApi: () => switchedSource.promise,
      })

      usePlayEvent()
      listeners.get('playerError')()
      await flushPromises()

      if (cancelEvent == 'musicToggled') {
        mocks.playerState.musicInfo.id = 'song-b'
        mocks.playerState.playMusicInfo.musicInfo = { id: 'song-b', source: 'wy', meta: { _qualitys: { '128k': true } } }
      } else {
        window.lx.isPlayedStop = true
      }
      listeners.get(cancelEvent)()
      switchedSource.resolve()
      await flushPromises()

      assert.deepEqual(reloadedMusic, [])
      assert.deepEqual(resumeChanges, [])
      unmount()
    })
  }
})

test('failure settings use vertical controls with bounded widths and correct drag indexes', async() => {
  const source = await readFile(new URL('../src/renderer/views/Setting/components/SettingPlay.vue', import.meta.url), 'utf8')
  assert.match(source, /onUpdate: \(newIndex, oldIndex\) => \{ moveErrorStrategy\(oldIndex, newIndex\) \}/)
  assert.match(source, /filter: 'error-strategy-fixed'/)
  assert.match(source, /:disabled="item\.id == 'next'"/)
  assert.match(source, /\.errorSettingRow \{[\s\S]*?flex-direction: column;/)
  assert.match(source, /--selection-width: 220px;/)
  assert.match(source, /\.errorCountInput \{[\s\S]*?width: 64px;/)
})
