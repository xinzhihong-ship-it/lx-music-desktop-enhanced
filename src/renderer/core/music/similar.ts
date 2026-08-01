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

const ensureQualityIndex = (item: LX.Music.MusicInfoOnline) => {
  item.meta._qualitys ||= {}
  for (const quality of item.meta.qualitys ?? []) {
    item.meta._qualitys[quality.type] ||= { size: quality.size }
  }
  return item
}

const similarSources: LX.OnlineSource[] = ['wy', 'tx', 'kg', 'bili']

const mergeMusicInfo = (target: LX.Music.MusicInfoOnline, source: LX.Music.MusicInfoOnline) => {
  target.meta.albumName ||= source.meta.albumName
  target.interval ||= source.interval
  target.meta.picUrl ||= source.meta.picUrl
  for (const quality of source.meta.qualitys ?? []) {
    if (!target.meta._qualitys[quality.type]) (target.meta.qualitys as any[]).push(quality)
    target.meta._qualitys[quality.type] ||= { size: quality.size }
  }
}

const hydrateSimilarList = async(list: LX.Music.MusicInfoOnline[], source: LX.OnlineSource) => {
  const sdk = musicSdk[source]
  if (!sdk?.musicSearch?.search) return list
  return Promise.all(list.map(async item => {
    const result = await sdk.musicSearch.search(`${item.name} ${item.singer}`.trim(), 1, 10).catch(() => null)
    const match = (result?.list ?? [])
      .map((raw: any) => ensureQualityIndex(toNewMusicInfo(raw) as LX.Music.MusicInfoOnline))
      .find((candidate: LX.Music.MusicInfoOnline) =>
        normalizeBaseTitle(candidate.name) === normalizeBaseTitle(item.name) &&
        (!candidate.interval || !item.interval || Math.abs(intervalToSeconds(candidate.interval) - intervalToSeconds(item.interval)) < 12),
      )
    if (match) mergeMusicInfo(item, match)
    return item
  }))
}

const mergeSimilarLists = (lists: LX.Music.MusicInfoOnline[][], limit: number) => {
  const merged = new Map<string, LX.Music.MusicInfoOnline>()
  const maxLength = Math.max(0, ...lists.map(list => list.length))
  for (let index = 0; index < maxLength; index++) {
    for (const list of lists) {
      const rawItem = list[index]
      if (!rawItem) continue
      const item = ensureQualityIndex(rawItem)
      const key = `${normalizeBaseTitle(item.name)}|${normalizeSinger(item.singer)}`
      const current = merged.get(key)
      if (!current) {
        ;(item.meta as any).platformSources = [item.source]
        merged.set(key, item)
        continue
      }
      const currentMeta: any = current.meta
      for (const quality of item.meta.qualitys ?? []) {
        if (!currentMeta._qualitys[quality.type]) currentMeta.qualitys.push(quality)
        currentMeta._qualitys[quality.type] ||= { size: quality.size }
      }
      const sources = currentMeta.platformSources as LX.OnlineSource[]
      if (!sources.includes(item.source)) {
        const previous = currentMeta.toggleMusicInfo
        currentMeta.toggleMusicInfo = item
        item.meta.toggleMusicInfo = previous
        sources.push(item.source)
      }
    }
  }
  return [...merged.values()].slice(0, limit)
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
  const list = filterSimilarList(result.list.map(ensureQualityIndex), seed, limit)
  return { ...result, list: await hydrateSimilarList(list, source), seedSource: seed.source }
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const loadSimilarSongs = async(
  seed: SimilarSongSeed,
  limit = 50,
): Promise<LX.Music.SimilarSongsResult> => {
  const partialErrors: LX.Music.SimilarSongsPartialError[] = []
  const seeds = new Map<LX.OnlineSource, SimilarSongSeed>()
  if (seed.meta.songId && similarSources.includes(seed.source as LX.OnlineSource)) {
    if (seed.source === 'tx' && seed.meta.platformId) seed.meta.songId = seed.meta.platformId
    seeds.set(seed.source as LX.OnlineSource, seed)
  }
  await Promise.all(similarSources.map(async source => {
    if (seeds.has(source)) return
    try {
      const search = await musicSdk[source]?.musicSearch?.search(`${seed.name} ${seed.singer}`.trim(), 1, 30)
      const candidates = (search?.list ?? [])
        .map((item: any) => toNewMusicInfo(item) as LX.Music.MusicInfoOnline)
        .filter((item: LX.Music.MusicInfoOnline) => normalizeBaseTitle(item.name) === normalizeBaseTitle(seed.name))
        .sort((a: LX.Music.MusicInfoOnline, b: LX.Music.MusicInfoOnline) => {
          const seedSingers = singerNames(seed.singer)
          const singerScore = (item: LX.Music.MusicInfoOnline) => singerNames(item.singer).some(name => seedSingers.includes(name)) ? 10 : 0
          const durationScore = (item: LX.Music.MusicInfoOnline) => item.interval && seed.interval
            ? Math.max(0, 5 - Math.abs(intervalToSeconds(item.interval) - intervalToSeconds(seed.interval)))
            : 0
          return singerScore(b) + durationScore(b) - singerScore(a) - durationScore(a)
        })
      const info = candidates[0]
      if (info) {
        const seedMeta: SimilarSongSeed['meta'] = {
          ...info.meta,
          songId: info.source === 'tx' ? (info.meta.id ?? info.meta.songId) : info.meta.songId,
        }
        seeds.set(source, {
          id: info.id,
          name: info.name,
          singer: info.singer,
          source,
          interval: info.interval,
          meta: seedMeta,
        })
      }
    } catch (error) {
      console.warn(`[similar songs] ${source} seed search failed:`, error)
    }
  }))

  console.info('[similar songs] platforms:', [...seeds.keys()])
  const results = await Promise.all([...seeds.values()].map(async platformSeed => {
    try {
      const result = await loadPlatformSimilar(platformSeed, platformSeed.source as LX.OnlineSource, platformSeed.meta.songId, limit, platformSeed.meta.platformId, platformSeed.meta.hash)
      const list = result?.list ?? []
      console.info(`[similar songs] ${platformSeed.source} returned ${list.length} songs`)
      return list
    } catch (error) {
      partialErrors.push({ source: platformSeed.source as LX.OnlineSource, message: getErrorMessage(error) })
      console.warn(`[similar songs] ${platformSeed.source} recommendation unavailable:`, error)
      return []
    }
  }))
  const list = mergeSimilarLists(results, limit)
  for (const item of list) {
    const qualitys = item.meta.qualitys ?? []
    const qualityOrder: LX.Quality[] = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', 'ape', 'wav', '320k', '192k', '128k']
    const highest = qualityOrder.find(type => qualitys.some(quality => quality.type === type))
    if (highest) {
      item.meta._qualitys[highest] ||= { size: null }
    }
  }
  const platforms = [...new Set([...seeds.keys()])]
  return {
    list,
    mode: list.length ? 'platform' : 'unavailable',
    seedSource: seed.source,
    platform: platforms[0],
    platforms,
    ...(partialErrors.length ? { partialErrors } : {}),
  }
}
