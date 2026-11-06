// 模拟 LX 主进程：登记一个长期运行的子进程（代替 mpv），打印其 pid 后按指定方式「异常退出」。
// 用法：node mpvOrphanParent.mjs <crash|signal>
import { registerHooks } from 'node:module'
import { spawn } from 'node:child_process'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@common/utils') return { url: `data:text/javascript,${encodeURIComponent('export const log = { info() {}, warn() {}, error() {} }')}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { trackMpvProcess, installMpvExitHooks } = await import('../../src/main/modules/winMain/mpvOrphan.ts')

installMpvExitHooks()
// detached：脱离 Windows 下 libuv 的作业对象（否则子进程会被系统随父进程一起结束），
// 确保这里验证的是登记 + 退出钩子本身，而不是系统行为（macOS / Linux 本来就不会结束子进程）
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true })
child.unref()
trackMpvProcess(child)
process.stdout.write(`CHILD ${child.pid}\n`)

if (process.argv[2] === 'crash') {
  setTimeout(() => { throw new Error('simulated main process crash') }, 100)
} else {
  setInterval(() => {}, 1000) // 等待外部发送终止信号
}
