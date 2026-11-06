import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

// #10：MPV IPC 连接断开（mpv 崩溃 / 销毁 / 进程退出）时，挂起的请求立即统一 reject，
// 不再空等 5 秒超时；迟到的旧连接 close 事件不影响新连接。使用真实的命名管道 / Unix socket。

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
globalThis.lx = { appSetting: { 'player.mpv.path': '', 'player.mpv.aoFallbackDevices': [] } }
const { MpvController } = await import('../src/main/modules/winMain/mpvController.ts')

let pipeId = 0
const pipePath = () => process.platform === 'win32'
  ? `\\\\.\\pipe\\lx-mpv-ipc-test-${process.pid}-${++pipeId}`
  : path.join(os.tmpdir(), `lx-mpv-ipc-test-${process.pid}-${++pipeId}.sock`)

/** 假 mpv IPC 服务：只回复 answer(command) 返回 true 的请求，其余请求一直挂起 */
const createServer = async(answer = () => true) => {
  const connections = []
  const server = net.createServer(conn => {
    connections.push(conn)
    let buffer = ''
    conn.setEncoding('utf8')
    conn.on('data', chunk => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) > -1) {
        const { command, request_id: id } = JSON.parse(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        if (answer(command)) conn.write(JSON.stringify({ request_id: id, error: 'success', data: 'ok' }) + '\n')
      }
    })
    conn.on('error', () => {})
  })
  const ipcPath = pipePath()
  await new Promise(resolve => server.listen(ipcPath, resolve))
  const handle = { ipcPath, connections, close: async() => { for (const c of connections) c.destroy(); await new Promise(resolve => server.close(() => resolve())) } }
  servers.add(handle)
  return handle
}
// 断言失败时也要关闭服务端，否则进程不会退出（测试应失败而不是挂起）
const servers = new Set()
after(async() => { for (const server of servers) await server.close().catch(() => {}) })
const connect = async(server) => {
  const controller = new MpvController()
  controller.ipcPath = server.ipcPath
  await controller.connectIpc()
  return controller
}
const timed = async promise => {
  const start = Date.now()
  const result = await promise.then(() => 'resolved', err => `rejected:${err.message}`)
  return { result, ms: Date.now() - start }
}

test('regression: a normal request / response over the IPC socket still works', { timeout: 10_000 }, async() => {
  const server = await createServer()
  const controller = await connect(server)
  assert.equal(await controller.command(['get_property', 'path']), 'ok')
})

test('#10 when mpv drops the connection, pending requests are rejected immediately instead of waiting 5s', { timeout: 10_000 }, async() => {
  const server = await createServer(() => false)
  const controller = await connect(server)
  const pending = timed(controller.command(['get_property', 'duration']))
  await new Promise(resolve => setTimeout(resolve, 30))
  for (const conn of server.connections) conn.destroy() // mpv 崩溃 / 断开
  const { result, ms } = await pending
  assert.equal(result, 'rejected:mpv IPC connection closed')
  assert.ok(ms < 1000, `rejected after ${ms}ms`)
  assert.equal((await timed(controller.command(['get_property', 'path']))).result, 'rejected:mpv IPC is not connected')
})

test('#10 destroy() rejects pending requests immediately', { timeout: 10_000 }, async() => {
  const server = await createServer(command => command[0] === 'quit') // 只回复 quit
  const controller = await connect(server)
  const pending = timed(controller.command(['get_property', 'duration']))
  await new Promise(resolve => setTimeout(resolve, 30))
  await controller.destroy()
  const { result, ms } = await pending
  assert.equal(result, 'rejected:mpv IPC connection closed')
  assert.ok(ms < 1000, `rejected after ${ms}ms`)
})

test('#10 on process exit, pending requests receive the exit reason', { timeout: 10_000 }, async() => {
  const server = await createServer(() => false)
  const controller = await connect(server)
  const pending = timed(controller.command(['get_property', 'duration']))
  await new Promise(resolve => setTimeout(resolve, 30))
  controller.cleanupSocket(new Error('mpv exited code=1 signal=null')) // 与 exit 事件处理一致
  assert.equal((await pending).result, 'rejected:mpv exited code=1 signal=null')
})

test('#10 a late close of an old connection does not drop the current connection or its requests', { timeout: 10_000 }, async() => {
  const server = await createServer(() => false)
  const controller = await connect(server)
  await controller.connectIpc() // 重新连接：当前连接变为第二条
  await new Promise(resolve => setTimeout(resolve, 30))
  const pending = timed(controller.command(['get_property', 'path']))
  await new Promise(resolve => setTimeout(resolve, 30))
  server.connections[0].destroy() // 旧连接迟到的 close
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.notEqual(controller.socket, null, 'current connection must be kept')
  server.connections[1].write(JSON.stringify({ request_id: controller.requestId, error: 'success', data: 'still-ok' }) + '\n')
  assert.equal((await pending).result, 'resolved')
})
