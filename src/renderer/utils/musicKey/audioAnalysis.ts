import { fetchSongKeyAudio } from '@renderer/utils/ipc'
import { NOTE_NAMES, analyzeAudioKey, formatKeyLabel, getCamelotCode, type NoteName } from './ksAlgorithm'

/**
 * 真实音频基调分析（带时间轴）。
 *
 * 歌曲中途转调很常见（主歌→副歌升 key），只取一个时间点做快照会丢信息。
 * 所以这里把整首歌切成滑动窗口逐段分析，得到一个"第几秒是什么调"的时间轴，
 * 播放时按当前进度取对应段落。
 *
 * 三条硬约束：
 *  1. 不复用播放器的 AudioContext，也不往播放链路挂节点 —— 分析再慢也不影响播放
 *  2. 逐窗口让出主线程，避免几秒钟的界面卡死
 *  3. 分析不出来就返回 null，绝不编造
 */

/** 首块取样大小，4MB 大致覆盖 320k MP3 的 100 秒、常见 FLAC 的 45 秒 */
const FIRST_CHUNK_BYTES = 4 * 1024 * 1024
/** 取全量做时间轴的上限，超过就退化成"只分析开头一段" */
export const TIMELINE_FETCH_LIMIT = 48 * 1024 * 1024
/** 分析用的降采样目标，调性只需要 65~990Hz，11kHz 足够且快 4 倍 */
const ANALYSIS_RATE = 11025
/** 滑动窗口长度与步进（秒）。窗口越长越稳但转调点越糊，
 *  12 秒 / 2 秒的组合能在保证调性判准的前提下把换调点定位到几秒内。 */
const WINDOW_SECONDS = 12
const HOP_SECONDS = 2
/** 单窗口低于该置信度视为不可信，交给平滑处理 */
const MIN_WINDOW_CONFIDENCE = 0.3
/** 中值平滑的半宽（窗口数），抑制边界处的抖动。
 *  取 2（5 个窗口一起看中值）能压掉只持续几秒的误判；
 *  中值是对称的，换调点仍落在"第一个新调窗口"上，不会带来额外偏移。 */
const SMOOTH_RADIUS = 2
/** 合并后短于该秒数的段并入相邻段，避免一闪而过的误判 */
const MIN_SEGMENT_SECONDS = 8
/** 每分析一个窗口让出一次主线程 */
const YIELD_EVERY_WINDOWS = 1
/** 低于该置信度不写入缓存，避免把一次算错的结果永久固化 */
export const MIN_CACHEABLE_CONFIDENCE = 0.5

let analysisContext: AudioContext | null = null

const getAnalysisContext = (): AudioContext | null => {
  if (analysisContext) return analysisContext
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    analysisContext = new Ctor()
    return analysisContext
  } catch {
    return null
  }
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer as ArrayBuffer
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** IPC 之后拿到的可能是 Uint8Array / ArrayBuffer / 普通数组，统一成 Uint8Array */
const toBytes = (input: unknown): Uint8Array | null => {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (Array.isArray(input)) return Uint8Array.from(input as number[])
  if (input && typeof input === 'object' && 'data' in (input as Record<string, unknown>)) {
    const data = (input as { data?: unknown }).data
    if (Array.isArray(data)) return Uint8Array.from(data as number[])
  }
  return null
}

const decodeAudio = async(bytes: Uint8Array): Promise<AudioBuffer | null> => {
  const ctx = getAnalysisContext()
  if (!ctx) return null
  try {
    return await ctx.decodeAudioData(toArrayBuffer(bytes))
  } catch {
    // 截断的容器（FLAC/ALAC 等）无法解码，由调用方决定是否取更大分片
    return null
  }
}

/**
 * 降采样成单声道低采样率。用 OfflineAudioContext 而不是简单抽取，
 * 因为直接丢样本会把高频折返到分析频段里污染色度。
 */
const resampleToMono = async(buffer: AudioBuffer): Promise<{ samples: Float32Array, sampleRate: number } | null> => {
  const targetRate = Math.min(ANALYSIS_RATE, buffer.sampleRate)
  const length = Math.max(1, Math.ceil(buffer.duration * targetRate))
  try {
    const Ctor = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!Ctor) return null
    const offline = new Ctor(1, length, targetRate)
    const source = offline.createBufferSource()
    source.buffer = buffer
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return { samples: rendered.getChannelData(0), sampleRate: rendered.sampleRate }
  } catch {
    return null
  }
}

const yieldToMain = async(): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

interface WindowResult {
  at: number
  index: number | null
  confidence: number
}

