import fs from 'node:fs/promises'

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

const readLocal = async(source: string, maxBytes: number): Promise<SongKeyAudioChunk | null> => {
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
