// 跨平台歌词搜索：在各平台“先搜歌，再取这首歌的歌词”。
// 只复用各平台已有的协议层（musicSearch.search / getLyric），匹配和打分在 @common/utils/lyrics/match。
import musicSdk from '@renderer/utils/musicSdk'
import { getLyricRaw, saveLyric } from '@renderer/utils/ipc'
import {
  AUTO_MATCH_SCORE,
  buildSearchKeyword,
  hasTimedLyric,
  parseDuration,
  relevanceScore,
  scoreCandidate,
  scoreParts,
  type MatchSubject,
} from '@common/utils/lyrics'

export const LYRIC_PLATFORMS = ['kg', 'tx', 'wy', 'kw', 'mg'] as const
export type LyricPlatform = typeof LYRIC_PLATFORMS[number]

export const isLyricPlatform = (source: string): source is LyricPlatform => (LYRIC_PLATFORMS as readonly string[]).includes(source)

export interface LyricCandidate {
  /** `${platform}_${songmid}`，与该平台歌曲的 musicInfo.id 一致，原始歌词按它缓存 */
  key: string
  platform: LyricPlatform
  songmid: string
  name: string
  singer: string
  album: string
  interval: string
  /** 秒 */
  duration: number
  /** 0~85；null 表示时长差太大（不参与自动匹配） */
  score: number | null
  /** 歌名是否对得上（默认关键词搜索时，对不上的不展示） */
  titleMatch: boolean
  /** 时长相差超过 10 秒（Live / 剪辑版等） */
  durationMismatch: boolean
  /** 搜索面板排序用：歌名对得上的永远在前 */
  relevance: number
  /** 取词需要的平台原始字段 */
  musicInfo: Record<string, any>
}

export interface LyricSearchResult {
  candidates: LyricCandidate[]
  /** 搜索失败或超时的平台 */
  failed: LyricPlatform[]
}

const SEARCH_TIMEOUT = 12000
const FETCH_TIMEOUT = 10000
const SEARCH_LIMIT = 10
const MAX_CONCURRENCY = 3

// 取词需要的字段（酷狗 hash、咪咕歌词地址等）；不保留音质列表等大字段
const KEPT_FIELDS = ['name', 'singer', 'albumName', 'albumId', 'songmid', 'source', 'interval', '_interval', 'hash', 'copyrightId', 'lrcUrl', 'mrcUrl', 'trcUrl'] as const

const pickMusicInfo = (info: Record<string, any>) => {
  const picked: Record<string, any> = {}
  for (const field of KEPT_FIELDS) if (info[field] != null) picked[field] = info[field]
  return picked
}

const withTimeout = async<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new Error('timeout'))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 并发上限为 limit 地依次执行 */
const runPool = async<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async() => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

const toCandidate = (platform: LyricPlatform, info: Record<string, any>, query: MatchSubject | null): LyricCandidate | null => {
  const songmid = info.songmid == null ? '' : String(info.songmid)
  if (!songmid || !info.name) return null
  const subject: MatchSubject = {
    name: String(info.name),
    singer: String(info.singer ?? ''),
    album: String(info.albumName ?? ''),
    duration: parseDuration(info._interval ?? info.interval),
  }
  const parts = query ? scoreParts(query, subject) : null
  return {
    key: `${platform}_${songmid}`,
    platform,
    songmid,
    name: subject.name,
    singer: subject.singer,
    album: subject.album ?? '',
    interval: String(info.interval ?? ''),
    duration: subject.duration,
    score: query ? scoreCandidate(query, subject) : 0,
    titleMatch: parts ? parts.title > 0 : true,
    durationMismatch: parts?.durationMismatch ?? false,
    relevance: parts ? relevanceScore(parts) : 0,
    musicInfo: pickMusicInfo(info),
  }
}

