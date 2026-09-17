import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { getBinaryPath } from './ffmpegBinary'

/**
 * 基调分析用的音频取样模块。
 *
 * 只取音频开头的一段字节给渲染进程解码，避免为了一首歌的调性把整个
 * 无损文件（动辄几十 MB）全部拉下来。远端用 HTTP Range 请求，本地文件
 * 直接读前 N 字节。
 */

export interface SongKeyAudioChunk {
  bytes: Uint8Array
  /** 音频总字节数，服务端未告知时为 null */
  totalBytes: number | null
  /** 是否只拿到了开头一段（调用方可在解码失败时申请更大分片） */
  truncated: boolean
}

const DEFAULT_TIMEOUT_MS = 15000
const MAX_BYTES_LIMIT = 96 * 1024 * 1024

const clampMaxBytes = (value: unknown): number => {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  if (num <= 0) return 0
  return Math.min(num, MAX_BYTES_LIMIT)
}

const parseContentRange = (value: string | null) => {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? '')
  if (!match) return null
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  }
}

const readLimited = async(response: Response, maxBytes: number, signal: AbortSignal) => {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, maxBytes - length)
      chunks.push(chunk)
      length += chunk.length
      if (chunk.length < value.length || length === maxBytes) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (signal.aborted) return new Uint8Array()
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/**
 * 解析出真实存在的文件路径。
 * 播放器记录的音源地址来自音源脚本时，本地歌曲的中文/空格文件名会以百分号编码传过来
 * （例如 /Users/…/Desktop/%E7%99%BD%E9%9C%B2.mp3），按字面路径读会找不到文件，表现为基调分析静默失败。
 * 这里先按原样查找，找不到再尝试解码后的路径。
 */
const resolveLocalPath = async(source: string): Promise<string> => {
  if ((await fs.stat(source).catch(() => null))?.isFile()) return source
  try {
    const decoded = decodeURIComponent(source)
    if (decoded !== source && (await fs.stat(decoded).catch(() => null))?.isFile()) return decoded
  } catch {
    // 路径本身含非法 % 序列时忽略，按原路径处理
  }
  return source
}

const readLocal = async(source: string, maxBytes: number): Promise<SongKeyAudioChunk | null> => {
  source = await resolveLocalPath(source)
  const stats = await fs.stat(source).catch(() => null)
  if (!stats?.isFile()) return null
  const length = Math.min(stats.size, maxBytes)
  if (length <= 0) return null
  const handle = await fs.open(source, 'r')
  try {
    const bytes = new Uint8Array(length)
    await handle.read(bytes, 0, length, 0)
    return {
      bytes,
      totalBytes: stats.size,
      truncated: stats.size > length,
    }
  } finally {
    await handle.close()
  }
}

