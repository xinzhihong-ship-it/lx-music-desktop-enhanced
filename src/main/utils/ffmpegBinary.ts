import { app } from 'electron'
import { lstatSync } from 'node:fs'
import path from 'node:path'

/**
 * 随包分发的 ffmpeg / ffprobe 路径解析。
 * 音频转换（audioConversion）与基调分析（songKeyAudio）都要用这两个二进制，
 * 路径与可信校验必须一致，不能再各写一份。
 */

const getPlatformArch = () => `${process.platform}-${process.arch}`

const isTrustedExecutable = (filePath: string) => {
  try {
    const stats = lstatSync(filePath)
    return stats.isFile() && !stats.isSymbolicLink() && (process.platform === 'win32' || (stats.mode & 0o111) !== 0)
  } catch {
    return false
  }
}

export const getBinaryPath = (name: 'ffmpeg' | 'ffprobe') => {
  const fileName = process.platform === 'win32' ? `${name}.exe` : name
  const resourceRoot = app.isPackaged
    ? path.resolve(process.resourcesPath, 'bin')
    : path.resolve(process.cwd(), 'resources', 'ffmpeg', getPlatformArch())
  const binaryPath = path.resolve(resourceRoot, fileName)
  const relativePath = path.relative(resourceRoot, binaryPath)
  if (
    path.basename(binaryPath) !== fileName ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    !isTrustedExecutable(binaryPath)
  ) {
    throw new Error(`未找到受控 ${name}：${binaryPath}`)
  }
  return binaryPath
}