const analyzeWindows = async(
  samples: Float32Array,
  sampleRate: number,
): Promise<WindowResult[]> => {
  const windowLength = Math.floor(WINDOW_SECONDS * sampleRate)
  const hopLength = Math.floor(HOP_SECONDS * sampleRate)
  const total = samples.length
  const results: WindowResult[] = []

  // 歌太短就整段当一窗
  if (total <= windowLength) {
    const result = analyzeAudioKey(samples, sampleRate)
    return [{ at: 0, index: result.confidence > 0 ? NOTE_NAMES.indexOf(result.key as NoteName) * 2 + (result.scale === 'minor' ? 1 : 0) : null, confidence: result.confidence }]
  }

  let processed = 0
  for (let start = 0; start + Math.floor(windowLength / 2) <= total; start += hopLength) {
    const end = Math.min(total, start + windowLength)
    const slice = samples.subarray(start, end)
    const result = analyzeAudioKey(slice, sampleRate)
    const usable = result.confidence >= MIN_WINDOW_CONFIDENCE
    results.push({
      at: start / sampleRate,
      index: usable ? NOTE_NAMES.indexOf(result.key as NoteName) * 2 + (result.scale === 'minor' ? 1 : 0) : null,
      confidence: result.confidence,
    })
    processed += 1
    if (processed % YIELD_EVERY_WINDOWS === 0) await yieldToMain()
  }
  return results
}

/** 中值平滑：调性索引是"音名*2+大小调"的 0..23 序号，直接取中值即可 */
const smoothIndices = (results: WindowResult[]): Array<number | null> => {
  const indices = results.map((item) => item.index)
  const smoothed: Array<number | null> = []
  for (let i = 0; i < indices.length; i++) {
    const neighbourhood: number[] = []
    for (let j = Math.max(0, i - SMOOTH_RADIUS); j <= Math.min(indices.length - 1, i + SMOOTH_RADIUS); j++) {
      const value = indices[j]
      if (value != null) neighbourhood.push(value)
    }
    if (!neighbourhood.length) {
      smoothed.push(null)
      continue
    }
    neighbourhood.sort((a, b) => a - b)
    smoothed.push(neighbourhood[Math.floor(neighbourhood.length / 2)])
  }
  return smoothed
}

const indexToSegment = (index: number, at: number, confidence: number): LX.SongKey.Segment => {
  const root = NOTE_NAMES[Math.floor(index / 2)]
  const scale: LX.SongKey.Scale = index % 2 === 1 ? 'minor' : 'major'
  return {
    at,
    key: root,
    scale,
    label: formatKeyLabel(root, scale),
    camelot: getCamelotCode(root, scale),
    confidence,
  }
}

/** 把逐窗结果压成"调性变化点"列表，并合并过短的段 */
const buildTimeline = (results: WindowResult[]): LX.SongKey.Segment[] => {
  const smoothed = smoothIndices(results)
  // 窗口分类是在"窗口中心"越过真实边界时翻转的：起点为 s 的窗口中心是 s + W/2。
  // 所以检测到的换调窗口起点要加回半个窗口，才是真实的换调时刻。
  const halfWindow = WINDOW_SECONDS / 2
  const lastAt = results[results.length - 1].at + HOP_SECONDS
  const raw: LX.SongKey.Segment[] = []
  let current: number | null = null
  for (let i = 0; i < results.length; i++) {
    const index = smoothed[i]
    if (index == null) continue
    if (index === current) {
      // 同一段内取置信度更高的那次的数值
      const last = raw[raw.length - 1]
      if (last && results[i].confidence > last.confidence) last.confidence = results[i].confidence
      continue
    }
    current = index
    // 第一段固定从 0 开始，其余按半窗口回补真实换调点
    const at = raw.length === 0 ? 0 : Math.max(0, Math.min(lastAt, results[i].at + halfWindow))
    raw.push(indexToSegment(index, at, results[i].confidence))
  }
  if (!raw.length) return []

  // 保证时间轴严格递增（回补后可能挤到一起）
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].at <= raw[i - 1].at + 1) raw[i].at = raw[i - 1].at + 1
  }

  // 合并过短的段到前一段（第一段太短则并入后一段）
  const merged: LX.SongKey.Segment[] = []
  for (let i = 0; i < raw.length; i++) {
    const segment = raw[i]
    const next = raw[i + 1]
    const duration = (next ? next.at : lastAt) - segment.at
    if (duration < MIN_SEGMENT_SECONDS && merged.length) {
      const previous = merged[merged.length - 1]
      if (segment.confidence > previous.confidence) previous.confidence = segment.confidence
      continue
    }
    merged.push({ ...segment })
  }

  // 再次合并相邻且调性完全相同的段（短段被吃掉后，前后两段可能属于同一基调，不需要再多切一段）
  const deduped: LX.SongKey.Segment[] = []
  for (const seg of merged) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.key === seg.key && prev.scale === seg.scale) {
      if (seg.confidence > prev.confidence) prev.confidence = seg.confidence
      continue
    }
    deduped.push(seg)
  }
  if (deduped.length) deduped[0].at = 0
  return deduped
}

