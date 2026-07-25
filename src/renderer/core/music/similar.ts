import musicSdk from '@renderer/utils/musicSdk'
import { getSimilarSongs as getPlatformSimilarSongs } from '@renderer/utils/ipc'
import { toNewMusicInfo } from '@renderer/utils'

export interface SimilarSongSeed {
  id: string
  name: string
  singer: string
  source: LX.Source
  interval: string | null
  meta: {
    songId: string | number
    platformId?: string | number
    hash?: string
    albumName: string
  }
}

const SINGER_SPLIT_RXP = /、|&|;|；|\/|,|，|\|/

const normalizeText = (text: string) => text
  .toLowerCase()
  .replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！|_/g, '')

const normalizeBaseTitle = (name: string) => normalizeText(name.replace(/[（(][^）)]*[）)]/g, ''))

const singerNames = (singer: string) => singer
  .split(SINGER_SPLIT_RXP)
  .map(name => normalizeText(name))
  .filter(Boolean)

const normalizeSinger = (singer: string) => singerNames(singer)
  .sort((a, b) => a.localeCompare(b))
  .join('、')

const hasSingerOverlap = (a: string, b: string) => {
  const aNames = singerNames(a)
  const bNames = singerNames(b)
  return !aNames.length || !bNames.length || aNames.some(name => bNames.includes(name))
}

const hasKnownSingerOverlap = (a: string, b: string) => {
  const aNames = singerNames(a)
  const bNames = singerNames(b)
  return Boolean(aNames.length && bNames.length && aNames.some(name => bNames.includes(name)))
}

const intervalToSeconds = (interval: string | null) => {
  if (!interval) return 0
  return interval.split(':').reduce((total, value) => total * 60 + Number(value || 0), 0)
}

const isSameRecording = (a: SimilarSongSeed, b: SimilarSongSeed) => {
  if (a.source === b.source && String(a.meta.songId) === String(b.meta.songId)) return true
  if (normalizeText(a.name) !== normalizeText(b.name)) return false
  const aSinger = normalizeSinger(a.singer)
  const bSinger = normalizeSinger(b.singer)
  if (!aSinger || !bSinger) return false
  if (aSinger !== bSinger) return false
  const aInterval = intervalToSeconds(a.interval)
  const bInterval = intervalToSeconds(b.interval)
  return !aInterval || !bInterval || Math.abs(aInterval - bInterval) < 5
}

const filterSimilarList = (
  list: LX.Music.MusicInfoOnline[],
  seed: SimilarSongSeed,
  limit: number,
) => {
  const result: LX.Music.MusicInfoOnline[] = []
  for (const item of list) {
    if (isSameRecording(item, seed)) continue
    if (result.some(current => isSameRecording(current, item))) continue
    result.push(item)
    if (result.length >= limit) break
  }
  return result
}

const findWySeed = async(seed: SimilarSongSeed): Promise<LX.Music.MusicInfoOnline | null> => {
  const result = await musicSdk.wy.musicSearch.search(`${seed.name} ${seed.singer}`.trim(), 1, 30)
  const candidates = (result.list ?? []).map((item: any) => toNewMusicInfo(item) as LX.Music.MusicInfoOnline)
  const seedInterval = intervalToSeconds(seed.interval)
  let bestMatch: { score: number, info: LX.Music.MusicInfoOnline } | null = null
  for (const candidate of candidates) {
    if (normalizeBaseTitle(candidate.name) !== normalizeBaseTitle(seed.name)) continue
    if (!hasSingerOverlap(candidate.singer, seed.singer)) continue
    const candidateInterval = intervalToSeconds(candidate.interval)
    const intervalDiff = seedInterval && candidateInterval ? Math.abs(seedInterval - candidateInterval) : 0
    if (intervalDiff > 12) continue
    let score = normalizeText(candidate.name) === normalizeText(seed.name) ? 30 : 15
    if (normalizeSinger(candidate.singer) === normalizeSinger(seed.singer)) score += 20
    score += Math.max(0, 12 - intervalDiff)
    if (!bestMatch || score > bestMatch.score) bestMatch = { score, info: candidate }
  }
  return bestMatch?.info ?? null
}

const loadPlatformSimilar = async(
  seed: SimilarSongSeed,
  source: LX.OnlineSource,
  songId: string | number,
  limit: number,
  platformId?: string | number,
  hash?: string,
) => {
  const result = await getPlatformSimilarSongs({ source, songId, platformId, hash, limit })
  const list = filterSimilarList(result.list.filter(item => !hasKnownSingerOverlap(item.singer, seed.singer)), seed, limit)
  if (!list.length) return null
  return {
    ...result,
    list,
    seedSource: seed.source,
  }
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const loadSimilarSongs = async(
  seed: SimilarSongSeed,
  limit = 50,
): Promise<LX.Music.SimilarSongsResult> => {
  const partialErrors: LX.Music.SimilarSongsPartialError[] = []
  if ((seed.source === 'wy' || seed.source === 'tx' || seed.source === 'kg') && seed.meta.songId) {
    try {
      const result = await loadPlatformSimilar(seed, seed.source, seed.meta.songId, limit, seed.meta.platformId, seed.meta.hash)
      if (result) return result
    } catch (error) {
      partialErrors.push({ source: seed.source, message: getErrorMessage(error) })
      console.warn(`[similar songs] ${seed.source} recommendation unavailable:`, error)
    }
  }
  if (seed.source !== 'wy') {
    try {
      const mappedSeed = await findWySeed(seed)
      if (mappedSeed) {
        const result = await loadPlatformSimilar(seed, 'wy', mappedSeed.meta.songId, limit)
        if (result) {
          return {
            ...result,
            ...(partialErrors.length
              ? { partialErrors: [...(result.partialErrors ?? []), ...partialErrors] }
              : {}),
          }
        }
      }
    } catch (error) {
      partialErrors.push({ source: 'wy', message: getErrorMessage(error) })
      console.warn('[similar songs] NetEase mapped recommendation unavailable:', error)
    }
  }
  return {
    list: [],
    mode: 'unavailable',
    seedSource: seed.source,
    ...(partialErrors.length ? { partialErrors } : {}),
  }
}
