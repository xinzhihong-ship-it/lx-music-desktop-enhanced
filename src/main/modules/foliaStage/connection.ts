// 读 Folia 的 Stage 连接文件：Folia 开着 Stage API 时把端口和 bearer token 写进一个只有本用户能读的 JSON，
// 关掉 Stage API、退出时删除，重新生成 token 时改写（Folia 仓库 electron/stageConnectionFile.cjs）。
//   - Linux：$XDG_RUNTIME_DIR/folia/stage.json；没有 XDG_RUNTIME_DIR 时同下
//   - 其他：Folia 用户数据目录（应用名 Folia）下的 stage/connection.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface StageConnection {
  pid: number
  port: number
  token: string
}

export const FOLIA_APP_NAME = 'Folia'

/**
 * 系统默认的应用数据目录（Folia 的用户数据目录在它下面）。
 * 不用本应用的 app.getPath('appData')：Windows 绿色版会把它改到程序目录下的 portable 文件夹（app.ts）。
 */
export const resolveSystemAppDataDir = ({ platform, env, homeDir = os.homedir() }: {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  homeDir?: string
}) => {
  switch (platform) {
    case 'win32': return env.APPDATA?.trim() ? env.APPDATA : path.join(homeDir, 'AppData', 'Roaming')
    case 'darwin': return path.join(homeDir, 'Library', 'Application Support')
    default: return env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(homeDir, '.config')
  }
}

/** 连接文件可能在的位置，按顺序找 */
export const resolveConnectionFilePaths = ({ platform, env, appDataDir }: {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  appDataDir: string
}) => {
  const paths: string[] = []
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (platform == 'linux' && runtimeDir && path.isAbsolute(runtimeDir)) paths.push(path.join(runtimeDir, 'folia', 'stage.json'))
  paths.push(path.join(appDataDir, FOLIA_APP_NAME, 'stage', 'connection.json'))
  return paths
}

/** 解析并校验连接文件。只接受本机回环地址：token 和歌曲信息不能发去别处 */
export const parseConnectionFile = (text: string): StageConnection | null => {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || data.version !== 1) return null
  const port = Number(data.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof data.token != 'string' || !data.token) return null
  if (data.baseUrl !== undefined && data.baseUrl !== `http://127.0.0.1:${port}`) return null
  const pid = Number(data.pid)
  return { pid: Number.isInteger(pid) ? pid : 0, port, token: data.token }
}

/** 写连接文件的 Folia 进程还在不在（崩溃时文件会残留） */
export const isProcessAlive = (pid: number) => {
  if (!pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err?.code == 'EPERM'
  }
}

export const readStageConnection = async(filePaths: string[]): Promise<StageConnection | null> => {
  for (const filePath of filePaths) {
    let text: string
    try {
      text = await fs.promises.readFile(filePath, 'utf-8')
    } catch {
      continue
    }
    const connection = parseConnectionFile(text)
    if (connection && isProcessAlive(connection.pid)) return connection
  }
  return null
}

export const connectionKey = (connection: StageConnection | null) => connection ? `${connection.pid}:${connection.port}:${connection.token}` : ''
