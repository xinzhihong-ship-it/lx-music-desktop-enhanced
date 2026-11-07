import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { registerHooks } from 'node:module'

// 主窗口歌词行跟踪（src/renderer/core/lyric.ts）：状态栏歌词 / 开放 API 的当前行来自这里。
// 依赖全部替换成假模块；歌词位置由测试控制。
const ctl = globalThis.__tracker = {
  pos: 0,
  isPlay: { value: false },
  emitted: [],
  status: [],
  sent: [],
}
const virtualModules = new Map([
  ['@renderer/plugins/player', 'export const getAnalyser = () => null'],
  ['@renderer/store/player/lyric', 'export const lyric = { line: 0, text: "" }; export const setText = (text, line) => { globalThis.__tracker.lyricLine = [line, text] }'],
  ['@renderer/store/player/state', 'export const isPlay = globalThis.__tracker.isPlay; export const musicInfo = globalThis.__tracker.musicInfo = { id: "song", lrc: "" }'],
  ['@renderer/store/player/playProgress', 'export const playProgress = { maxPlayTime: 0 }'],
  ['@renderer/store/player/action', 'export const setStatusText = text => { globalThis.__tracker.status.push(text) }'],
  ['@common/utils/vueTools', 'export const watch = () => {}'],
  ['@renderer/plugins/player/vst3', 'export const vst3Runtime = { active: false, latencyMs: 0, bridgeMs: 0 }'],
  ['@renderer/store/setting', 'export const appSetting = { "player.playbackRate": 1 }'],
  ['@renderer/utils/ipc', 'export const onNewDesktopLyricProcess = () => {}'],
  ['./lyrics/time', 'export const getCurrentTime = () => globalThis.__tracker.pos'],
])
registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = virtualModules.get(specifier)
    if (source != null) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    if (specifier === './lyrics/engine') {
      const engine = `
        import { buildLyricDoc } from ${JSON.stringify(new URL('../src/common/utils/lyrics/index.ts', import.meta.url).href)}
        const c = globalThis.__tracker
        export const lyricDoc = { get value() { return c.doc } }
        export const readLyricPosition = () => c.pos + c.doc.offset
        c.buildLyricDoc = buildLyricDoc
      `
      return { url: `data:text/javascript,${encodeURIComponent(engine)}`, shortCircuit: true }
    }
    if (specifier === '@common/utils/lyrics') return { url: new URL('../src/common/utils/lyrics/index.ts', import.meta.url).href, shortCircuit: true }
    if (specifier === './lyricDriftGuard') return { url: new URL('../src/renderer/core/lyricDriftGuard.ts', import.meta.url).href, shortCircuit: true }
    if (specifier.startsWith('./') && context.parentURL?.includes('/src/common/utils/lyrics/') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
// 真实播放时播放位置与系统时钟同步前进（漂移防护不会介入）：测试里两者一起推进
ctl.now = 0
Object.defineProperty(globalThis, 'performance', { value: { now: () => ctl.now }, configurable: true })
globalThis.window = { app_event: { lyricLinePlay: (text, line) => { ctl.emitted.push([line, text]) }, setProgress() {} } }
const tracker = await import('../src/renderer/core/lyric.ts')
const { buildLyricDoc } = await import('../src/common/utils/lyrics/index.ts')

const doc = buildLyricDoc({ lyric: '[00:01.00]第一句\n[00:02.00]第二句\n[00:03.00]第三句\n[00:04.00]第四句' })

test('playing keeps advancing line by line even though the store still says paused when "play" fires', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    ctl.doc = doc
    ctl.pos = 1100
    ctl.now = 1100
    ctl.isPlay.value = false // 'play' 事件里本模块先于 store 处理：此时 isPlay 仍为 false
    tracker.play()
    assert.deepEqual(ctl.emitted.at(-1), [0, '第一句'])
    ctl.isPlay.value = true
    for (const [time, expected] of [[2050, '第二句'], [3050, '第三句'], [4050, '第四句']]) {
      ctl.now += time - ctl.pos
      ctl.pos = time
      mock.timers.tick(1000)
      assert.equal(ctl.emitted.at(-1)[1], expected, `at ${time}ms`)
    }
    assert.deepEqual(ctl.status.slice(-3), ['第二句', '第三句', '第四句'], 'status bar text follows')
    // 暂停后不再前进
    tracker.pause()
    const count = ctl.emitted.length
    ctl.pos = 9000
    mock.timers.tick(5000)
    assert.equal(ctl.emitted.length, count)
  } finally {
    mock.timers.reset()
  }
})

test('the same line is not announced twice; stop clears the status text', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    ctl.doc = doc
    ctl.pos = 2100
    tracker.play()
    const count = ctl.emitted.length
    tracker.play()
    assert.equal(ctl.emitted.length, count, 'same line, same content: no repeat')
    tracker.stop()
    assert.equal(ctl.status.at(-1), '')
  } finally {
    mock.timers.reset()
  }
})
