import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { registerHooks } from 'node:module'

// 跨平台歌词搜索（src/renderer/core/lyrics/search.ts）：各平台用假的 musicSearch / getLyric
const ctl = globalThis.__lyricSearch = {
  lists: {}, // platform -> list | Error | 'hang'
  lyrics: {}, // songmid -> LyricInfo | Error
  cache: {}, // key -> LyricInfo
  saved: [],
  fetched: [],
}
const sdk = `
const c = globalThis.__lyricSearch
const make = platform => ({
  musicSearch: { search: async keyword => {
    const v = c.lists[platform]
    if (v === 'hang') return new Promise(() => {})
    if (v instanceof Error) throw v
    return { list: (v ?? []).map(item => ({ ...item, keyword })) }
  } },
  getLyric: info => ({ promise: (async() => {
    c.fetched.push(platform + '_' + info.songmid)
    const v = c.lyrics[info.songmid]
    if (v instanceof Error) throw v
    return v
  })(), cancelHttp() {} }),
})
export default { kg: make('kg'), tx: make('tx'), wy: make('wy'), kw: make('kw'), mg: make('mg') }
`
const ipc = `
const c = globalThis.__lyricSearch
export const getLyricRaw = async({ id }) => c.cache[id] ?? { lyric: '' }
export const saveLyric = async({ id }, info) => { c.saved.push(id); c.cache[id] = info }
`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@renderer/utils/musicSdk') return { url: `data:text/javascript,${encodeURIComponent(sdk)}`, shortCircuit: true }
    if (specifier === '@renderer/utils/ipc') return { url: `data:text/javascript,${encodeURIComponent(ipc)}`, shortCircuit: true }
    if (specifier === '@common/utils/lyrics') return { url: new URL('../src/common/utils/lyrics/index.ts', import.meta.url).href, shortCircuit: true }
    if (specifier.startsWith('./') && context.parentURL?.includes('/src/common/utils/lyrics/') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
const { searchLyricCandidates, fetchCandidateLyric, autoMatchLyric } = await import('../src/renderer/core/lyrics/search.ts')

const query = { name: '晴天', singer: '周杰伦', duration: 269 }
const item = (songmid, extra = {}) => ({ songmid, name: '晴天', singer: '周杰伦', albumName: '叶惠美', interval: '04:29', types: [{ big: 'x' }], ...extra })

beforeEach(() => {
  Object.assign(ctl, { lists: {}, lyrics: {}, cache: {}, saved: [], fetched: [] })
})

test('searches all platforms, scores, sorts and keeps only the fields needed to fetch', async() => {
  ctl.lists = {
    kg: [item('kg1', { hash: 'H1', _interval: 269 })],
    tx: [item('tx1', { name: '晴天 (Live)', interval: '04:35' })],
    wy: [item('wy1', { singer: '别人', interval: '04:28' })],
  }
  const { candidates, failed } = await searchLyricCandidates({ query })
  assert.deepEqual(failed, [])
  assert.deepEqual(candidates.map(c => c.key), ['kg_kg1', 'tx_tx1', 'wy_wy1'])
  assert.equal(candidates[0].score, 85)
  assert.equal(candidates[0].musicInfo.hash, 'H1')
  assert.equal(candidates[0].musicInfo.types, undefined, 'quality lists are not stored in bindings')
  assert.equal(candidates[0].musicInfo.keyword, undefined)
})

test('one platform failing does not affect the others', async() => {
  ctl.lists = { kg: new Error('down'), tx: [item('tx1')] }
  const { candidates, failed } = await searchLyricCandidates({ query })
  assert.deepEqual(failed, ['kg'])
  assert.deepEqual(candidates.map(c => c.key), ['tx_tx1'])
})

test('custom keyword is searched as typed; duplicates collapse; duration mismatches sort last', async() => {
  ctl.lists = { kg: [item('a', { interval: '09:00' }), item('b'), item('b')] }
  const { candidates } = await searchLyricCandidates({ keyword: '自定义 关键词', query, platforms: ['kg'] })
  assert.deepEqual(candidates.map(c => [c.key, c.score]), [['kg_b', 85], ['kg_a', null]])
})

test('nothing to search for returns empty without calling platforms', async() => {
  const result = await searchLyricCandidates({ keyword: '  ', query: null })
  assert.deepEqual(result, { candidates: [], failed: [] })
})

test('fetchCandidateLyric uses the cache, requires timed lyrics and caches what it fetched', async() => {
  const candidate = { key: 'kg_x', platform: 'kg', musicInfo: { songmid: 'x' } }
  ctl.cache.kg_x = { lyric: '[00:01.00]cached' }
  assert.equal((await fetchCandidateLyric(candidate)).lyric, '[00:01.00]cached')
  assert.deepEqual(ctl.fetched, [])

  ctl.lyrics.x = { lyric: '[00:02.00]fresh', tlyric: null }
  const fresh = await fetchCandidateLyric(candidate, { useCache: false })
  assert.equal(fresh.lyric, '[00:02.00]fresh')
  assert.equal(fresh.tlyric, '')
  assert.deepEqual(ctl.saved, ['kg_x'])

  ctl.lyrics.y = { lyric: 'no timestamps' }
  await assert.rejects(fetchCandidateLyric({ key: 'kg_y', platform: 'kg', musicInfo: { songmid: 'y' } }), /no timed lyric/)
})

test('autoMatchLyric only takes candidates above the threshold, trying the next when one fails', async() => {
  ctl.lists = {
    kg: [item('k1')],
    tx: [item('t1')],
    wy: [item('w1', { singer: '别人' })], // 60 分，不自动采用
  }
  ctl.lyrics.k1 = new Error('lyric api down')
  ctl.lyrics.t1 = { lyric: '[00:01.00]from tx' }
  ctl.lyrics.w1 = { lyric: '[00:01.00]from wy' }
  const result = await autoMatchLyric(query, 'kw')
  assert.equal(result.candidate.key, 'tx_t1')
  assert.equal(result.lyricInfo.lyric, '[00:01.00]from tx')
  assert.deepEqual(ctl.fetched, ['kg_k1', 'tx_t1'])
})

test('autoMatchLyric excludes the song\'s own platform and returns null when nothing qualifies', async() => {
  ctl.lists = { kw: [item('own')], wy: [item('w1', { singer: '别人' })] }
  ctl.lyrics.own = { lyric: '[00:01.00]own' }
  assert.equal(await autoMatchLyric(query, 'kw'), null)
  assert.deepEqual(ctl.fetched, [])
  assert.equal(await autoMatchLyric({ ...query, name: ' ' }), null)
})
