import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { formatInfo, normalizeFormat, parseFfmpegTime, shouldDeleteSource } from '@common/utils/audioConversion'

const taskFilePath = () => path.join(global.lxDataPath, 'audio-conversion-tasks.json')

const getPlatformArch = () => `${process.platform}-${process.arch}`
const getBinaryPath = (name: 'ffmpeg' | 'ffprobe') => {
  const fileName = process.platform === 'win32' ? `${name}.exe` : name
  return process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'resources', 'ffmpeg', getPlatformArch(), fileName)
    : path.join(process.resourcesPath, 'bin', fileName)
}

const getOutputPath = async(inputPath: string, outputDir: string, format: LX.AudioConversion.Format) => {
  const parsed = path.parse(inputPath)
  const ext = formatInfo[format].ext
  for (let index = 0; ; index++) {
    const suffix = index ? ` (${index})` : ''
    const candidate = path.join(outputDir, `${parsed.name}${suffix}.${ext}`)
    if (!existsSync(candidate)) return candidate
  }
}

export class AudioConversionService {
  private tasks: LX.AudioConversion.Task[] = []
  private running: ChildProcessWithoutNullStreams | null = null
  private runningId: string | null = null
  private readonly waiters = new Map<string, Array<(task: LX.AudioConversion.Task) => void>>()

  async init() {
    try {
      const value = JSON.parse(await fs.readFile(taskFilePath(), 'utf8'))
      if (Array.isArray(value)) this.tasks = value.map(task => task.status === 'running' ? { ...task, status: 'waiting', progress: 0 } : task)
    } catch {}
    this.persist()
    void this.runNext()
  }

  getTasks = () => this.tasks.map(task => ({ ...task }))

  async add(params: LX.AudioConversion.AddParams) {
    await fs.mkdir(params.outputDir, { recursive: true })
    const format = normalizeFormat(params.format) as LX.AudioConversion.Format
    const tasks = await Promise.all(params.filePaths.map(async inputPath => ({
      id: randomUUID(),
      inputPath,
      outputPath: await getOutputPath(inputPath, params.outputDir, format),
      outputDir: params.outputDir,
      format,
      deleteSource: params.deleteSource,
      useCurrentDownloadDeleteSetting: params.useCurrentDownloadDeleteSetting,
      status: 'waiting' as const,
      progress: 0,
      createdAt: Date.now(),
    })))
    this.tasks.push(...tasks)
    this.persist()
    void this.runNext()
    return tasks
  }

  async wait(ids: string[]): Promise<LX.AudioConversion.Task[]> {
    const waitForTask = async(id: string): Promise<LX.AudioConversion.Task> => new Promise((resolve, reject) => {
      const task = this.tasks.find(task => task.id === id)
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
      const task = this.tasks.find(task => task.id === id)
      if (!task || task.status === 'completed' || task.status === 'error') continue
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
    this.tasks = this.tasks.filter(task => !ids.includes(task.id) || task.status === 'running')
    this.persist()
  }

  retry(ids: string[]) {
    for (const id of ids) {
      const task = this.tasks.find(task => task.id === id)
      if (!task || (task.status !== 'error' && task.status !== 'canceled')) continue
      task.status = 'waiting'
      task.progress = 0
      delete task.error
    }
    this.persist()
    void this.runNext()
  }

  private persist() {
    void fs.writeFile(taskFilePath(), JSON.stringify(this.tasks), 'utf8').catch(() => {})
  }

  private finish(task: LX.AudioConversion.Task, status: LX.AudioConversion.Status, error?: string) {
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
    if (!existsSync(binary)) throw new Error(`未找到受控 ffprobe：${binary}`)
    return new Promise<{ duration: number }>((resolve, reject) => {
      let output = ''
      const child = spawn(binary, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type:format=duration,size', '-of', 'json', filePath])
      child.stdout.on('data', chunk => { output += chunk })
      child.once('error', reject)
      child.once('close', code => {
        if (code) {
          reject(new Error('ffprobe 无法读取音频文件'))
          return
        }
        try {
          const data = JSON.parse(output)
          const duration = Number(data.format?.duration)
          if (!data.streams?.length || !Number.isFinite(duration) || duration <= 0) throw new Error('输出文件不包含有效音频流')
          resolve({ duration })
        } catch (error) { reject(error) }
      })
    })
  }

  private async runNext(): Promise<void> {
    if (this.running) return
    const task = this.tasks.find(task => task.status === 'waiting')
    if (!task) return
    const ffmpeg = getBinaryPath('ffmpeg')
    if (!existsSync(ffmpeg)) {
      this.finish(task, 'error', `未找到受控 FFmpeg：${ffmpeg}`)
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
        const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', task.inputPath, '-map', '0:a:0', '-vn', '-map_metadata', '-1', ...formatInfo[task.format].args, tempPath])
        this.running = child
        child.stderr.on('data', chunk => {
          const text = chunk.toString()
          stderr += text
          const elapsed = parseFfmpegTime(text)
          if (elapsed != null) task.progress = Math.min(99, Math.floor(elapsed / input.duration * 100))
        })
        child.once('error', reject)
        child.once('close', code => {
          if (code === 0) {
            resolve()
            return
          }
          reject(new Error(stderr.trim().split('\n').at(-1) ?? 'FFmpeg 转换失败'))
        })
      })
      await this.probe(tempPath)
      await fs.rename(tempPath, task.outputPath)
      const deleteSource = shouldDeleteSource(task.deleteSource, task.useCurrentDownloadDeleteSetting, global.lx.appSetting['download.deleteSourceAfterConvert'])
      if (deleteSource) await fs.rm(task.inputPath, { force: true })
      this.finish(task, 'completed')
    } catch (error: any) {
      await fs.rm(tempPath, { force: true }).catch(() => {})
      this.finish(task, task.status === 'canceled' ? 'canceled' : 'error', error?.message || '转换失败')
    } finally {
      this.running = null
      this.runningId = null
      void this.runNext()
    }
  }
}
