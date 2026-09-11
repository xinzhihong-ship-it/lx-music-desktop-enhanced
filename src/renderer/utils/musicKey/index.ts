import { getUserSongKeys, saveUserSongKeys } from '@renderer/utils/ipc'
import { analyzeAudioKey, formatKeyLabel, getCamelotCode, normalizeNote, type NoteName } from './ksAlgorithm'
import { findDatabaseSongKey, normalizeSongKeyIdentifier } from './database'

export * from './ksAlgorithm'
export * from './database'
export * from './audioAnalysis'
export * from './pluginSync'

let cachedUserKeys: LX.SongKey.UserSongKeys | null = null

export const loadUserSongKeys = async(): Promise<LX.SongKey.UserSongKeys> => {
  if (cachedUserKeys) return cachedUserKeys
  let keys: LX.SongKey.UserSongKeys = {}
  try {
    keys = (await getUserSongKeys()) ?? {}
  } catch {
    keys = {}
  }
  // eslint-disable-next-line require-atomic-updates
  cachedUserKeys = keys
  return keys
}

export const getSavedUserKey = async(name: string, singer: string): Promise<LX.SongKey.KeyInfo | null> => {
  const keys = await loadUserSongKeys()
  const id = normalizeSongKeyIdentifier(name, singer)
  return keys[id] ?? null
}

export const setUserKey = async(
  name: string,
  singer: string,
  key: NoteName,
  scale: LX.SongKey.Scale,
): Promise<LX.SongKey.KeyInfo> => {
  const keys = await loadUserSongKeys()
  const id = normalizeSongKeyIdentifier(name, singer)
  const keyInfo: LX.SongKey.KeyInfo = {
    key,
    scale,
    label: formatKeyLabel(key, scale),
    camelot: getCamelotCode(key, scale),
    source: 'user',
    custom: true,
    confidence: 1,
    updatedAt: Date.now(),
  }
  keys[id] = keyInfo
  // eslint-disable-next-line require-atomic-updates
  cachedUserKeys = keys
  saveUserSongKeys(keys)
  return keyInfo
}

export const clearUserKey = async(name: string, singer: string): Promise<void> => {
  const keys = await loadUserSongKeys()
  const id = normalizeSongKeyIdentifier(name, singer)
  if (keys[id]) {
    Reflect.deleteProperty(keys, id)
    // eslint-disable-next-line require-atomic-updates
    cachedUserKeys = keys
    saveUserSongKeys(keys)
  }
}

/**
 * 规整用户手填的时间轴：按时间排序、去掉非法项、第一段强制从 0 开始、
 * 合并挤在同一秒的重复段。用户输入不可控，落库前必须先洗一遍。
 */
export const normalizeUserTimeline = (input: LX.SongKey.Segment[]): LX.SongKey.Segment[] => {
  const valid = (input ?? [])
    .filter((item) => item && Number.isFinite(item.at) && item.at >= 0 && !!item.key && !!item.scale)
    .map((item) => ({
      at: Math.max(0, Math.round(item.at)),
      key: normalizeNote(String(item.key)),
      scale: item.scale === 'minor' ? 'minor' as const : 'major' as const,
      label: '',
      camelot: '',
      confidence: 1,
    }))
    .sort((a, b) => a.at - b.at)

  const deduped: typeof valid = []
  for (const item of valid) {
    const previous = deduped[deduped.length - 1]
    // 同一秒只保留最后一条（用户是在改这一段）
    if (previous && previous.at === item.at) {
      deduped[deduped.length - 1] = item
      continue
    }
    // 相邻且调性完全相同的段自动合并，避免"1:04 Cm"与"1:30 Cm"连续重复
    if (previous && previous.key === item.key && previous.scale === item.scale) {
      continue
    }
    deduped.push(item)
  }
  if (!deduped.length) return []
  deduped[0].at = 0

  return deduped.map((item) => ({
    ...item,
    label: formatKeyLabel(item.key as NoteName, item.scale),
    camelot: getCamelotCode(item.key as NoteName, item.scale),
  }))
}

/**
 * 记住用户自定义的分段基调（整首歌按时间段各是一个调）。
 * 这是最高优先级：曲库和音频分析都不会覆盖它。
 */
