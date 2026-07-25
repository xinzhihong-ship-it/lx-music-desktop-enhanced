import { fetch } from 'undici'
import { RecognitionNetworkError } from './recognizer'
import { createRequestSignal, throwIfAborted } from './abort'

const REQUEST_TIMEOUT_MS = 10000
const MAX_FP_SECONDS = 15
const RMS_THRESHOLD = 32 / 32768
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenerateFP } = require('./afp/afp.js') as { GenerateFP: (samples: Float32Array) => Promise<string> }
let fingerprintQueue: Promise<void> = Promise.resolve()

// AFP WASM 运行时不可重入，并发调用会耗尽其固定内存；只串行化本地指纹计算。
const generateFingerprint = async(samples: Float32Array): Promise<string> => {
  const task = fingerprintQueue.then(async() => await GenerateFP(samples))
  fingerprintQueue = task.then(() => {}, () => {})
  return await task
}

// 采集 PCM 为 s16le mono 16000Hz，网易 AFP 指纹要求 8000Hz mono Float32
const resampleToFloat32 = (pcm: Buffer): Float32Array => {
  const outSamples = Math.floor(pcm.length / 4)
  const out = new Float32Array(outSamples)
  for (let i = 0; i < outSamples; i++) {
    const a = pcm.readInt16LE(i * 4)
    const b = i * 4 + 2 < pcm.length ? pcm.readInt16LE(i * 4 + 2) : a
    out[i] = (a + b) / 2 / 32768
  }
  return out
}

const hasAudibleSignal = (samples: Float32Array): boolean => {
  let energy = 0
  for (const sample of samples) energy += sample * sample
  return Math.sqrt(energy / Math.max(samples.length, 1)) >= RMS_THRESHOLD
}

interface NeteaseMatchItem {
  startTime?: number
  song?: {
    id?: number | string
    name?: string
    artists?: Array<{ name?: string }>
    ar?: Array<{ name?: string }>
    album?: { id?: number | string, name?: string, picUrl?: string }
    al?: { id?: number | string, name?: string, picUrl?: string }
  }
}

const mapItem = (item: NeteaseMatchItem): LX.MusicRecognition.Result | null => {
  const song = item.song
  if (!song?.id || !song.name) return null
  const artists = song.artists ?? song.ar ?? []
  const album = song.album ?? song.al
  return {
    id: `wy_${song.id}:${Date.now()}`,
    title: song.name,
    artist: artists.map(artist => artist.name).filter(Boolean).join('、'),
    album: album?.name ? album.name : undefined,
    coverUrl: album?.picUrl ?? undefined,
    provider: 'wy',
    providerTrackId: `wy:${String(song.id)}`,
    recognizedAt: Date.now(),
  }
}

export const recognizeNetease = async(pcm: Buffer, signal?: AbortSignal): Promise<LX.MusicRecognition.Result[]> => {
  const samples = resampleToFloat32(pcm).slice(0, MAX_FP_SECONDS * 8000)
  if (!samples.length || !hasAudibleSignal(samples)) return []
  throwIfAborted(signal)
  const audioFP = await generateFingerprint(samples)
  throwIfAborted(signal)
  const duration = (samples.length / 8000).toFixed(3)

  const request = createRequestSignal(signal, REQUEST_TIMEOUT_MS)
  const url = `https://interface.music.163.com/api/music/audio/match?sessionId=0123456789abcdef&algorithmCode=shazam_v2&duration=${duration}&rawdata=${encodeURIComponent(audioFP)}&times=1&decrypt=1`
  let response
  try {
    response = await fetch(url, {
      signal: request.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://music.163.com/',
      },
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new RecognitionNetworkError('网易云听歌识曲网络请求失败')
  } finally {
    request.cleanup()
  }
  if (!response.ok) throw new RecognitionNetworkError(`网易云听歌识曲服务请求失败（${response.status}）`)

  const body: any = await response.json()
  if (body?.code !== 200) {
    console.warn('[music recognition wy] unexpected code:', body?.code, body?.message)
    return []
  }
  const items: NeteaseMatchItem[] = body.data?.result ?? body.data?.data?.result ?? []
  return items.map(mapItem).filter((item): item is LX.MusicRecognition.Result => item != null).slice(0, 5)
}
