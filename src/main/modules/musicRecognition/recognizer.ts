import { randomUUID } from 'node:crypto'
import { fetch } from 'undici'
import { SignatureGenerator } from 'st-shazam/src/algorithm'

const REQUEST_TIMEOUT_MS = 10000
const SECOND_SEGMENT_MIN_SECONDS = 10
const SECOND_SEGMENT_SECONDS = 6
const MAX_ALTERNATIVES = 5

export class RecognitionNetworkError extends Error {}

export interface RecognitionOutput {
  match: LX.MusicRecognition.Result | null
  alternatives: LX.MusicRecognition.Result[]
}

const getAlbum = (track: any): string | undefined => {
  const sections = Array.isArray(track?.sections) ? track.sections : []
  for (const section of sections) {
    if (section?.type !== 'SONG' || !Array.isArray(section.metadata)) continue
    const album = section.metadata.find((item: any) => item?.title === 'Album')
    if (typeof album?.text === 'string') return album.text
  }
  return undefined
}

const mapTrack = (track: any, timestamp: number): LX.MusicRecognition.Result => {
  return {
    id: `${track.key}:${timestamp}`,
    title: track.title,
    artist: track.subtitle,
    album: getAlbum(track),
    coverUrl: track.images?.coverarthq ?? track.images?.coverart,
    shazamUrl: track.url,
    provider: 'shazam',
    providerTrackId: String(track.key),
    recognizedAt: timestamp,
  }
}

const tagSamples = async(samples: Int16Array, signal?: AbortSignal): Promise<any | null> => {
  const signature = new SignatureGenerator().getSignature(samples)
  const timestamp = Date.now()
  const url = new URL(`https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${randomUUID().toUpperCase()}/${randomUUID()}`)
  url.search = new URLSearchParams({
    sync: 'true',
    webv3: 'true',
    sampling: 'true',
    connected: '',
    shazamapiversion: 'v3',
    sharehub: 'true',
    video: 'v3',
  }).toString()

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'Content-Type': 'application/json',
        'Content-Language': 'zh_CN',
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 10; K)',
      },
      body: JSON.stringify({
        geolocation: { altitude: 300, latitude: 31.2, longitude: 121.5 },
        signature: {
          samplems: Math.round(signature.numberSamples / signature.sampleRateHz * 1000),
          timestamp: timestamp >>> 0,
          uri: signature.encodeToUri(),
        },
        timestamp: timestamp >>> 0,
        timezone: 'Asia/Shanghai',
      }),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new RecognitionNetworkError('听歌识曲网络请求失败，请检查网络后重试')
  }

  if (response.status === 429) throw new RecognitionNetworkError('听歌识曲请求过于频繁，请稍后重试')
  if (!response.ok) throw new RecognitionNetworkError(`听歌识曲服务请求失败（${response.status}）`)

  const body: any = await response.json()
  if (!Array.isArray(body.matches) || body.matches.length === 0 || !body.track) return null
  return body
}

const fetchSimilarTracks = async(track: any, signal?: AbortSignal): Promise<LX.MusicRecognition.Result[]> => {
  if (typeof track?.relatedtracksurl !== 'string') return []
  try {
    const response = await fetch(track.relatedtracksurl, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 10; K)' },
    })
    if (!response.ok) return []
    const body: any = await response.json()
    if (!Array.isArray(body.tracks)) return []
    const timestamp = Date.now()
    return body.tracks
      .filter((item: any) => item?.key && item.key !== track.key && item.title)
      .slice(0, MAX_ALTERNATIVES)
      .map((item: any) => mapTrack(item, timestamp))
  } catch {
    return []
  }
}

// 对采集音频的后段再做一次识别：前奏/混音场景下不同片段可能匹配到不同歌曲
const tagSecondSegment = async(pcm: Buffer, signal?: AbortSignal): Promise<LX.MusicRecognition.Result | null> => {
  const totalSamples = Math.floor(pcm.length / 2)
  if (totalSamples < SECOND_SEGMENT_MIN_SECONDS * 16000) return null
  const offset = Math.max(totalSamples - SECOND_SEGMENT_SECONDS * 16000, 0)
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset + offset * 2, totalSamples - offset)
  try {
    const body = await tagSamples(samples, signal)
    if (!body?.track) return null
    return mapTrack(body.track, Date.now())
  } catch {
    return null
  }
}

export const recognizePcm = async(pcm: Buffer, signal?: AbortSignal): Promise<RecognitionOutput> => {
  const sampleCount = Math.floor(pcm.length / 2)
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, sampleCount)
  const body = await tagSamples(samples, signal)
  if (!body?.track) return { match: null, alternatives: [] }

  const match = mapTrack(body.track, Date.now())
  const [segmentMatch, similarTracks] = await Promise.all([
    tagSecondSegment(pcm, signal),
    fetchSimilarTracks(body.track, signal),
  ])

  const seen = new Set([match.providerTrackId])
  const alternatives: LX.MusicRecognition.Result[] = []
  if (segmentMatch && !seen.has(segmentMatch.providerTrackId)) {
    seen.add(segmentMatch.providerTrackId)
    alternatives.push(segmentMatch)
  }
  for (const track of similarTracks) {
    if (seen.has(track.providerTrackId)) continue
    seen.add(track.providerTrackId)
    alternatives.push(track)
  }
  return { match, alternatives }
}