export const searchPlatform = async(platform: LyricPlatform, keyword: string, query: MatchSubject | null): Promise<LyricCandidate[]> => {
  const search = (musicSdk as any)[platform]?.musicSearch
  if (!search) return []
  const result = await withTimeout<{ list?: Array<Record<string, any>> }>(search.search(keyword, 1, SEARCH_LIMIT), SEARCH_TIMEOUT)
  const candidates: LyricCandidate[] = []
  for (const info of result?.list ?? []) {
    const candidate = toCandidate(platform, info, query)
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

export const compareCandidates = (a: LyricCandidate, b: LyricCandidate) => b.relevance - a.relevance

/**
 * 在多个平台搜索歌词候选。keyword 为空时用“歌名 + 第一位歌手”。
 * query 为当前歌曲信息，用于打分；手动输入的关键词也按它打分（用户改关键词时可传 null 不打分）。
 */
export const searchLyricCandidates = async({ keyword, query, platforms = LYRIC_PLATFORMS, onPlatform }: {
  keyword?: string
  query: MatchSubject | null
  platforms?: readonly LyricPlatform[]
  /** 每个平台返回（或失败）时立即回调，界面可以边搜边显示 */
  onPlatform?: (platform: LyricPlatform, candidates: LyricCandidate[] | null) => void
}): Promise<LyricSearchResult> => {
  const text = (keyword ?? '').trim() || (query ? buildSearchKeyword(query) : '')
  if (!text) return { candidates: [], failed: [] }
  const failed: LyricPlatform[] = []
  const lists = await runPool(platforms, MAX_CONCURRENCY, async platform => {
    try {
      const list = await searchPlatform(platform, text, query)
      onPlatform?.(platform, list)
      return list
    } catch (err) {
      console.warn(`lyric search failed: ${platform}`, err)
      failed.push(platform)
      onPlatform?.(platform, null)
      return []
    }
  })
  const seen = new Set<string>()
  const candidates: LyricCandidate[] = []
  for (const candidate of lists.flat()) {
    if (seen.has(candidate.key)) continue
    seen.add(candidate.key)
    candidates.push(candidate)
  }
  candidates.sort(compareCandidates)
  return { candidates, failed }
}

const toLyricInfo = (info: Partial<LX.Music.LyricInfo> | null | undefined): LX.Music.LyricInfo => ({
  lyric: info?.lyric ?? '',
  tlyric: info?.tlyric ?? '',
  rlyric: info?.rlyric ?? '',
  lxlyric: info?.lxlyric ?? '',
})

/** 取某个候选的歌词：先读缓存，没有再请求平台；必须含带时间戳的歌词行 */
export const fetchCandidateLyric = async(candidate: Pick<LyricCandidate, 'key' | 'platform' | 'musicInfo'>, { useCache = true } = {}): Promise<LX.Music.LyricInfo> => {
  const cacheKey = { id: candidate.key } as unknown as LX.Music.MusicInfo
  if (useCache) {
    const cached = await getLyricRaw(cacheKey).catch(() => null)
    if (cached && hasTimedLyric(cached.lyric)) return toLyricInfo(cached)
  }
  const api = (musicSdk as any)[candidate.platform]
  if (!api?.getLyric) throw new Error(`unsupported lyric platform: ${candidate.platform}`)
  const request = api.getLyric({ ...candidate.musicInfo, source: candidate.platform })
  const info = toLyricInfo(await withTimeout<LX.Music.LyricInfo>(request.promise, FETCH_TIMEOUT, () => request.cancelHttp?.()))
  if (!hasTimedLyric(info.lyric)) throw new Error('no timed lyric')
  void saveLyric(cacheKey, info).catch(() => {})
  return info
}

/**
 * 自动跨平台匹配：只采用 ≥ AUTO_MATCH_SCORE 的候选，按分数依次尝试前 3 个。
 * excludePlatform 为歌曲自身平台（它已经失败过）。
 */
export const autoMatchLyric = async(query: MatchSubject, excludePlatform?: string): Promise<{ candidate: LyricCandidate, lyricInfo: LX.Music.LyricInfo } | null> => {
  if (!query.name.trim()) return null
  const platforms = LYRIC_PLATFORMS.filter(platform => platform != excludePlatform)
  const { candidates } = await searchLyricCandidates({ query, platforms })
  const accepted = candidates
    .filter(candidate => (candidate.score ?? 0) >= AUTO_MATCH_SCORE)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3)
  for (const candidate of accepted) {
    try {
      return { candidate, lyricInfo: await fetchCandidateLyric(candidate) }
    } catch (err) {
      console.warn(`lyric fetch failed: ${candidate.key}`, err)
    }
  }
  return null
}