const readRemote = async(
  source: string,
  maxBytes: number,
  headers: Record<string, string>,
): Promise<SongKeyAudioChunk | null> => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, DEFAULT_TIMEOUT_MS)
  try {
    const response = await fetch(source, {
      signal: controller.signal,
      headers: { ...headers, Range: `bytes=0-${maxBytes - 1}` },
    })
    if (!response.ok) return null
    let total: number | null = null
    if (response.status === 206) {
      const range = parseContentRange(response.headers.get('content-range'))
      if (!range || range.start !== 0) return null
      total = range.total
    } else {
      const declared = Number(response.headers.get('content-length'))
      total = Number.isInteger(declared) && declared > 0 ? declared : null
    }
    const bytes = await readLimited(response, maxBytes, controller.signal)
    if (!bytes.length) return null
    return {
      bytes,
      totalBytes: total,
      // 服务端给了 Range 但只返回了一部分，或声明的大小超过本次请求量
      truncated: total != null ? total > bytes.length : bytes.length === maxBytes,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 取音频开头的一段字节。source 支持 http(s) URL 与本地绝对路径。
 */
export const fetchSongKeyAudio = async(
  source: string,
  maxBytes: number,
  headers: Record<string, string> = {},
): Promise<SongKeyAudioChunk | null> => {
  const limit = clampMaxBytes(maxBytes)
  if (!limit) return null
  if (/^https?:\/\//i.test(source)) return await readRemote(source, limit, headers)
  return await readLocal(source, limit)
}

export interface SongKeyPcmResult {
  /** 11kHz 单声道 s16le PCM */
  pcm: Uint8Array
  sampleRate: number
  /** PCM 覆盖的音频时长（秒） */
  duration: number
  /** 是否只解出了开头一段（超过时长上限 / 中途超时被截断） */
  truncated: boolean
}

/** 分析只需要 65~990Hz，11kHz 单声道足够，全曲也就几 MB */
const PCM_SAMPLE_RATE = 11025
/** 单次分析最多解这么长的音频，防止超长音频把内存和 IPC 撑爆 */
const PCM_MAX_SECONDS = 600
const PCM_TIMEOUT_MS = 90000
/** 建连 + 响应头超时：服务端"接上但不回数据"时不能让分析干等（undici 默认要 5 分钟） */
const PCM_RESPONSE_TIMEOUT_MS = 15000

/**
 * 用随包分发的 ffmpeg 把整首歌解码成分析用的 PCM。
 *
 * 为什么不在渲染进程用 decodeAudioData：大文件只能整容器下载后再解码，
 * 一首 4 分钟的 48kHz 无损就 50~100MB（还有解出来的上百 MB PCM），
 * 所以旧实现遇到大文件只能退化成"只分析开头 4MB"（约 20 秒），
 * 时间轴严重失真。这里让 ffmpeg 直接解码并降采样，全曲也只有几 MB。
 *
 * 注意：macOS 上的 ffmpeg 是 --disable-network 构建，不能自己联网，
 * 远端音源由主进程取流（跟随应用代理）灌进 stdin，ffmpeg 只负责解码。
 */
export const decodeSongKeyPcm = async(
  source: string,
  headers: Record<string, string> = {},
  options: { sampleRate?: number, maxSeconds?: number, timeoutMs?: number, responseTimeoutMs?: number } = {},
): Promise<SongKeyPcmResult | null> => {
  let binary: string
  try {
    binary = getBinaryPath('ffmpeg')
  } catch {
    // 没有随包分发 ffmpeg（如未经构建的开发环境）：调用方降级处理
    return null
  }

  const sampleRate = options.sampleRate ?? PCM_SAMPLE_RATE
  const maxSeconds = options.maxSeconds ?? PCM_MAX_SECONDS
  const timeoutMs = options.timeoutMs ?? PCM_TIMEOUT_MS
  const responseTimeoutMs = options.responseTimeoutMs ?? PCM_RESPONSE_TIMEOUT_MS
  const maxBytes = Math.floor(sampleRate * maxSeconds) * 2

  const controller = new AbortController()
  let input: Readable | null = null
  let inputArgs: string[]

  if (/^https?:\/\//i.test(source)) {
    // 只包住建连与响应头阶段：收到 body 后由上面的空闲计时器接管（大文件下载慢是正常的）
    const responseTimer = setTimeout(() => { controller.abort() }, responseTimeoutMs)
    const response = await fetch(source, { headers, signal: controller.signal })
      .catch(() => null)
      .finally(() => { clearTimeout(responseTimer) })
    if (!response?.ok || !response.body) return null
    input = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    inputArgs = ['-i', 'pipe:0']
  } else {
    const localPath = await resolveLocalPath(source)
    if (!(await fs.stat(localPath).catch(() => null))?.isFile()) return null
    inputArgs = ['-i', localPath]
  }

  return await new Promise<SongKeyPcmResult | null>((resolve) => {
    const args = [
      '-hide_banner', '-v', 'error',
      ...inputArgs,
      '-vn', '-map', '0:a:0?',
      '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', String(sampleRate),
      '-t', String(maxSeconds),
      'pipe:1',
    ]

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'ignore'] })
    } catch {
      resolve(null)
      return
    }

    const chunks: Buffer[] = []
    let length = 0
    let early = false
    let settled = false

    const finish = (result: SongKeyPcmResult | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      controller.abort()
      input?.destroy()
      // 单靠 SIGTERM 不够：如果 ffmpeg 正卡在读取 stdin，它可能不会立刻退出。
      // 先关掉 stdin（本地文件场景本来就没有 stdin），再补一记 SIGKILL 兜底。
      child.stdin?.destroy()
      child.kill()
      const hardKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2000)
      if (typeof hardKill.unref === 'function') hardKill.unref()
      resolve(result)
    }

    const collect = (): SongKeyPcmResult | null => {
      if (length < sampleRate * 2) return null
      return {
        pcm: new Uint8Array(Buffer.concat(chunks, length)),
        sampleRate,
        duration: length / 2 / sampleRate,
        truncated: early || length >= maxBytes,
      }
    }

    // 空闲超时：只要 PCM 还在持续产出就不打断（大文件下载慢是正常的），
    // 卡住不动才放弃，并保留已经解出来的部分（时间轴短一些但仍是真实结果）。
    const timer = setTimeout(() => {
      early = true
      finish(collect())
    }, timeoutMs)

    if (input) {
      input.on('error', () => { finish(collect()) })
      input.pipe(child.stdin!)
      child.stdin!.on('error', () => {})
    }

    child.stdout!.on('data', (chunk: Buffer) => {
      if (settled) return
      timer.refresh()
      const room = maxBytes - length
      if (room <= 0) return
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk
      chunks.push(slice)
      length += slice.length
      if (length >= maxBytes) {
        early = true
        finish(collect())
      }
    })
    child.on('error', () => { finish(null) })
    child.on('close', () => { finish(collect()) })
  })
}
