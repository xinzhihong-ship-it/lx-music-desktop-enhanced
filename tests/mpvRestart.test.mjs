import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'

// #11：MPV 重启。独占设备 / bit-perfect 模式下先彻底终止旧进程（等待退出、释放设备）再启动新进程；
// 普通模式保持无感切换，但新实例出声前静音旧实例，避免双重出声。

const virtualModules = new Map([
  ['electron', 'export const app = { on() {}, isPackaged: false, getPath: () => "" }'],
  ['@common/utils', 'export const log = { info() {}, warn() {}, error() {}, debug() {} }'],
  ['@main/modules/winMain/main', 'export const sendEvent = () => {}'],
  ['@main/utils', 'export const getProxy = () => ({})'],
  ['@main/modules/account/sessions', 'export const getSessionBySource = () => null'],
  ['@common/ipcNames', 'export const WIN_MAIN_RENDERER_EVENT_NAME = new Proxy({}, { get: (_t, k) => String(k) })'],
  ['@common/utils/mpvCompatibility', 'export const getBundledMacMpvAppNames = () => []'],
  ['@common/utils/mpvAudioDevice', 'export const isCoreAudioMappedDevice = () => false; export const resolveMpvAudioDevice = d => d'],
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
    const source = virtualModules.get(specifier)
    if (source != null) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    // 源码中的无扩展名相对导入（由 webpack 解析），测试中补上 .ts
    if (specifier === './mpvOrphan') return { url: new URL('./mpvOrphan.ts', context.parentURL).href, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const appSetting = { 'player.mpv.path': '', 'player.mpv.aoFallbackDevices': [], 'player.mpv.bitPerfectMode': true, 'player.mpv.extraArgs': [] }
globalThis.lx = { appSetting }
const mpv = await import('../src/main/modules/winMain/mpvController.ts')
const { MpvController, getMpvController, restartMpvController, requiresStopBeforeRestart, waitForProcessExit } = mpv
// 下方会替换原型方法记录重启时序，这里先保存真实的 destroy 供单独测试
const realDestroy = MpvController.prototype.destroy

const fakeProcess = ({ exitAfter = null } = {}) => {
  const proc = new EventEmitter()
  proc.exitCode = null
  proc.signalCode = null
  proc.killed = false
  proc.pid = 4242
  proc.signals = []
  const exit = () => { if (proc.exitCode != null) return; proc.exitCode = 0; proc.emit('exit', 0, null) }
  proc.kill = signal => {
    proc.signals.push(signal ?? 'SIGTERM')
    proc.killed = true
    if (signal === 'SIGKILL') setTimeout(exit, 5)
    else if (exitAfter != null) setTimeout(exit, exitAfter)
    return true
  }
  return proc
}

test('requiresStopBeforeRestart: bit-perfect or exclusive output requires stopping the old process first', () => {
  assert.equal(requiresStopBeforeRestart({ 'player.mpv.bitPerfectMode': true, 'player.mpv.extraArgs': [] }), true)
  assert.equal(requiresStopBeforeRestart({ 'player.mpv.bitPerfectMode': false, 'player.mpv.extraArgs': ['--audio-exclusive=yes'] }), true)
  assert.equal(requiresStopBeforeRestart({ 'player.mpv.bitPerfectMode': false, 'player.mpv.extraArgs': ['--audio-exclusive'] }), true)
  assert.equal(requiresStopBeforeRestart({ 'player.mpv.bitPerfectMode': false, 'player.mpv.extraArgs': ['--audio-exclusive=no', '--volume=80'] }), false)
  assert.equal(requiresStopBeforeRestart({}), false)
})

test('waitForProcessExit waits for the real exit, and escalates to SIGKILL after the timeout', async() => {
  const graceful = fakeProcess({ exitAfter: 20 })
  graceful.kill()
  const t0 = Date.now()
  await waitForProcessExit(graceful, 1000)
  assert.equal(graceful.exitCode, 0)
  assert.ok(Date.now() - t0 >= 15)
  assert.deepEqual(graceful.signals, ['SIGTERM'])

  const stuck = fakeProcess() // 不响应 SIGTERM
  stuck.kill()
  await waitForProcessExit(stuck, 50)
  assert.deepEqual(stuck.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(stuck.exitCode, 0)
})

test('destroy({ waitForExit }) resolves only after the mpv process has exited', async() => {
  const controller = new MpvController()
  const proc = fakeProcess({ exitAfter: 30 })
  controller.process = proc
  await realDestroy.call(controller, { waitForExit: true })
  assert.equal(proc.exitCode, 0, 'process must have exited when destroy resolves')
})

// ---- 重启时序：替换控制器的进程 / IPC 相关方法，记录时间线 ----
const timeline = []
const P = MpvController.prototype
let failStart = false
P.ensureStarted = async function() { timeline.push(`start#${this.instanceId}`); if (failStart) throw new Error('audio device busy') }
P.loadUrl = async function() { timeline.push(`load#${this.instanceId}`) }
P.play = async function() { timeline.push(`play#${this.instanceId}`) }
P.getPaused = async function() { return false }
P.getDuration = async function() { return 100 }
P.silenceForHandover = async function() { timeline.push(`silence#${this.instanceId}`) }
P.destroy = async function(options = {}) { timeline.push(`destroy#${this.instanceId}${options.waitForExit ? ':wait-exit' : ''}`) }
P.sendEvent = function() {}
const ids = () => ({ old: getMpvController().instanceId })
const restart = async() => {
  timeline.length = 0
  const { old } = ids()
  await restartMpvController({ url: 'http://x/song.flac', time: 30, playing: true })
  return { old, now: getMpvController().instanceId }
}
const at = name => timeline.indexOf(name)

test('#11 bit-perfect: the old process is fully stopped before the new one starts (no double audio, device released)', async() => {
  Object.assign(appSetting, { 'player.mpv.bitPerfectMode': true, 'player.mpv.extraArgs': [] })
  const { old, now } = await restart()
  assert.notEqual(now, old)
  assert.ok(at(`destroy#${old}:wait-exit`) > -1, JSON.stringify(timeline))
  assert.ok(at(`destroy#${old}:wait-exit`) < at(`start#${now}`), JSON.stringify(timeline))
  assert.ok(at(`start#${now}`) < at(`load#${now}`) && at(`load#${now}`) < at(`play#${now}`))
  assert.equal(timeline.filter(e => e.startsWith(`destroy#${old}`)).length, 1, 'old controller destroyed exactly once')
  assert.equal(at(`silence#${old}`), -1)
})

test('#11 exclusive output via extra args also stops the old process first', async() => {
  Object.assign(appSetting, { 'player.mpv.bitPerfectMode': false, 'player.mpv.extraArgs': ['--audio-exclusive=yes'] })
  const { old, now } = await restart()
  assert.ok(at(`destroy#${old}:wait-exit`) > -1, JSON.stringify(timeline))
  assert.ok(at(`destroy#${old}:wait-exit`) < at(`start#${now}`), JSON.stringify(timeline))
})

test('#11 shared output: seamless switch, the old instance is silenced before the new one plays, then destroyed', async() => {
  Object.assign(appSetting, { 'player.mpv.bitPerfectMode': false, 'player.mpv.extraArgs': [] })
  const { old, now } = await restart()
  assert.ok(at(`start#${now}`) < at(`destroy#${old}`), 'seamless: new instance starts before the old one is destroyed')
  assert.ok(at(`silence#${old}`) > -1 && at(`silence#${old}`) < at(`play#${now}`), JSON.stringify(timeline))
  assert.ok(at(`play#${now}`) < at(`destroy#${old}`))
})

test('#11 if the new instance fails to start, the error propagates and the old controller stays active', async() => {
  Object.assign(appSetting, { 'player.mpv.bitPerfectMode': true, 'player.mpv.extraArgs': [] })
  timeline.length = 0
  const old = getMpvController()
  failStart = true
  await assert.rejects(restartMpvController({ url: 'http://x/song.flac', playing: true }), /audio device busy/)
  failStart = false
  assert.equal(getMpvController(), old, 'rolled back to the old controller (it restarts lazily on next use)')
  const newId = Number(timeline.find(e => e.startsWith('start#')).split('#')[1])
  assert.ok(at(`destroy#${newId}`) > -1, 'the failed new controller is cleaned up')
})
