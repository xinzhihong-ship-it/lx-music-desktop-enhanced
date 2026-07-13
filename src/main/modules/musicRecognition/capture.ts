import { spawn, type ChildProcessByStdio } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type Readable } from 'node:stream'

const SAMPLE_RATE = 16000
const BYTES_PER_SAMPLE = 2
const TARGET_SECONDS = 12
const MIN_SECONDS = 3
const CAPTURE_TIMEOUT_MS = 15000
const TARGET_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * TARGET_SECONDS
const MIN_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * MIN_SECONDS

type CaptureProcess = ChildProcessByStdio<null, Readable, Readable>

let activeProcess: CaptureProcess | null = null
let cancelActiveCapture: (() => void) | null = null

export class CaptureCancelledError extends Error {
  constructor() {
    super('capture cancelled')
    this.name = 'CaptureCancelledError'
  }
}

export class CapturePermissionError extends Error {}
export class CaptureNoAudioError extends Error {}

export const isMusicRecognitionSupported = (): boolean => {
  if (process.platform !== 'darwin') return false
  const [major, minor] = os.release().split('.').map(Number)
  return major > 23 || (major === 23 && minor >= 2)
}

const resolveBinaryPath = (): string => {
  const binaryPath = process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'node_modules', 'audiotee', 'bin', 'audiotee')
    : path.join(process.resourcesPath, 'bin', 'music-recognition', 'audiotee')
  if (!fs.existsSync(binaryPath)) throw new Error('未找到系统音频采集组件')
  return binaryPath
}

const terminate = (child: CaptureProcess) => {
  if (child.exitCode != null || child.killed) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode == null) child.kill('SIGKILL')
  }, 1000)
  timer.unref()
}

const parseCaptureError = (data: Buffer): Error | null => {
  for (const line of data.toString('utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const message = JSON.parse(line)
      if (message.message_type !== 'error') continue
      const detail = message.data?.message ?? '系统音频采集失败'
      if (/permission|authoriz|denied|not permitted|权限|授权/i.test(detail)) return new CapturePermissionError(detail)
      return new Error(detail)
    } catch {}
  }
  return null
}

const hasAudibleSignal = (pcm: Buffer): boolean => {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  let energy = 0
  for (const sample of samples) energy += sample * sample
  return Math.sqrt(energy / Math.max(samples.length, 1)) >= 32
}

export const captureSystemAudio = async(onProgress: (progress: number) => void): Promise<Buffer> => {
  if (!isMusicRecognitionSupported()) throw new Error('当前仅支持 macOS 14.2 及以上版本')
  if (activeProcess) throw new Error('已有听歌识曲任务正在运行')
  // 系统音频采集依赖 macOS 的「系统音频录制」权限（NSAudioCaptureUsageDescription）。
  // 首次启动 tap 时系统会自动弹出授权框；权限被拒绝后 tap 不会报错，只会持续输出静音，
  // 因此下方会在采集结果为静音时给出前往系统设置开启权限的引导。

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false
    let timeout: NodeJS.Timeout

    const child = spawn(resolveBinaryPath(), [
      '--sample-rate', String(SAMPLE_RATE),
      '--chunk-duration', '0.2',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeProcess = child

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cancelActiveCapture = null
      if (activeProcess === child) activeProcess = null
      terminate(child)
      if (error) {
        reject(error)
      } else {
        const pcm = Buffer.concat(chunks, totalBytes)
        if (hasAudibleSignal(pcm)) {
          resolve(pcm)
        } else {
          reject(new CaptureNoAudioError('未采集到系统声音。若其他 App 正在播放音乐，请在系统设置的“隐私与安全性 > 录屏与系统录音”中允许 LX Music 录制系统音频（授权后直接重试，无需重启应用）'))
        }
      }
    }

    cancelActiveCapture = () => {
      finish(new CaptureCancelledError())
    }

    child.once('error', error => {
      finish(error)
    })
    child.once('close', code => {
      if (!settled) finish(new Error(`系统音频采集组件已退出（${code ?? 'unknown'}）`))
    })
    child.stderr.on('data', (data: Buffer) => {
      const error = parseCaptureError(data)
      if (error) finish(error)
    })
    child.stdout.on('data', (data: Buffer) => {
      chunks.push(data)
      totalBytes += data.length
      onProgress(Math.min(totalBytes / TARGET_BYTES, 1))
      if (totalBytes >= TARGET_BYTES) finish()
    })

    timeout = setTimeout(() => {
      if (totalBytes >= MIN_BYTES) {
        finish()
      } else {
        finish(new CaptureNoAudioError('未检测到可识别的系统音频，请确认正在播放歌曲。若其他 App 正在播放音乐，请检查系统设置“隐私与安全性 > 录屏与系统录音”中 LX Music 的系统音频录制权限'))
      }
    }, CAPTURE_TIMEOUT_MS)
  })
}

export const stopCapture = () => {
  cancelActiveCapture?.()
  if (activeProcess) terminate(activeProcess)
}
