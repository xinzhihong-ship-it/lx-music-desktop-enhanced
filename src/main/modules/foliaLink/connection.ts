// 「Folia 对接」的连接文件：服务起来后把端口和令牌写进一个只有本用户能读的 JSON，Folia 的主进程读它来连接；
// 关掉对接、退出时删除。路径用系统默认的应用数据目录，不随 Windows 绿色版变化（同 foliaStage/connection.ts）。
//   - Linux：有 XDG_RUNTIME_DIR 时 $XDG_RUNTIME_DIR/lx-music-folia-link/connection.json
//   - 其他：<系统应用数据目录>/lx-music-folia-link/connection.json
import fs from 'node:fs'
import path from 'node:path'

export const LINK_DIR_NAME = 'lx-music-folia-link'
export const LINK_FILE_NAME = 'connection.json'

export interface LinkConnectionInfo {
  version: 1
  pid: number
  port: number
  baseUrl: string
  token: string
  appVersion: string
}

/** 连接文件的位置：Linux 优先运行时目录（登录会话结束即清空） */
export const resolveLinkFilePath = ({ platform, env, appDataDir }: {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  appDataDir: string
}) => {
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (platform == 'linux' && runtimeDir && path.isAbsolute(runtimeDir)) return path.join(runtimeDir, LINK_DIR_NAME, LINK_FILE_NAME)
  return path.join(appDataDir, LINK_DIR_NAME, LINK_FILE_NAME)
}

export const buildLinkConnectionInfo = ({ pid, port, token, appVersion }: { pid: number, port: number, token: string, appVersion: string }): LinkConnectionInfo => ({
  version: 1,
  pid,
  port,
  baseUrl: `http://127.0.0.1:${port}`,
  token,
  appVersion,
})

/** 原子写入：先写同目录的临时文件再改名，读的一方不会读到半个文件 */
export const writeLinkConnectionFile = async(filePath: string, info: LinkConnectionInfo) => {
  const dir = path.dirname(filePath)
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 })
  // mkdir 不会改已存在目录的权限
  if (process.platform != 'win32') await fs.promises.chmod(dir, 0o700).catch(() => {})
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await fs.promises.writeFile(tmpPath, JSON.stringify(info, null, 2), { encoding: 'utf-8', mode: 0o600 })
  await fs.promises.rename(tmpPath, filePath)
}

/** 只删自己写的那份：另一个落雪实例写的文件不动 */
export const removeLinkConnectionFile = async(filePath: string, pid: number) => {
  let text: string
  try {
    text = await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return
  }
  try {
    const data = JSON.parse(text)
    if (data?.pid !== pid) return
  } catch {}
  await fs.promises.rm(filePath, { force: true }).catch(() => {})
}

/** 退出时同步删除（before-quit 之后来不及等异步） */
export const removeLinkConnectionFileSync = (filePath: string, pid: number) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (data?.pid !== pid) return
    fs.rmSync(filePath, { force: true })
  } catch {}
}
