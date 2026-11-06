import { execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { log } from '@common/utils'

/**
 * mpv 孤儿进程防护。
 *
 * mpv 以 --idle=yes 运行，主进程退出后它不会自行结束；Node 也不会在父进程退出时结束子进程。
 * 1. 正常退出 / 未捕获异常 / 终止信号：主进程 exit 时同步结束所有已登记的 mpv 子进程。
 * 2. 被强制结束（任务管理器、SIGKILL、OOM）时任何退出逻辑都不会执行，因此下次启动时清理残留：
 *    只清理本应用启动的 mpv —— IPC 地址形如 lx-music-mpv-<主进程 pid>-<实例号>，
 *    且该主进程 pid 已不存在；用户自己运行的 mpv、仍在运行的其他 LX 实例的 mpv 都不会被动。
 */

// ---------------------------------------------------------------------------
// 1. 退出时结束已登记的子进程
// ---------------------------------------------------------------------------

const trackedProcesses = new Set<ChildProcess>()

/** 登记 mpv 子进程；进程退出后自动注销 */
export const trackMpvProcess = (proc: ChildProcess) => {
  trackedProcesses.add(proc)
  proc.once('exit', () => { trackedProcesses.delete(proc) })
}

/** 同步结束所有仍在运行的已登记 mpv 子进程（可在 process 'exit' 事件中调用） */
export const killTrackedMpvProcesses = () => {
  for (const proc of trackedProcesses) {
    try {
      if (proc.exitCode == null && proc.signalCode == null) proc.kill()
    } catch {}
  }
  trackedProcesses.clear()
}

export const getTrackedMpvProcessCount = () => trackedProcesses.size

let exitHooksInstalled = false
/** 在主进程 exit 与终止信号时结束 mpv 子进程。信号处理结束子进程后按默认语义退出。 */
export const installMpvExitHooks = () => {
  if (exitHooksInstalled) return
  exitHooksInstalled = true
  process.once('exit', killTrackedMpvProcesses)
  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]] as const) {
    process.once(signal, () => {
      killTrackedMpvProcesses()
      process.exit(code)
    })
  }
}

// ---------------------------------------------------------------------------
// 2. 启动时清理残留
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: number
  command: string
}

const OWNER_RE = /lx-music-mpv-(\d+)-\d+/

/** 从命令行解析启动该 mpv 的 LX 主进程 pid；不是本应用启动的 mpv 时返回 null */
export const parseMpvOwnerPid = (command: string): number | null => {
  if (!/mpv/i.test(command) || !command.includes('--input-ipc-server=')) return null
  const ipc = /--input-ipc-server=("[^"]*"|\S+)/.exec(command)?.[1] ?? ''
  const owner = OWNER_RE.exec(ipc)?.[1]
  return owner ? Number(owner) : null
}

/** 进程是否存在（EPERM 表示存在但无权限，同样视为存在） */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err?.code === 'EPERM'
  }
}

/** 找出主进程已不存在的本应用 mpv 进程 */
export const findOrphanMpvProcesses = (
  list: readonly ProcessInfo[],
  { currentPid = process.pid, isAlive = isProcessAlive }: { currentPid?: number, isAlive?: (pid: number) => boolean } = {},
): ProcessInfo[] => {
  return list.filter(({ pid, command }) => {
    if (pid === currentPid) return false
    const owner = parseMpvOwnerPid(command)
    if (owner == null || owner === currentPid) return false
    return !isAlive(owner)
  })
}

/** 解析 PowerShell `ConvertTo-Json` 输出（单个对象或数组；CommandLine 可能为 null） */
export const parseWindowsProcessJson = (text: string): ProcessInfo[] => {
  const trimmed = text.trim()
  if (!trimmed) return []
  const data = JSON.parse(trimmed) as Array<{ ProcessId?: number, CommandLine?: string | null }> | { ProcessId?: number, CommandLine?: string | null }
  return (Array.isArray(data) ? data : [data])
    .filter(item => typeof item.ProcessId == 'number' && typeof item.CommandLine == 'string')
    .map(item => ({ pid: item.ProcessId!, command: item.CommandLine! }))
}

/** 解析 `ps -axww -o pid=,command=` 输出 */
export const parsePsOutput = (text: string): ProcessInfo[] => {
  const result: ProcessInfo[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (match) result.push({ pid: Number(match[1]), command: match[2] })
  }
  return result
}

const run = async(file: string, args: string[], timeout = 8000) => new Promise<string>((resolve, reject) => {
  execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
    if (err) reject(err)
    else resolve(String(stdout))
  })
})

/** 列出系统中的 mpv 进程及其命令行 */
export const listMpvProcesses = async(): Promise<ProcessInfo[]> => {
  if (process.platform === 'win32') {
    const script = "Get-CimInstance Win32_Process -Filter \"Name like 'mpv%'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    return parseWindowsProcessJson(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]))
  }
  return parsePsOutput(await run('ps', ['-axww', '-o', 'pid=,command='])).filter(item => /mpv/i.test(item.command))
}

export interface OrphanCleanupDeps {
  listProcesses: () => Promise<ProcessInfo[]>
  isAlive: (pid: number) => boolean
  kill: (pid: number) => void
  currentPid: number
  tmpDir: string
  readdir: (dir: string) => string[]
  unlink: (file: string) => void
}

const defaultDeps = (): OrphanCleanupDeps => ({
  listProcesses: listMpvProcesses,
  isAlive: isProcessAlive,
  kill: pid => { process.kill(pid) },
  currentPid: process.pid,
  tmpDir: os.tmpdir(),
  readdir: dir => fs.readdirSync(dir),
  unlink: file => { fs.unlinkSync(file) },
})

const STALE_FILE_RE = /^lx-music-(?:mpv|video)-(\d+)-\d+\.(?:sock|conf)$/

/**
 * 启动时清理上次异常退出遗留的 mpv 进程与 IPC socket / 配置文件。任何一步失败都只记录日志。
 * @returns 本次结束的进程 pid 与删除的残留文件
 */
export const cleanupOrphanMpvProcesses = async(overrides: Partial<OrphanCleanupDeps> = {}): Promise<{ killed: number[], removedFiles: string[] }> => {
  const deps = { ...defaultDeps(), ...overrides }
  const killed: number[] = []
  const removedFiles: string[] = []
  try {
    const orphans = findOrphanMpvProcesses(await deps.listProcesses(), { currentPid: deps.currentPid, isAlive: deps.isAlive })
    for (const { pid } of orphans) {
      try {
        deps.kill(pid)
        killed.push(pid)
      } catch (err: any) {
        log.warn(`[mpvOrphan] kill orphan mpv pid=${pid} failed: ${err?.message ?? err}`)
      }
    }
    if (killed.length) log.info(`[mpvOrphan] killed orphan mpv processes: ${killed.join(', ')}`)
  } catch (err: any) {
    log.warn(`[mpvOrphan] list mpv processes failed: ${err?.message ?? err}`)
  }
  // Windows 的命名管道随进程消失；macOS / Linux 会残留 socket 文件，视频实例还有输入配置文件
  try {
    for (const name of deps.readdir(deps.tmpDir)) {
      const owner = STALE_FILE_RE.exec(name)?.[1]
      if (!owner || Number(owner) === deps.currentPid || deps.isAlive(Number(owner))) continue
      try {
        deps.unlink(path.join(deps.tmpDir, name))
        removedFiles.push(name)
      } catch {}
    }
  } catch {}
  return { killed, removedFiles }
}