export const setUserKeyTimeline = async(
  name: string,
  singer: string,
  segments: LX.SongKey.Segment[],
): Promise<LX.SongKey.KeyInfo | null> => {
  const timeline = normalizeUserTimeline(segments)
  if (!timeline.length) return null

  const keys = await loadUserSongKeys()
  const id = normalizeSongKeyIdentifier(name, singer)
  const primary = timeline[0]
  const keyInfo: LX.SongKey.KeyInfo = {
    key: primary.key,
    scale: primary.scale,
    label: primary.label,
    camelot: primary.camelot,
    source: 'user',
    custom: true,
    confidence: 1,
    timeline,
    updatedAt: Date.now(),
  }
  keys[id] = keyInfo
  // eslint-disable-next-line require-atomic-updates
  cachedUserKeys = keys
  saveUserSongKeys(keys)
  return keyInfo
}

/**
 * 记住一次音频分析的结果，之后同一首歌直接命中缓存，不再重新下载解码。
 * 用户手动设定的基调优先级更高，不会被分析结果覆盖。
 */
export const saveAnalyzedKey = async(
  name: string,
  singer: string,
  info: LX.SongKey.KeyInfo,
): Promise<LX.SongKey.KeyInfo> => {
  const keys = await loadUserSongKeys()
  const id = normalizeSongKeyIdentifier(name, singer)
  const existing = keys[id]
  if (existing?.source === 'user') return existing

  const stored: LX.SongKey.KeyInfo = {
    key: info.key,
    scale: info.scale,
    label: info.label,
    camelot: info.camelot,
    source: 'analysis',
    confidence: info.confidence,
    custom: false,
    timeline: info.timeline,
    updatedAt: info.updatedAt ?? Date.now(),
  }
  keys[id] = stored
  // eslint-disable-next-line require-atomic-updates
  cachedUserKeys = keys
  saveUserSongKeys(keys)
  return stored
}

/**
 * 同步快速查调（从已加载的内存缓存和曲库中查）。
 * 切歌时 0ms 响应，避免异步等待导致界面闪烁"分析中…"或重复触发下载。
 */
export const resolveSongKeySync = (
  name: string,
  singer: string,
): LX.SongKey.KeyInfo | null => {
  if (!name) return null
  const id = normalizeSongKeyIdentifier(name, singer)
  const saved = cachedUserKeys?.[id]
  // 1. 用户手动记忆
  if (saved?.source === 'user') return saved

  // 2. 内置曲库优先于之前的自动分析缓存
  const dbKey = findDatabaseSongKey(name, singer)
  if (dbKey) return dbKey

  // 3. 之前分析过的缓存结果直接复用
  if (saved) return saved

  return null
}

/**
 * Resolve song key with priority:
 * 1. User remembered key (Highest priority)
 * 2. Curated database (Official/verified)
 * 3. Previously analysed result (local cache)
 * 4. Returns null, indicating a fresh audio analysis should be run
 */
export const resolveSongKey = async(
  name: string,
  singer: string,
): Promise<LX.SongKey.KeyInfo | null> => {
  if (!name) return null

  const saved = await getSavedUserKey(name, singer)
  // 1. 用户手动记忆
  if (saved?.source === 'user') return saved

  // 2. 内置曲库优先于之前的自动分析缓存
  const dbKey = findDatabaseSongKey(name, singer)
  if (dbKey) return dbKey

  // 3. 之前分析过的结果直接复用
  if (saved) return saved

  return null
}

/**
 * Perform audio key analysis on an audio buffer or samples
 */
export const analyzeAudioBuffer = (
  audioBuffer: AudioBuffer,
): LX.SongKey.KeyInfo => {
  const channelData = audioBuffer.getChannelData(0)
  // Take up to 20 seconds of audio around the middle/start
  const sampleRate = audioBuffer.sampleRate
  const maxSamples = Math.min(channelData.length, Math.floor(sampleRate * 20))
  const slice = channelData.subarray(0, maxSamples)
  const result = analyzeAudioKey(slice, sampleRate)
  return {
    ...result,
    source: 'analysis',
  }
}
