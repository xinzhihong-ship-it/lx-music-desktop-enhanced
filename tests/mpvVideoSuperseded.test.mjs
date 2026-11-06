import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// R4：外部视频播放器路径下，被新请求顶替的旧加载要静默丢弃——不能清掉新视频的 loading 状态，
// 也不能发 error 事件（renderer 收到会进入错误恢复，停止新视频甚至跳到下一首）。真实错误照常上报。

const mocks = globalThis.__videoMocks = { events: [], loads: [] }
const virtualModules = new Map([
  ['electron', 'export const app = { on() {}, isPackaged: false, getPath: () => "" }; export class BrowserWindow {}'],
  ['@common/utils', 'export const log = { info() {}, warn() {}, error() {}, debug() {} }'],
  ['@common/ipcNames', 'export const WIN_MAIN_RENDERER_EVENT_NAME = new Proxy({}, { get: (_t, k) => String(k) })'],
  ['./main', `const parent = { getNativeWindowHandle: () => new Uint8Array(8), on() {}, off() {}, isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }) }
    export const sendEvent = name => { globalThis.__videoMocks.events.push(name) }
    export const getBrowserWindow = () => parent`],
  ['@main/modules/account/sessions', 'export const getSessionBySource = () => null'],
  ['./mpvController', `export class MpvLoadSupersededError extends Error { constructor() { super('mpv load superseded by a newer request'); this.name = 'MpvLoadSupersededError' } }
    export class MpvController {
      loadUrl(url) { return new Promise((resolve, reject) => { globalThis.__videoMocks.loads.push({ url, resolve, reject }) }) }
      async setAudioDevice() {} async play() {} async pause() {} async stop() {} async destroy() {}
    }`],
])
const SOURCE_ALIASES = {
  '@common/utils/audioDeviceSelection': 'common/utils/audioDeviceSelection.ts',
  '@common/utils/mpvDeviceList': 'common/utils/mpvDeviceList.ts',
  '@main/utils/audioDeviceCache': 'main/utils/audioDeviceCache.ts',
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    // beta 新增的无依赖纯函数模块（音频设备选择 / 设备列表 / 设备缓存）：加载真实源码
    const sourcePath = SOURCE_ALIASES[specifier]
    if (sourcePath) return { url: new URL(`../src/${sourcePath}`, import.meta.url).href, shortCircuit: true }
    if (context.parentURL?.includes('mpvVideoController')) {
      const source = virtualModules.get(specifier)
      if (source != null) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      // Windows 原生视频宿主桥：假装存在
      if (specifier === 'node:fs') return { url: `data:text/javascript,${encodeURIComponent('import fs from "node:fs"; export default { ...fs, existsSync: () => true }')}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
globalThis.__non_webpack_require__ = () => ({ create: () => '1234', setBounds() {}, setVisible() {}, destroy() {} })
globalThis.lx = { appSetting: { 'player.mediaDeviceId': '' } }
// macOS 走原生视频，不经过 MpvController；该用例覆盖 Windows / Linux 的外部播放器路径
const skip = process.platform === 'darwin' ? 'macOS uses the native video host' : (process.platform === 'linux' && !process.env.DISPLAY ? 'needs X11 (DISPLAY)' : false)
const video = skip ? null : await import('../src/main/modules/winMain/mpvVideoController.ts')
const { MpvLoadSupersededError } = skip ? {} : await import(`data:text/javascript,${encodeURIComponent(virtualModules.get('./mpvController'))}`)

const tick = () => new Promise(resolve => setTimeout(resolve, 5))
const settle = promise => promise.then(() => 'resolved', err => `rejected:${err.name}`)
const errorEvents = () => mocks.events.filter(event => event === 'mpv_video_error').length
const loadOf = url => mocks.loads.find(load => load.url === url)

test('R4 fast video switching: the superseded load emits no error and keeps the new video loading', { skip }, async() => {
  mocks.events.length = 0
  const a = settle(video.loadUrl('http://cdn/video-A'))
  await tick()
  const b = settle(video.loadUrl('http://cdn/video-B'))
  await tick()
  // data: URL 模块按 URL 缓存：这里拿到的与控制器 instanceof 判断用的是同一个类
  loadOf('http://cdn/video-A').reject(new MpvLoadSupersededError())
  assert.equal(await a, 'rejected:MpvLoadSupersededError')
  assert.equal(errorEvents(), 0)
  assert.deepEqual(video.getState(), { loading: true, hasFileLoaded: false, currentUrl: 'http://cdn/video-B' })
  loadOf('http://cdn/video-B').resolve()
  assert.equal(await b, 'resolved')
})

test('R4 regression: a real video load error still clears loading and is reported', { skip }, async() => {
  mocks.events.length = 0
  const c = settle(video.loadUrl('http://cdn/video-C'))
  await tick()
  loadOf('http://cdn/video-C').reject(new Error('mpv playback error: 403'))
  assert.equal(await c, 'rejected:Error')
  assert.equal(errorEvents(), 1)
  assert.equal(video.getState().loading, false)
})
