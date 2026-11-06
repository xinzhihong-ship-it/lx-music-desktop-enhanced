import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// MpvController 的加载流程：每次 loadUrl 独立 token（#9），迟到的旧文件事件不干扰新加载（R5）。
// 用假 mpv IPC 驱动真实的 MpvController；竞态用例用「暂扣请求头响应 + 手动发事件」精确构造，不依赖计时。

const events = globalThis.__mpvTokenEvents = []
const virtualModules = new Map([
  ['electron', 'export const app = { on() {}, isPackaged: false, getPath: () => "" }'],
  ['@common/utils', 'export const log = { info() {}, warn() {}, error() {}, debug() {} }'],
  ['@main/modules/winMain/main', 'export const sendEvent = name => { globalThis.__mpvTokenEvents.push(name) }'],
  ['@main/utils', 'export const getProxy = () => ({})'],
  ['@main/modules/account/sessions', 'export const getSessionBySource = () => null'],
  ['@common/ipcNames', 'export const WIN_MAIN_RENDERER_EVENT_NAME = new Proxy({}, { get: (_t, k) => String(k) })'],
  ['@common/utils/mpvCompatibility', 'export const getBundledMacMpvAppNames = () => []'],
  ['@common/utils/mpvAudioDevice', 'export const isCoreAudioMappedDevice = () => false; export const resolveMpvAudioDevice = d => d'],
])
registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = virtualModules.get(specifier)
    if (source != null) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    // 源码中的无扩展名相对导入（由 webpack 解析），测试中补上 .ts
    if (specifier === './mpvOrphan') return { url: new URL('./mpvOrphan.ts', context.parentURL).href, shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    // 只把加载探测的两个 10 秒计时缩短为 100ms，其余代码原样加载
    if (url.endsWith('/winMain/mpvController.ts')) {
      const source = String(result.source)
      const shortened = source.replace(/(rejectOnTimeout|\}), 10000\)/g, '$1, 100)')
      assert.notEqual(shortened, source, 'probe timers not found')
      return { ...result, source: shortened }
    }
    return result
  },
})
globalThis.lx = { appSetting: { 'player.mpv.path': '', 'player.mpv.aoFallbackDevices': [] } }
const { MpvController } = await import('../src/main/modules/winMain/mpvController.ts')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const settle = promise => promise.then(() => 'resolved', err => `rejected:${err.message}`)
const count = name => events.filter(event => event === name).length

/**
 * 假 mpv。URL 关键字决定行为：
 * normal → 20ms 后 file-loaded；stream → 可播放但从不发 file-loaded；broken → 加载错误；
 * flaky → file-loaded 后立即出错；manual → 不自动发任何事件（由用例调用 emit）；其他 → 什么都不发生（真实超时）。
 * holdHeaders=true 时暂扣请求头设置的响应，release() 后放行。
 */
const createController = () => {
  const controller = new MpvController()
  const state = { path: null, duration: null, idle: true, pause: false, timers: [], loadfiles: [], holdHeaders: false, held: [] }
  const emit = obj => controller.handleData(JSON.stringify(obj) + '\n')
  controller.process = { killed: false, exitCode: null, kill() {} }
  controller.cachedPathInfo = { path: 'mpv', source: 'custom' }
  controller.socket = {
    write(payload, cb) {
      const { command, request_id: id } = JSON.parse(payload)
      cb?.()
      const [name, ...args] = command
      let data = null
      if (name === 'get_property') data = { path: state.path, duration: state.duration, 'idle-active': state.idle, pause: state.pause }[args[0]] ?? null
      if (name === 'set_property' && args[0] === 'pause') state.pause = args[1]
      if (name === 'loadfile') {
        const url = args[0]
        state.loadfiles.push(url)
        for (const timer of state.timers) clearTimeout(timer)
        state.timers = []
        Object.assign(state, { path: url, duration: null, idle: false })
        if (url.includes('normal')) state.timers.push(setTimeout(() => { state.duration = 200; emit({ event: 'file-loaded' }) }, 20))
        if (url.includes('stream')) state.timers.push(setTimeout(() => { state.duration = 300 }, 30))
        if (url.includes('broken')) state.timers.push(setTimeout(() => emit({ event: 'end-file', reason: 'error', error: 'loading failed' }), 20))
        if (url.includes('flaky')) state.timers.push(setTimeout(() => { state.duration = 200; emit({ event: 'file-loaded' }); emit({ event: 'end-file', reason: 'error', error: 'decode failed' }) }, 20))
      }
      const respond = () => emit({ request_id: id, error: 'success', data })
      if (state.holdHeaders && name === 'set_property' && ['referrer', 'user-agent', 'http-header-fields'].includes(args[0])) state.held.push(respond)
      else setImmediate(respond)
    },
    destroy() {},
  }
  const release = () => { state.holdHeaders = false; for (const respond of state.held.splice(0)) respond() }
  return { controller, state, emit, release }
}
const waitFor = async(cond, label) => { for (let i = 0; i < 200; i++) { if (cond()) return; await sleep(5) } throw new Error(`timeout waiting for ${label}`) }

