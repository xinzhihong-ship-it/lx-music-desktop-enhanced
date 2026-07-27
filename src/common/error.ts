import { log } from './utils'

const ignoreErrorMessage = [
  'Possible side-effect in debug-evaluate',
  'Unexpected end of input',
]

let isLogged = false
const shouldIgnoreError = (err: any): boolean => {
  if (!err) return false
  if (ignoreErrorMessage.includes(err?.message)) return true
  // 忽略 Electron/子进程在启动/退出时常见的 EPIPE 噪音，避免刷屏
  if (err?.code === 'EPIPE' || err?.code === 'ECANCELED' || err?.code === 'ECONNRESET') {
    if (!isLogged) {
      isLogged = true
      log.warn('[error handler] suppressed non-fatal pipe/connection error:', err)
    }
    return true
  }
  return false
}

process.on('uncaughtException', err => {
  if (shouldIgnoreError(err)) return
  console.error('An uncaught error occurred!')
  console.error(err)
  log.error(err)
})
process.on('unhandledRejection', (reason, p) => {
  if (shouldIgnoreError(reason)) return
  console.error('Unhandled Rejection at: Promise ', p)
  console.error(' reason: ', reason)
  log.error(reason)
})

// 开发模式专用：HMR 热更新组件时，Vue 可能基于已被替换的旧 DOM 计算插入锚点，
// 抛出良性的 insertBefore/removeChild NotFoundError，触发 dev-server 红色遮罩打断测试。
// 生产环境不走 HMR，不包含此逻辑。
if (process.env.NODE_ENV !== 'production') {
  const originalConsoleError = console.error
  console.error = (...args: any[]) => {
    const first = args[0]
    if (first instanceof Error && first.name == 'NotFoundError' && /insertBefore|removeChild/.test(first.message)) {
      console.warn('[dev] 已忽略 HMR 引起的良性 DOM 更新错误（生产环境不会出现）')
      return
    }
    originalConsoleError.apply(console, args)
  }
}
