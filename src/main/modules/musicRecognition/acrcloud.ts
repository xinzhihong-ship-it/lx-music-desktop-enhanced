import { createHmac } from 'node:crypto'
import { fetch } from 'undici'

const REQUEST_TIMEOUT_MS = 10000
const MAX_RESULTS = 5

// 把 16kHz 单声道 s16le PCM 包上 WAV 头（ACRCloud 要求上传音频文件，< 1MB）
const wrapWav = (pcm: Buffer): Buffer => {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// https://docs.acrcloud.cn/api/identification-api.html
const buildSignature = (accessKey: string, timestamp: string, accessSecret: string): string => {
  const stringToSign = ['POST', '/v1/identify', accessKey, 'audio', '1', timestamp].join('\n')
  return createHmac('sha1', accessSecret).update(stringToSign, 'utf8').digest('base64')
}

// ACRCloud 识别失败（网络/配额/密钥错误）不应影响 Shazam 主流程，出错一律返回空列表
export const recognizeAcrcloud = async(
  pcm: Buffer,
  config: LX.MusicRecognition.AcrcloudConfig,
  signal?: AbortSignal,
): Promise<LX.MusicRecognition.Result[]> => {
  if (!config.enabled || !config.host || !config.accessKey || !config.accessSecret) return []
  const wav = wrapWav(pcm)
  const timestamp = String(Math.floor(Date.now() / 1000))

  // 手工拼 multipart body，避免 FormData/Blob 在不同运行时的兼容问题
  const boundary = `----acrcloud-${Date.now()}`
  const parts: Buffer[] = []
  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'))
  }
  addField('access_key', config.accessKey)
  addField('data_type', 'audio')
  addField('signature_version', '1')
  addField('signature', buildSignature(config.accessKey, timestamp, config.accessSecret))
  addField('timestamp', timestamp)
  addField('sample_bytes', String(wav.length))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sample"; filename="sample.wav"\r\nContent-Type: audio/wav\r\n\r\n`, 'utf8'))
  parts.push(wav)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))

  let body: any
  try {
    const response = await fetch(`https://${config.host}/v1/identify`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(Buffer.concat(parts)),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    body = await response.json()
  } catch (err) {
    console.warn('[musicRecognition] acrcloud request failed:', err)
    return []
  }

  if (body?.status?.code !== 0) {
    console.warn(`[musicRecognition] acrcloud returned code ${body?.status?.code}: ${body?.status?.msg}`)
    return []
  }
  // music 是精确录音匹配，humming 是 Cover Song（翻唱/现场版）匹配，两者都解析
  const sources: Array<{ items: any, prefix: string }> = [
    { items: body?.metadata?.music, prefix: 'acrcloud' },
    { items: body?.metadata?.humming, prefix: 'acrcloud-h' },
  ]

  const recognizedAt = Date.now()
  const results: LX.MusicRecognition.Result[] = []
  for (const { items, prefix } of sources) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (results.length >= MAX_RESULTS) break
      const artist = (Array.isArray(item.artists) ? item.artists : [])
        .map((a: any) => a?.name)
        .filter(Boolean)
        .join('、')
      const providerTrackId = `${prefix}:${item.acrid ?? `${item.title}:${artist}`}`
      results.push({
        id: `${providerTrackId}:${recognizedAt}`,
        title: String(item.title ?? ''),
        artist,
        album: item.album?.name,
        provider: 'acrcloud',
        providerTrackId,
        recognizedAt,
      })
    }
  }
  return results.filter(item => item.title)
}
