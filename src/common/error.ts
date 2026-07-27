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
  const isHmrDomError = (err: any): boolean => {
    const message = err?.message ?? (typeof err === 'string' ? err : '')
    return /insertBefore|removeChild/.test(message) && /not a child of this node/.test(message)
  }
  const originalConsoleError = console.error
  console.error = (...args: any[]) => {
    if (isHmrDomError(args[0])) {
      console.warn('[dev] 已忽略 HMR 引起的良性 DOM 更新错误（生产环境不会出现）')
      return
    }
    originalConsoleError.apply(console, args)
  }
  // dev-server 遮罩通过 window error/unhandledrejection 事件（冒泡阶段）捕获运行时错误，
  // 捕获阶段监听可以确定性阻断该类良性错误到达遮罩
  window.addEventListener('error', event => {
    if (isHmrDomError(event.error) || isHmrDomError(event.message)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
  window.addEventListener('unhandledrejection', event => {
    if (isHmrDomError(event.reason)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
}
