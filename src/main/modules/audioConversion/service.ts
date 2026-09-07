import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  formatInfo,
  normalizeFormat,
  parseFfmpegTime,
  shouldDeleteSource,
} from '@common/utils/audioConversion'

const taskFilePath = () =>
  path.join(global.lxDataPath, 'audio-conversion-tasks.json')

const getPlatformArch = () => `${process.platform}-${process.arch}`
const isAbsolutePath = (value: unknown): value is string => (
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 4096 &&
  !value.includes('\0') &&
  path.isAbsolute(value)
)

const isTrustedExecutable = (filePath: string) => {
  try {
    const stats = lstatSync(filePath)
    return stats.isFile() && !stats.isSymbolicLink() && (process.platform === 'win32' || (stats.mode & 0o111) !== 0)
  } catch {
    return false
  }
}

const getBinaryPath = (name: 'ffmpeg' | 'ffprobe') => {
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

const getOutputPath = (
  inputPath: string,
  outputDir: string,
  format: LX.AudioConversion.Format,
  usedNames: Set<string>,
) => {
  const parsed = path.parse(inputPath)
  const ext = formatInfo[format].ext
  for (let index = 0; ; index++) {
    const suffix = index ? ` (${index})` : ''
    const name = `${parsed.name}${suffix}.${ext}`
    if (usedNames.has(name)) continue
    usedNames.add(name)
    return path.join(outputDir, name)
  }
}

export class AudioConversionService {
  private tasks: LX.AudioConversion.Task[] = []
  private running: ChildProcessWithoutNullStreams | null = null
  private runningId: string | null = null
  private readonly waiters = new Map<
  string,
  Array<(task: LX.AudioConversion.Task) => void>
  >()

  async init() {
    try {
      const value = JSON.parse(await fs.readFile(taskFilePath(), 'utf8'))
      if (Array.isArray(value)) {
        this.tasks = value.map((task) =>
          task.status === 'running'
            ? { ...task, status: 'waiting', progress: 0 }
            : task,
        )
      }
    } catch {
      // 任务文件不存在或已损坏时从空队列恢复。
      this.tasks = []
    }
    this.persist()
    void this.runNext()
  }

  getTasks = () => this.tasks.map((task) => ({ ...task }))

  async add(params: LX.AudioConversion.AddParams) {
    if (
      !params ||
      !Array.isArray(params.filePaths) ||
      params.filePaths.length === 0 ||
      params.filePaths.length > 256 ||
      !isAbsolutePath(params.outputDir) ||
      typeof params.deleteSource !== 'boolean' ||
      (params.useCurrentDownloadDeleteSetting != null && typeof params.useCurrentDownloadDeleteSetting !== 'boolean')
    ) throw new Error('音频转换参数无效')
    const inputPaths = params.filePaths.map((inputPath) => {
      if (!isAbsolutePath(inputPath)) throw new Error('音频输入路径无效')
      return path.resolve(inputPath)
    })
    const outputDir = path.resolve(params.outputDir)
    await fs.mkdir(outputDir, { recursive: true })
    const outputStats = await fs.stat(outputDir)
    if (!outputStats.isDirectory()) throw new Error('音频输出目录无效')
    const format = normalizeFormat(params.format) as LX.AudioConversion.Format
    // 只读一次目录，避免 Windows 上对每个文件、每个重名序号同步访问文件系统导致 IPC 长时间阻塞。
    const usedNames = new Set(await fs.readdir(outputDir))
    const tasks = await Promise.all(inputPaths.map(async(inputPath) => {
      const inputStats = await fs.lstat(inputPath)
      if (!inputStats.isFile() || inputStats.isSymbolicLink()) throw new Error('音频输入文件无效')
      const outputPath = getOutputPath(inputPath, outputDir, format, usedNames)
      const relativeOutput = path.relative(outputDir, outputPath)
      if (relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) {
        throw new Error('音频输出路径无效')
      }
      return {
        id: randomUUID(),
        inputPath,
        outputPath,
        outputDir,
        format,
        deleteSource: params.deleteSource,
        useCurrentDownloadDeleteSetting: params.useCurrentDownloadDeleteSetting,
        status: 'waiting' as const,
        progress: 0,
        createdAt: Date.now(),
      }
    }))
    this.tasks.push(...tasks)
    this.persist()
    void this.runNext()
    return tasks
  }

  async wait(ids: string[]): Promise<LX.AudioConversion.Task[]> {
    const waitForTask = async(id: string): Promise<LX.AudioConversion.Task> =>
      new Promise((resolve, reject) => {
        const task = this.tasks.find((task) => task.id === id)
        if (!task) {
          reject(new Error('转换任务不存在'))
          return
        }
        if (task.status === 'completed') {
          resolve({ ...task })
          return
        }
        if (task.status === 'error' || task.status === 'canceled') {
          reject(new Error(task.error ?? '转换失败'))
          return
        }
        const listeners = this.waiters.get(id) ?? []
        listeners.push(resolve)
        this.waiters.set(id, listeners)
      })
    return Promise.all(ids.map(waitForTask))
  }

  cancel(ids: string[]) {
    for (const id of ids) {
      const task = this.tasks.find((task) => task.id === id)
      if (!task || task.status === 'completed' || task.status === 'error') { continue }
      if (this.runningId === id) {
        task.status = 'canceled'
        task.error = '已取消'
        this.running?.kill('SIGTERM')
      } else this.finish(task, 'canceled', '已取消')
    }
    this.persist()
  }

  remove(ids: string[]) {
    this.cancel(ids)
    this.tasks = this.tasks.filter(
      (task) => !ids.includes(task.id) || task.status === 'running',
    )
    this.persist()
  }

  retry(ids: string[]) {
    for (const id of ids) {
      const task = this.tasks.find((task) => task.id === id)
      if (!task || (task.status !== 'error' && task.status !== 'canceled')) { continue }
      task.status = 'waiting'
      task.progress = 0
      delete task.error
    }
    this.persist()
    void this.runNext()
  }

  private persist() {
    void fs
      .writeFile(taskFilePath(), JSON.stringify(this.tasks), 'utf8')
      .catch(() => {})
  }

  private finish(
    task: LX.AudioConversion.Task,
    status: LX.AudioConversion.Status,
    error?: string,
  ) {
    task.status = status
    task.progress = status === 'completed' ? 100 : task.progress
    task.error = error
    const waiters = this.waiters.get(task.id) ?? []
    this.waiters.delete(task.id)
    for (const resolve of waiters) resolve({ ...task })
    this.persist()
  }

  private async probe(filePath: string) {
    const binary = getBinaryPath('ffprobe')
    return new Promise<{ duration: number }>((resolve, reject) => {
      let output = ''
      let stderr = ''
      const child = spawn(binary, [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_type:format=duration,size',
        '-of',
        'json',
        filePath,
      ], { shell: false })
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (code !== 0 || signal) {
          const message =
            stderr.trim() ||
            (signal
              ? `ffprobe 被系统信号 ${signal} 终止`
              : 'ffprobe 无法读取音频文件')
          reject(new Error(message))
          return
        }
        const json = output.trim()
        if (!json) {
          reject(
            new Error(
              stderr.trim() || 'ffprobe 未返回有效音频信息，请检查文件是否完整',
            ),
          )
          return
        }
        try {
          const data = JSON.parse(json)
          const duration = Number(data.format?.duration)
          if (
            !data.streams?.length ||
            !Number.isFinite(duration) ||
            duration <= 0
          ) { throw new Error('输出文件不包含有效音频流') }
          resolve({ duration })
        } catch (error: any) {
          reject(
            new Error(
              error?.message === 'Unexpected end of JSON input'
                ? 'ffprobe 返回的音频信息不完整，请检查文件是否完整'
                : error?.message || 'ffprobe 输出无效',
            ),
          )
        }
      })
    })
  }

  private async runNext(): Promise<void> {
    if (this.running) return
    const task = this.tasks.find((task) => task.status === 'waiting')
    if (!task) return
    let ffmpeg: string
    try {
      ffmpeg = getBinaryPath('ffmpeg')
    } catch (error: any) {
      this.finish(task, 'error', error?.message || '未找到受控 FFmpeg')
      await this.runNext()
      return
    }
    const tempPath = `${task.outputPath}.lx-converting.${formatInfo[task.format].ext}`
    try {
      const input = await this.probe(task.inputPath)
      await fs.rm(tempPath, { force: true })
      task.status = 'running'
      task.progress = 0
      this.runningId = task.id
      this.persist()
      await new Promise<void>((resolve, reject) => {
        let stderr = ''
        const child = spawn(ffmpeg, [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-i',
          task.inputPath,
          '-map',
          '0:a:0',
          '-vn',
          '-map_metadata',
          '-1',
          ...formatInfo[task.format].args,
          tempPath,
        ], { shell: false })
        this.running = child
        child.stderr.on('data', (chunk) => {
          const text = chunk.toString()
          stderr += text
          const elapsed = parseFfmpegTime(text)
          if (elapsed != null) {
            task.progress = Math.min(
              99,
              Math.floor((elapsed / input.duration) * 100),
            )
          }
        })
        child.once('error', reject)
        child.once('close', (code) => {
          if (code === 0) {
            resolve()
            return
          }
          reject(
            new Error(stderr.trim().split('\n').at(-1) ?? 'FFmpeg 转换失败'),
          )
        })
      })
      await this.probe(tempPath)
      await fs.rename(tempPath, task.outputPath)
      const deleteSource = shouldDeleteSource(
        task.deleteSource,
        task.useCurrentDownloadDeleteSetting,
        global.lx.appSetting['download.deleteSourceAfterConvert'],
      )
      if (deleteSource) await fs.rm(task.inputPath, { force: true })
      this.finish(task, 'completed')
    } catch (error: any) {
      await fs.rm(tempPath, { force: true }).catch(() => {})
      this.finish(
        task,
        task.status === 'canceled' ? 'canceled' : 'error',
        error?.message || '转换失败',
      )
    } finally {
      this.running = null
      this.runningId = null
      void this.runNext()
    }
  }
}
