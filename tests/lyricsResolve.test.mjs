import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { registerHooks } from 'node:module'

// 取歌词的优先级（src/renderer/core/music/index.ts getLyricInfo）：
// 绑定 → 原有来源 → 自动跨平台匹配；绑定失败回退，匹配失败本次运行内不重复搜索。
const ctl = globalThis.__lyricResolve = {
  calls: [],
  bound: null, // { binding, lyricInfo } | Error | null
  source: null, // LyricInfo | Error
  match: null, // { candidate, lyricInfo } | null
  saved: [],
}
const stub = body => `const c = globalThis.__lyricResolve;\n${body}`
const virtualModules = new Map([
  ['./online', stub(`
    export const getMusicUrl = () => {}; export const getPicUrl = () => {}
    export const getLyricInfo = async({ musicInfo }) => { c.calls.push('online:' + musicInfo.id); if (c.source instanceof Error) throw c.source; return c.source }
  `)],
  ['./download', stub(`
    export const getMusicUrl = () => {}; export const getPicUrl = () => {}
    export const getLyricInfo = async() => { c.calls.push('download'); return c.source }
  `)],
  ['./local', stub(`
    export const getMusicUrl = () => {}; export const getPicUrl = () => {}
    export const getLyricInfo = async() => { c.calls.push('local'); if (c.source instanceof Error) throw c.source; return c.source }
  `)],
  ['./utils', stub(`
    export const buildLyricInfo = async info => ({ ...info, rawlrcInfo: { ...info }, built: true })
  `)],
  ['@renderer/utils/ipc', stub(`
    export const saveLyric = async(musicInfo, info) => { c.saved.push([musicInfo.id, info.lyric]) }
  `)],
  ['@renderer/core/lyrics/binding', stub(`
    export const getSongMusicInfo = m => ('progress' in m ? m.metadata.musicInfo : m)
    export const getSongKey = m => getSongMusicInfo(m).id
    export const getMatchSubject = m => ({ name: getSongMusicInfo(m).name, singer: '', duration: 0 })
    export const getSongPlatform = m => ['kg', 'tx', 'wy', 'kw', 'mg'].includes(getSongMusicInfo(m).source) ? getSongMusicInfo(m).source : undefined
    export const loadBoundLyric = async m => { c.calls.push('bound:' + getSongKey(m)); if (c.bound instanceof Error) throw c.bound; return c.bound }
  `)],
  ['@renderer/core/lyrics/search', stub(`
    export const autoMatchLyric = async(subject, exclude) => { c.calls.push('match:' + subject.name + ':' + (exclude ?? '-')); return c.match }
  `)],
])
registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = virtualModules.get(specifier)
    if (source != null) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    if (specifier === '@common/utils/lyrics') return { url: new URL('../src/common/utils/lyrics/index.ts', import.meta.url).href, shortCircuit: true }
    if (specifier.startsWith('./') && context.parentURL?.includes('/src/common/utils/lyrics/') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
const { getLyricInfo } = await import('../src/renderer/core/music/index.ts')

const TIMED = '[00:01.00]line'
let seq = 0
const song = (source = 'kw') => ({ id: `${source}_${++seq}`, name: `song${seq}`, singer: 's', source, interval: '03:00', meta: {} })

beforeEach(() => {
  Object.assign(ctl, { calls: [], bound: null, source: { lyric: TIMED }, match: null, saved: [] })
})

test('a binding wins over every other source', async() => {
  const m = song()
  ctl.bound = { binding: {}, lyricInfo: { lyric: '[00:02.00]bound' } }
  const info = await getLyricInfo({ musicInfo: m })
  assert.equal(info.lyric, '[00:02.00]bound')
  assert.equal(info.built, true)
  assert.deepEqual(ctl.calls, [`bound:${m.id}`])
})

test('an unavailable binding falls back to the regular source', async() => {
  const m = song()
  ctl.bound = new Error('network')
  const info = await getLyricInfo({ musicInfo: m })
  assert.equal(info.lyric, TIMED)
  assert.deepEqual(ctl.calls, [`bound:${m.id}`, `online:${m.id}`])
})

test('timed lyric from the regular source is used without searching', async() => {
  const m = song()
  await getLyricInfo({ musicInfo: m })
  assert.ok(!ctl.calls.some(call => call.startsWith('match:')))
})

test('no timed lyric: auto match on other platforms, cached under the song', async() => {
  const m = song('tx')
  ctl.source = { lyric: 'plain text only' }
  ctl.match = { candidate: {}, lyricInfo: { lyric: '[00:03.00]matched' } }
  const info = await getLyricInfo({ musicInfo: m })
  assert.equal(info.lyric, '[00:03.00]matched')
  assert.ok(ctl.calls.includes(`match:${m.name}:tx`), 'own platform excluded from the search')
  assert.deepEqual(ctl.saved, [[m.id, '[00:03.00]matched']])
})

test('source failed and nothing matched: the original error propagates, and the song is not searched again this run', async() => {
  const m = song()
  ctl.source = new Error('source down')
  await assert.rejects(getLyricInfo({ musicInfo: m }), /source down/)
  ctl.calls = []
  await assert.rejects(getLyricInfo({ musicInfo: m }), /source down/)
  assert.ok(!ctl.calls.some(call => call.startsWith('match:')), 'miss remembered')
  // 手动刷新时重新搜索
  ctl.calls = []
  await assert.rejects(getLyricInfo({ musicInfo: m, isRefresh: true }), /source down/)
  assert.ok(ctl.calls.some(call => call.startsWith('match:')))
})

test('plain lyric is still returned when nothing better is found', async() => {
  const m = song('local')
  ctl.source = { lyric: 'untimed words' }
  const info = await getLyricInfo({ musicInfo: m })
  assert.equal(info.lyric, 'untimed words')
  assert.ok(ctl.calls.includes(`match:${m.name}:-`), 'local songs search every platform')
})

test('download items bind and match by their online song', async() => {
  const online = song('wy')
  const item = { id: 'dl_1', progress: {}, metadata: { musicInfo: online } }
  ctl.bound = { binding: {}, lyricInfo: { lyric: TIMED } }
  await getLyricInfo({ musicInfo: item })
  assert.deepEqual(ctl.calls, [`bound:${online.id}`])
})
