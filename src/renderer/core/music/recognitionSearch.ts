import { toNewMusicInfo } from '@renderer/utils'
import musicSdk from '@renderer/utils/musicSdk'

const SOURCES = ['wy', 'tx', 'kg'] as const
const MIN_CANDIDATE_SCORE = 5
const ARTIST_SPLIT_RXP = /\s+(?:feat(?:uring)?|ft)\.?\s*|、|&|;|；|\/|,|，|\|/i
const TRAILING_PAREN_RXP = /\s*[（(]([^（）()]*)[）)]\s*$/
const VERSION_MARKER_RXP = /\blive\b|现场|\bremix\b|混音|\bacoustic\b|不插电|\binstrumental\b|伴奏|\bpart\s*(\d+)\b|第\s*(.+?)\s*部/gi

const normalizeText = (text: string) => text
  .toLowerCase()
  .replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！|_/g, '')

const titleParts = (title: string) => {
  const suffixes: string[] = []
  let baseTitle = title
  let match: RegExpExecArray | null
  while ((match = TRAILING_PAREN_RXP.exec(baseTitle))) {
    suffixes.unshift(match[1])
    baseTitle = baseTitle.slice(0, match.index)
  }

  const versions = new Set<string>()
  for (const suffix of suffixes) {
    VERSION_MARKER_RXP.lastIndex = 0
    let versionMatch: RegExpExecArray | null
    while ((versionMatch = VERSION_MARKER_RXP.exec(suffix))) {
      const marker = versionMatch[0].toLowerCase()
      if (marker === 'live' || marker === '现场') versions.add('live')
      else if (marker === 'remix' || marker === '混音') versions.add('remix')
      else if (marker === 'acoustic' || marker === '不插电') versions.add('acoustic')
      else if (marker === 'instrumental' || marker === '伴奏') versions.add('instrumental')
      else if (versionMatch[1]) versions.add(`part:${versionMatch[1]}`)
      else if (versionMatch[2]) versions.add(`part:${normalizeText(versionMatch[2])}`)
    }
  }
  return {
    baseTitle: normalizeText(baseTitle),
    versions: [...versions].sort((a, b) => a.localeCompare(b)),
  }
}

const artistNames = (artist: string) => [...new Set(artist
  .split(ARTIST_SPLIT_RXP)
  .map(normalizeText)
  .filter(Boolean))]
  .sort((a, b) => a.localeCompare(b))

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index])
const intersects = (a: string[], b: string[]) => a.some(value => b.includes(value))

const scoreCandidate = (
  seed: LX.MusicRecognition.Result,
  candidate: LX.Music.MusicInfoOnline,
): number | null => {
  const seedArtists = artistNames(seed.artist)
  const candidateArtists = artistNames(candidate.singer)
  if (!seedArtists.length || !candidateArtists.length || !intersects(seedArtists, candidateArtists)) return null

  const seedTitle = titleParts(seed.title)
  const candidateTitle = titleParts(candidate.name)
  if (seedTitle.baseTitle !== candidateTitle.baseTitle) return null

  let score = 1
  if (normalizeText(seed.title) === normalizeText(candidate.name)) score += 2
  if (sameList(seedArtists, candidateArtists)) score += 2
  if (sameList(seedTitle.versions, candidateTitle.versions)) score += 1
  if (seed.album && candidate.meta.albumName && normalizeText(seed.album) === normalizeText(candidate.meta.albumName)) score += 1
  return score >= MIN_CANDIDATE_SCORE ? score : null
}

const isValidSongId = (songId: unknown): songId is string | number => {
  if (typeof songId === 'number') return Number.isFinite(songId)
  return typeof songId === 'string' && songId.trim() !== ''
}

const isValidMusicInfo = (info: unknown): info is LX.Music.MusicInfoOnline => {
  if (!info || typeof info !== 'object') return false
  const candidate = info as Partial<LX.Music.MusicInfoOnline>
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return false
  if (typeof candidate.singer !== 'string' || !candidate.singer.trim()) return false
  if (!candidate.meta || typeof candidate.meta !== 'object') return false
  return isValidSongId(candidate.meta.songId)
}

const findBestMatch = (
  source: typeof SOURCES[number],
  seed: LX.MusicRecognition.Result,
  list: any[],
): LX.Music.MusicInfoOnline | null => {
  let bestMatch: { score: number, info: LX.Music.MusicInfoOnline } | null = null
  for (const item of list) {
    try {
      const info = toNewMusicInfo(item)
      if (!isValidMusicInfo(info)) {
        console.warn(`[music recognition] ${source} ignored invalid search item`)
        continue
      }
      const score = scoreCandidate(seed, info)
      if (score == null) continue
      if (!bestMatch || score > bestMatch.score) bestMatch = { score, info }
    } catch (error) {
      console.warn(`[music recognition] ${source} ignored invalid search item:`, error)
    }
  }
  return bestMatch?.info ?? null
}

const searchSource = async(
  source: typeof SOURCES[number],
  seed: LX.MusicRecognition.Result,
): Promise<LX.MusicRecognition.Result | null> => {
  try {
    const query = `${seed.title} ${seed.artist}`.trim()
    const result = await musicSdk[source].musicSearch.search(query, 1, 30)
    const info = findBestMatch(source, seed, result.list ?? [])
    if (!info) return null

    const providerTrackId = `${source}:${String(info.meta.songId)}`
    return {
      id: `${providerTrackId}:${seed.recognizedAt}`,
      title: info.name,
      artist: info.singer,
      album: info.meta.albumName || undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      coverUrl: info.meta.picUrl || undefined,
      provider: source,
      providerTrackId,
      recognizedAt: seed.recognizedAt,
    }
  } catch (error) {
    console.warn(`[music recognition] ${source} text search unavailable:`, error)
    return null
  }
}

export const searchRecognitionPlatformMatches = async(
  seed: LX.MusicRecognition.Result,
): Promise<LX.MusicRecognition.Result[]> => {
  if (!artistNames(seed.artist).length) return []
  const matches = await Promise.all(SOURCES.map(async source => searchSource(source, seed)))
  return matches.filter((match): match is LX.MusicRecognition.Result => match != null)
}
