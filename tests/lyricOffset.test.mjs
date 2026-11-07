import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { registerHooks } from 'node:module'

// 歌词偏移（src/renderer/core/lyrics/offsetControl.ts）：播放详情页右键菜单与桌面歌词工具栏共用
const ctl = globalThis.__offset = { calls: [], binding: null, musicInfo: {}, playMusicInfo: { musicInfo: null } }
const virtualModules = new Map([
  ['@common/utils/common', 'export const debounce = fn => fn'],
  ['@renderer/utils/ipc', 'const c = globalThis.__offset; export const saveLyricEdited = async(m, info) => { c.calls.push(["saveEdited", info.lyric]) }; export const removeLyricEdited = async() => { c.calls.push(["removeEdited"]) }'],
  ['@renderer/store/player/state', 'const c = globalThis.__offset; export const musicInfo = c.musicInfo; export const playMusicInfo = c.playMusicInfo'],
  ['@renderer/store/player/action', 'const c = globalThis.__offset; export const setMusicInfo = info => { Object.assign(c.musicInfo, info) }'],
  ['@renderer/core/lyric', 'const c = globalThis.__offset; export const setLyricOffset = offset => { c.calls.push(["sync", offset]) }'],
  ['./binding', 'const c = globalThis.__offset; export const getBinding = async() => c.binding; export const setBindingOffset = async(m, offset) => { c.calls.push(["bindingOffset", offset]) }'],
])
registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = virtualModules.get(specifier)
    if (source != null) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { applyLyricOffset, getLyricOffset, setCurrentLyricOffset, adjustCurrentLyricOffset, resetCurrentLyricOffset } = await import('../src/renderer/core/lyrics/offsetControl.ts')

const raw = '[ti:晴天]\n[00:01.00]第一句'
beforeEach(() => {
  ctl.calls = []
  ctl.binding = null
  Object.assign(ctl.musicInfo, { lrc: raw, tlrc: '[00:01.00]line one', rlrc: '', lxlrc: '[00:01.00]<0,500>第一<500,500>句', rawlrc: raw })
  ctl.playMusicInfo.musicInfo = { id: 'kg_1', source: 'kg' }
})

test('getLyricOffset reads the [offset:] tag (0 when absent or invalid)', () => {
  assert.equal(getLyricOffset('[offset:350]\n[00:01.00]x'), 350)
  assert.equal(getLyricOffset('[offset:-200]'), -200)
  assert.equal(getLyricOffset('[00:01.00]x'), 0)
  assert.equal(getLyricOffset(null), 0)
})

test('applyLyricOffset adds the tag to every non-empty variant, or replaces an existing one', () => {
  const added = applyLyricOffset({ lyric: '[00:01.00]a', tlyric: '[00:01.00]b', rlyric: '', lxlyric: null }, 500)
  assert.equal(added.lyric, '[offset:500]\n[00:01.00]a')
  assert.equal(added.tlyric, '[offset:500]\n[00:01.00]b')
  assert.equal(added.rlyric, '')
  assert.equal(added.lxlyric, null)
  const replaced = applyLyricOffset({ lyric: added.lyric, tlyric: added.tlyric, rlyric: null, lxlyric: null }, -100)
  assert.equal(replaced.lyric, '[offset:-100]\n[00:01.00]a')
  assert.equal(getLyricOffset(replaced.tlyric), -100)
})

test('adjusting updates the current song immediately and saves an edited lyric', async() => {
  await adjustCurrentLyricOffset(100)
  await adjustCurrentLyricOffset(100)
  assert.equal(getLyricOffset(ctl.musicInfo.lrc), 200)
  assert.equal(getLyricOffset(ctl.musicInfo.lxlrc), 200, 'word-timed lyric carries the same offset')
  assert.deepEqual(ctl.calls.filter(c => c[0] == 'sync'), [['sync', 100], ['sync', 200]])
  assert.deepEqual(ctl.calls.at(-1), ['saveEdited', ctl.musicInfo.lrc])
})

test('back at the original offset the edited lyric is removed; bound songs save into the binding', async() => {
  await setCurrentLyricOffset(300)
  await resetCurrentLyricOffset()
  assert.equal(getLyricOffset(ctl.musicInfo.lrc), 0)
  assert.deepEqual(ctl.calls.at(-1), ['removeEdited'])

  ctl.binding = { platform: 'tx' }
  await adjustCurrentLyricOffset(-500)
  assert.deepEqual(ctl.calls.at(-1), ['bindingOffset', -500])
  assert.equal(ctl.calls.some(c => c[0] == 'saveEdited' && getLyricOffset(c[1]) == -500), false)
})

test('nothing happens without a lyric', async() => {
  ctl.musicInfo.lrc = ''
  assert.equal(await adjustCurrentLyricOffset(100), false)
  assert.deepEqual(ctl.calls, [])
})
