import { randomUUID } from 'node:crypto'
import { fetch } from 'undici'
import { SignatureGenerator } from 'st-shazam/src/algorithm'
import { createRequestSignal } from './abort'

const REQUEST_TIMEOUT_MS = 10000
const VERIFICATION_MIN_SECONDS = 10
const VERIFICATION_SEGMENT_SECONDS = 6

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
  const url = new URL(`https://amp.shazam.com/discovery/v5/zh/CN/android/-/tag/${randomUUID().toUpperCase()}/${randomUUID()}`)
  url.search = new URLSearchParams({
    sync: 'true',
    webv3: 'true',
    sampling: 'true',
    connected: '',
    shazamapiversion: 'v3',
    sharehub: 'true',
    video: 'v3',
  }).toString()

  const request = createRequestSignal(signal, REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: request.signal,
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
  } finally {
    request.cleanup()
  }

  if (response.status === 429) throw new RecognitionNetworkError('听歌识曲请求过于频繁，请稍后重试')
  if (!response.ok) throw new RecognitionNetworkError(`听歌识曲服务请求失败（${response.status}）`)

  const body: any = await response.json()
  if (!Array.isArray(body.matches) || body.matches.length === 0 || !body.track) return null
  return body
}

const verifyTrack = async(pcm: Buffer, expectedTrackKey: string, signal?: AbortSignal): Promise<boolean> => {
  const totalSamples = Math.floor(pcm.length / 2)
  if (totalSamples < VERIFICATION_MIN_SECONDS * 16000) return false

  const segmentSamples = VERIFICATION_SEGMENT_SECONDS * 16000
  const segments = [
    new Int16Array(pcm.buffer, pcm.byteOffset + (totalSamples - segmentSamples) * 2, segmentSamples),
    new Int16Array(pcm.buffer, pcm.byteOffset, segmentSamples),
  ]

  for (const samples of segments) {
    const body = await tagSamples(samples, signal)
    if (!body?.track) continue
    return String(body.track.key) === expectedTrackKey
  }
  return false
}

export const recognizePcm = async(pcm: Buffer, signal?: AbortSignal): Promise<RecognitionOutput> => {
  const sampleCount = Math.floor(pcm.length / 2)
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, sampleCount)
  const body = await tagSamples(samples, signal)
  if (!body?.track) return { match: null, alternatives: [] }

  const trackKey = String(body.track.key)
  if (!await verifyTrack(pcm, trackKey, signal)) {
    console.warn(`[music recognition] rejected unverified Shazam match: ${trackKey}`)
    return { match: null, alternatives: [] }
  }

  const match = mapTrack(body.track, Date.now())
  return { match, alternatives: [] }
}
