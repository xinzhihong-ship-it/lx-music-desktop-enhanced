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