/** 出现时长最长的段，作为这首歌的代表调 */
const pickPrimary = (segments: LX.SongKey.Segment[], totalSeconds: number): LX.SongKey.Segment | null => {
  if (!segments.length) return null
  let best = segments[0]
  let bestSpan = -1
  for (let i = 0; i < segments.length; i++) {
    const end = i + 1 < segments.length ? segments[i + 1].at : totalSeconds
    const span = end - segments[i].at
    if (span > bestSpan) {
      bestSpan = span
      best = segments[i]
    }
  }
  return best
}

/**
 * 对给定音源做一次带时间轴的基调分析。
 * source 为播放器当前使用的音源（http(s) URL 或本地绝对路径）。
 */
export const analyzeSongAudio = async(
  source: string,
  onProgress?: (early: LX.SongKey.KeyInfo) => void,
): Promise<LX.SongKey.KeyInfo | null> => {
  if (!source) return null

  const first = await fetchSongKeyAudio(source, FIRST_CHUNK_BYTES)
  const firstBytes = toBytes(first?.bytes)
  if (!firstBytes?.length) return null

  let decoded = await decodeAudio(firstBytes)

  // 毫秒级先出初值：首块（4MB，约覆盖前 40~90 秒）解码后立即做一次单窗速算并推给界面，
  // 保证用户在 1 秒内就能看到基调，无需等待几十 MB 的全轨下载完成！
  if (decoded && onProgress) {
    void resampleToMono(decoded).then((earlyResampled) => {
      if (!earlyResampled || earlyResampled.samples.length < 1024) return
      const early = analyzeAudioKey(earlyResampled.samples, earlyResampled.sampleRate)
      if (early.confidence > 0) {
        onProgress({
          key: early.key,
          scale: early.scale,
          label: early.label,
          camelot: early.camelot,
          source: 'analysis',
          confidence: early.confidence,
          updatedAt: Date.now(),
        })
      }
    }).catch(() => {})
  }

  // 两种情况都要取全量：首块解码失败（容器需要完整文件），
  // 或者首块被截断（时间轴要覆盖整首歌，不能只看开头）。
  const total = first?.totalBytes ?? 0
  const canFetchAll = Boolean(first?.truncated) && total > firstBytes.length && total <= TIMELINE_FETCH_LIMIT
  if (canFetchAll) {
    const full = await fetchSongKeyAudio(source, total)
    const fullBytes = toBytes(full?.bytes)
    if (fullBytes?.length) {
      // 全量解码仍然失败时保留首块的结果（若能解出来的话）
      decoded = (await decodeAudio(fullBytes)) ?? decoded
    }
  }
  if (!decoded) return null

  const resampled = await resampleToMono(decoded)
  if (!resampled || resampled.samples.length < 1024) return null

  const results = await analyzeWindows(resampled.samples, resampled.sampleRate)
  let timeline = buildTimeline(results)
  let primary: LX.SongKey.Segment | null = null

  if (timeline.length) {
    primary = pickPrimary(timeline, decoded.duration)
  } else {
    // 逐窗分析因局部杂音/低音量未达到置信门槛时，对整曲全量采样跑一次全局 K-S 分析兜底，
    // 保证有歌曲播放时绝不轻易返回空，解决"偶尔不显示"的问题
    const fallback = analyzeAudioKey(resampled.samples, resampled.sampleRate)
    if (fallback.confidence > 0) {
      primary = {
        at: 0,
        key: fallback.key,
        scale: fallback.scale,
        label: fallback.label,
        camelot: fallback.camelot,
        confidence: fallback.confidence,
      }
      timeline = [primary]
    }
  }

  if (!primary || !timeline.length) return null

  return {
    key: primary.key,
    scale: primary.scale,
    label: primary.label,
    camelot: primary.camelot,
    source: 'analysis',
    confidence: primary.confidence,
    timeline,
    updatedAt: Date.now(),
  }
}

/**
 * 按播放位置取时间轴上对应的段。位置超出末尾时返回最后一段。
 */
export const segmentAt = (
  timeline: LX.SongKey.Segment[] | undefined,
  seconds: number,
): LX.SongKey.Segment | null => {
  if (!timeline?.length) return null
  let found = timeline[0]
  for (const segment of timeline) {
    if (segment.at <= seconds) found = segment
    else break
  }
  return found
}