test('single load completes and emits loaded once', async() => {
  events.length = 0
  const { controller } = createController()
  assert.equal(await settle(controller.loadUrl('http://x/normal-1')), 'resolved')
  assert.equal(count('mpv_loaded'), 1)
  assert.equal(controller.isLoading, false)
})

test('#9 switching to a slow stream is not misjudged as a timeout; the superseded load ends quietly', async() => {
  events.length = 0
  const { controller, state } = createController()
  const a = settle(controller.loadUrl('http://x/normal-A'))
  await waitFor(() => state.loadfiles.includes('http://x/normal-A'), 'A loadfile')
  const b = settle(controller.loadUrl('http://x/stream-B'))
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(rb, 'resolved')
  assert.match(ra, /superseded/)
  assert.equal(count('mpv_loaded'), 1)
  assert.equal(controller.isLoading, false)
  assert.equal(state.path, 'http://x/stream-B')
})

test('#9 a load superseded before sending loadfile never sends it', async() => {
  const { controller, state } = createController()
  const [ra, rb] = await Promise.all([settle(controller.loadUrl('http://x/normal-A')), settle(controller.loadUrl('http://x/normal-B'))])
  assert.deepEqual(state.loadfiles, ['http://x/normal-B'])
  assert.match(ra, /superseded/)
  assert.equal(rb, 'resolved')
})

test('R5 a late file-loaded of the previous file does not complete the new load early', async() => {
  events.length = 0
  const { controller, state, emit, release } = createController()
  const a = settle(controller.loadUrl('http://x/manual-A'))
  await waitFor(() => state.loadfiles.includes('http://x/manual-A'), 'A loadfile')
  state.holdHeaders = true
  let bDone = false
  const b = settle(controller.loadUrl('http://x/manual-B')).finally(() => { bDone = true })
  await waitFor(() => state.held.length > 0, 'B header phase')
  emit({ event: 'file-loaded' }) // A 迟到的 file-loaded，此时 B 还在设置请求头
  assert.match(await a, /superseded/)
  release()
  await waitFor(() => state.loadfiles.includes('http://x/manual-B'), 'B loadfile')
  await sleep(20)
  assert.equal(bDone, false, 'B must still be waiting for its own file-loaded')
  assert.equal(count('mpv_loaded'), 0)
  state.duration = 180
  emit({ event: 'file-loaded' }) // B 自己的 file-loaded
  assert.equal(await b, 'resolved')
  assert.equal(count('mpv_loaded'), 1)
  assert.equal(controller.isLoading, false)
})

test('R5 a late eof of the previous file is not reported as ended (would skip the new song)', async() => {
  const { controller, state, emit, release } = createController()
  await controller.loadUrl('http://x/normal-A')
  events.length = 0
  state.holdHeaders = true
  const b = settle(controller.loadUrl('http://x/manual-B'))
  await waitFor(() => state.held.length > 0, 'B header phase')
  emit({ event: 'end-file', reason: 'eof' }) // A 恰好播完
  emit({ event: 'end-file', reason: 'error', error: 'old file error' }) // A 迟到的错误
  release()
  await waitFor(() => state.loadfiles.includes('http://x/manual-B'), 'B loadfile')
  assert.equal(controller.isLoading, true, 'B must still be loading')
  emit({ event: 'file-loaded' })
  assert.equal(await b, 'resolved')
  assert.equal(count('mpv_ended'), 0)
  assert.equal(count('mpv_error'), 0)
  assert.equal(count('mpv_loaded'), 1)
})

test('regression: real load errors, real timeouts and errors right after loading are still reported', async() => {
  const { controller } = createController()
  const broken = await settle(controller.loadUrl('http://x/broken'))
  assert.match(broken, /mpv playback error/)
  assert.equal(controller.isLoading, false)
  const dead = await settle(controller.loadUrl('http://x/dead'))
  assert.match(dead, /file-load timeout/)
  assert.equal(controller.isLoading, false)
  assert.equal(await settle(controller.loadUrl('http://x/normal-after')), 'resolved')
  events.length = 0
  await settle(controller.loadUrl('http://x/flaky'))
  await sleep(5)
  assert.equal(count('mpv_error'), 1)
})

test('regression: a normal end of playback is still reported as ended', async() => {
  const { controller, emit } = createController()
  await controller.loadUrl('http://x/normal-C')
  events.length = 0
  emit({ event: 'end-file', reason: 'eof' })
  assert.equal(count('mpv_ended'), 1)
})
