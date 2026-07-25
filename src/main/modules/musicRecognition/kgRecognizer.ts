import { createHash } from 'node:crypto'
import { fetch } from 'undici'
import { RecognitionNetworkError } from './recognizer'
import { createRequestSignal } from './abort'

const REQUEST_TIMEOUT_MS = 10000
const ANDROID_KEY = 'OIlwieks28dk2k092lksi2UIkp'
const APP_ID = 1005
const CLIENT_VERSION = 20489

const md5 = (value: string): string => createHash('md5').update(value).digest('hex')

// 酷狗正式版 Android 客户端将 MD5 设备标识解释为无符号大整数，不能使用随机 hex MID。
const getDeviceIdentity = () => {
  const dfid = '-'
  const mid = BigInt(`0x${md5(dfid)}`).toString()
  return { dfid, mid, uuid: md5(`${dfid}${mid}`) }
}

// 采集 PCM 为 s16le mono 16000Hz，酷狗识曲要求 s16le mono 8000Hz，按点对平均降采样
const resampleTo8k = (pcm: Buffer): Buffer => {
  const outSamples = Math.floor(pcm.length / 4)
  const out = Buffer.alloc(outSamples * 2)
  for (let i = 0; i < outSamples; i++) {
    const a = pcm.readInt16LE(i * 4)
    const b = i * 4 + 2 < pcm.length ? pcm.readInt16LE(i * 4 + 2) : a
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((a + b) / 2))), i * 2)
  }
  return out
}

// 与 KuGou.Net / KuGouMusicApi 一致的 Android 签名：MD5(key + 排序后的 name=value + 原始二进制 body + key)
const signRequest = (params: Record<string, string | number>, body: Buffer): string => {
  const paramsString = Object.keys(params).sort().map(name => `${name}=${String(params[name])}`).join('')
  const hash = createHash('md5')
  hash.update(ANDROID_KEY)
  hash.update(paramsString)
  hash.update(body)
  hash.update(ANDROID_KEY)
  return hash.digest('hex')
}

interface KugouMatchItem {
  songid?: number | string
  song_id?: number | string
  mixsongid?: number | string
  songname?: string
  song_name?: string
  songNameSuffix?: string
  song_name_suffix?: string
  singername?: string
  singer_name?: string
  authors?: Array<{ name?: string, author_name?: string }>
  union_cover?: string
  hash_128?: string
  hash128?: string
  album_name?: string
  album?: Array<{ albumname?: string, album_name?: string, name?: string }> | { albumname?: string, album_name?: string, name?: string } | string
}

const mapItem = (item: KugouMatchItem): LX.MusicRecognition.Result | null => {
  const baseName = item.songname ?? item.song_name ?? ''
  if (!baseName) return null
  const nameSuffix = item.songNameSuffix ?? item.song_name_suffix
  const suffix = nameSuffix ? ` (${nameSuffix})` : ''
  const authors = Array.isArray(item.authors) ? item.authors : []
  const album = Array.isArray(item.album) ? item.album[0] : item.album
  const albumName = typeof album === 'string'
    ? album
    : (album?.albumname ?? album?.album_name ?? album?.name ?? item.album_name ?? '')
  const trackId = item.mixsongid ?? item.songid ?? item.song_id ?? item.hash_128 ?? item.hash128 ?? baseName
  return {
    id: `kg_${trackId}:${Date.now()}`,
    title: `${baseName}${suffix}`,
    artist: item.singername ?? item.singer_name ?? authors.map(author => author.name ?? author.author_name).filter(Boolean).join('、'),
    album: albumName || undefined,
    coverUrl: item.union_cover ? item.union_cover.replace('{size}', '400') : undefined,
    provider: 'kg',
    providerTrackId: `kg:${String(trackId)}`,
    recognizedAt: Date.now(),
  }
}

export const recognizeKugou = async(pcm: Buffer, signal?: AbortSignal): Promise<LX.MusicRecognition.Result[]> => {
  const body = resampleTo8k(pcm)
  if (!body.length) return []
  const clienttime = Math.floor(Date.now() / 1000)
  const device = getDeviceIdentity()
  const params: Record<string, string | number> = {
    ...device,
    appid: APP_ID,
    clientver: CLIENT_VERSION,
    clienttime,
    fpid: Date.now(),
    area_code: 1,
    include_unpublish: 1,
    useid: 0,
    multi_result: 1,
  }
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([name, value]) => [name, String(value)])),
    signature: signRequest(params, body),
  })

  const request = createRequestSignal(signal, REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`https://gateway.kugou.com/fingerprint.service/v1/music_trackid_mulit?${query.toString()}`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        'content-type': 'application/octet-stream',
        'user-agent': 'KuGou/11490 (Android)',
        dfid: '-',
        mid: device.mid,
        clienttime: String(clienttime),
        'kg-rc': '1',
        'kg-thash': '5d816a0',
        'kg-rec': '1',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
      },
      body,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new RecognitionNetworkError('酷狗听歌识曲网络请求失败')
  } finally {
    request.cleanup()
  }
  if (!response.ok) throw new RecognitionNetworkError(`酷狗听歌识曲服务请求失败（${response.status}）`)

  const data: any = await response.json()
  if (data?.status !== 1) {
    console.warn('[music recognition kg] unexpected status:', data?.status, data?.error_msg ?? data?.msg)
    return []
  }
  const items: KugouMatchItem[] = Array.isArray(data.data) ? data.data : (data.data?.list ?? data.data?.songs ?? [])
  if (!items.length) {
    console.info('[music recognition kg] no match:', {
      errorCode: data.error_code,
      errorMsg: data.error_msg ?? data.msg,
      pcmSecond: data.pcm_second,
      process: data.process,
      dataType: Array.isArray(data.data) ? 'array' : typeof data.data,
    })
  }
  return items.map(mapItem).filter((item): item is LX.MusicRecognition.Result => item != null).slice(0, 5)
}
