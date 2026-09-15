import fs from 'node:fs/promises'

const PROBE_CHUNK_BYTES = 256 * 1024
const DEFAULT_TIMEOUT_MS = 8000
const MIN_SAMPLE_RATE = 8000
const MAX_SAMPLE_RATE = 384000
const STANDARD_SAMPLE_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000, 176400, 192000, 352800, 384000])

interface ProbeChunk {
  bytes: Uint8Array
  start: number
  end: number
  total: number | null
}

const validRate = (value: number) => Number.isInteger(value) && value >= MIN_SAMPLE_RATE && value <= MAX_SAMPLE_RATE && STANDARD_SAMPLE_RATES.has(value) ? value : null
const readU16BE = (bytes: Uint8Array, offset: number) => bytes[offset] << 8 | bytes[offset + 1]
const readU16LE = (bytes: Uint8Array, offset: number) => bytes[offset] | bytes[offset + 1] << 8
const readU32LE = (bytes: Uint8Array, offset: number) => (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] * 0x1000000) >>> 0
const readU32BE = (bytes: Uint8Array, offset: number) => (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
const readU64BE = (bytes: Uint8Array, offset: number) => {
  let value = 0n
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(bytes[offset + i])
  return value
}
const has = (bytes: Uint8Array, offset: number, text: string) => {
  if (offset < 0 || offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false
  return true
}
const find = (bytes: Uint8Array, text: string, from = 0) => {
  for (let offset = from; offset + text.length <= bytes.length; offset++) if (has(bytes, offset, text)) return offset
  return -1
}

interface ParsedAudioInfo {
  format: string
  sampleRate: number | null
  bitrate: number | null
  bitsPerSample: number | null
}

const parsedInfo = (format: string, sampleRate: number | null, extra: Partial<ParsedAudioInfo> = {}): ParsedAudioInfo => ({
  format,
  sampleRate,
  bitrate: extra.bitrate ?? null,
  bitsPerSample: extra.bitsPerSample ?? null,
})

const parseFlac = (bytes: Uint8Array) => {
  if (!has(bytes, 0, 'fLaC')) return null
  let offset = 4
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset]
    const length = readU24BE(bytes, offset + 1)
    const body = offset + 4
    if (body + length > bytes.length) return null
    if ((header & 0x7f) === 0 && length >= 18) return validRate(Number((readU64BE(bytes, body + 10) >> 44n) & 0xfffffn))
    offset = body + length
    if (header & 0x80) break
  }
  return null
}

const parseFlacInfo = (bytes: Uint8Array): ParsedAudioInfo | null => {
  if (!has(bytes, 0, 'fLaC')) return null
  let offset = 4
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset]
    const length = readU24BE(bytes, offset + 1)
    const body = offset + 4
    if (body + length > bytes.length) return null
    if ((header & 0x7f) === 0 && length >= 18) {
      const value = readU64BE(bytes, body + 10)
      const sampleRate = validRate(Number((value >> 44n) & 0xfffffn))
      const bitsPerSample = Number((value >> 36n) & 0x1fn) + 1
      return parsedInfo('flac', sampleRate, { bitsPerSample })
    }
    offset = body + length
    if (header & 0x80) break
  }
  return parsedInfo('flac', null)
}

const readU24BE = (bytes: Uint8Array, offset: number) => bytes[offset] * 0x10000 + bytes[offset + 1] * 0x100 + bytes[offset + 2]

const parseWave = (bytes: Uint8Array) => {
  if ((!has(bytes, 0, 'RIFF') && !has(bytes, 0, 'RF64') && !has(bytes, 0, 'BW64')) || !has(bytes, 8, 'WAVE')) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = readU32LE(bytes, offset + 4)
    const body = offset + 8
    if (body + length > bytes.length) return null
    if (has(bytes, offset, 'fmt ') && length >= 8) return validRate(readU32LE(bytes, body + 4))
    offset = body + length + (length & 1)
  }
  return null
}

const parseWaveInfo = (bytes: Uint8Array): ParsedAudioInfo | null => {
  if ((!has(bytes, 0, 'RIFF') && !has(bytes, 0, 'RF64') && !has(bytes, 0, 'BW64')) || !has(bytes, 8, 'WAVE')) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = readU32LE(bytes, offset + 4)
    const body = offset + 8
    if (body + length > bytes.length) return null
    if (has(bytes, offset, 'fmt ') && length >= 16) {
      return parsedInfo('wav', validRate(readU32LE(bytes, body + 4)), { bitsPerSample: readU16LE(bytes, body + 14) })
    }
    offset = body + length + (length & 1)
  }
  return parsedInfo('wav', null)
}

const parseAiff = (bytes: Uint8Array) => {
  if (!has(bytes, 0, 'FORM') || (!has(bytes, 8, 'AIFF') && !has(bytes, 8, 'AIFC'))) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset + 4)
    const body = offset + 8
    if (body + length > bytes.length) return null
    if (has(bytes, offset, 'COMM') && length >= 18) {
      const exponent = readU16BE(bytes, body + 8)
      const significand = Number(readU64BE(bytes, body + 10))
      const rate = significand * 2 ** (exponent - 16383 - 63)
      return validRate(Math.round(rate))
    }
    offset = body + length + (length & 1)
  }
  return null
}

const parseAiffInfo = (bytes: Uint8Array): ParsedAudioInfo | null => {
  if (!has(bytes, 0, 'FORM') || (!has(bytes, 8, 'AIFF') && !has(bytes, 8, 'AIFC'))) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset + 4)
    const body = offset + 8
    if (body + length > bytes.length) return null
    if (has(bytes, offset, 'COMM') && length >= 18) {
      const exponent = readU16BE(bytes, body + 8)
      const significand = Number(readU64BE(bytes, body + 10))
      const rate = validRate(Math.round(significand * 2 ** (exponent - 16383 - 63)))
      return parsedInfo('aiff', rate, { bitsPerSample: readU16BE(bytes, body + 6) })
    }
    offset = body + length + (length & 1)
  }
  return parsedInfo('aiff', null)
}

const parseOgg = (bytes: Uint8Array) => {
  // An Ogg identification header is only meaningful inside an Ogg page.  Do
  // not accept the marker when it merely appears in an HTML error body or a
  // signed URL response.
  if (!has(bytes, 0, 'OggS')) return null
  if (find(bytes, 'OpusHead') >= 0) return 48000
  const vorbis = find(bytes, '\x01vorbis')
  if (vorbis >= 0 && vorbis + 16 <= bytes.length) return validRate(readU32LE(bytes, vorbis + 12))
  const speex = find(bytes, 'Speex   ')
  if (speex >= 0 && speex + 40 <= bytes.length) return validRate(readU32LE(bytes, speex + 36))
  return null
}

const parseAdts = (bytes: Uint8Array) => {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
  for (let offset = 0; offset + 6 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) continue
    const index = (bytes[offset + 2] >> 2) & 0x0f
    if (index >= rates.length) continue
    const frameLength = ((bytes[offset + 3] & 0x03) << 11) | (bytes[offset + 4] << 3) | ((bytes[offset + 5] >> 5) & 0x07)
    const headerLength = (bytes[offset + 1] & 1) ? 7 : 9
    if (frameLength < headerLength || offset + frameLength > bytes.length) continue
    const next = offset + frameLength
    if (next + 1 >= bytes.length || bytes[next] !== 0xff || (bytes[next + 1] & 0xf6) !== 0xf0) continue
    return validRate(rates[index])
  }
  return null
}

const parseAdtsInfo = (bytes: Uint8Array): ParsedAudioInfo | null => {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
  for (let offset = 0; offset + 6 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) continue
    const index = (bytes[offset + 2] >> 2) & 0x0f
    if (index >= rates.length) continue
    const sampleRate = rates[index]
    const frameLength = ((bytes[offset + 3] & 0x03) << 11) | (bytes[offset + 4] << 3) | ((bytes[offset + 5] >> 5) & 0x07)
    const headerLength = (bytes[offset + 1] & 1) ? 7 : 9
    if (frameLength < headerLength || offset + frameLength > bytes.length) continue
    const next = offset + frameLength
    if (next + 1 >= bytes.length || bytes[next] !== 0xff || (bytes[next + 1] & 0xf6) !== 0xf0) continue
    return parsedInfo('aac', validRate(sampleRate), { bitrate: Math.round(frameLength * 8 * sampleRate / 1024) })
  }
  return null
}

const parseMpeg = (bytes: Uint8Array) => {
  const rates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000],
  } as const
  let offset = 0
  if (has(bytes, 0, 'ID3') && bytes.length >= 10) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]
    offset = 10 + size + (bytes[5] & 0x10 ? 10 : 0)
  }
  for (; offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue
    const version = (bytes[offset + 1] >> 3) & 3
    const layer = (bytes[offset + 1] >> 1) & 3
    const index = (bytes[offset + 2] >> 2) & 3
    if (layer === 0 || index === 3 || !rates[version as keyof typeof rates]) continue
    const rate = rates[version as keyof typeof rates][index]
    if (!rate) continue
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f
    if (bitrateIndex === 0 || bitrateIndex === 15) continue
    const bitrates = version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    const bitrate = bitrates[bitrateIndex]
    if (!bitrate) continue
    const padding = (bytes[offset + 2] >> 1) & 1
    const frameLength = version === 3
      ? Math.floor(144 * bitrate * 1000 / rate) + padding
      : Math.floor(72 * bitrate * 1000 / rate) + padding
    if (frameLength < 24 || offset + frameLength > bytes.length) continue
    const next = offset + frameLength
    if (next + 1 >= bytes.length || bytes[next] !== 0xff || (bytes[next + 1] & 0xe0) !== 0xe0) continue
    return validRate(rate)
  }
  return null
}

const parseMpegInfo = (bytes: Uint8Array): ParsedAudioInfo | null => {
  const rates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000],
  } as const
  let offset = 0
  if (has(bytes, 0, 'ID3') && bytes.length >= 10) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]
    offset = 10 + size + (bytes[5] & 0x10 ? 10 : 0)
  }
  for (; offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue
    const version = (bytes[offset + 1] >> 3) & 3
    const layer = (bytes[offset + 1] >> 1) & 3
    const index = (bytes[offset + 2] >> 2) & 3
    if (layer === 0 || index === 3 || !rates[version as keyof typeof rates]) continue
    const sampleRate = rates[version as keyof typeof rates][index]
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f
    if (bitrateIndex === 0 || bitrateIndex === 15) continue
    const bitrates = version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    const bitrate = bitrates[bitrateIndex]
    if (!bitrate) continue
    const padding = (bytes[offset + 2] >> 1) & 1
    const frameLength = version === 3
      ? Math.floor(144 * bitrate * 1000 / sampleRate) + padding
      : Math.floor(72 * bitrate * 1000 / sampleRate) + padding
    if (frameLength < 24 || offset + frameLength > bytes.length) continue
    const next = offset + frameLength
    if (next + 1 >= bytes.length || bytes[next] !== 0xff || (bytes[next + 1] & 0xe0) !== 0xe0) continue
    return parsedInfo('mp3', validRate(sampleRate), { bitrate: bitrate * 1000 })
  }
  return null
}

const aacRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
const readDescriptorLength = (bytes: Uint8Array, offset: number, end: number) => {
  let length = 0
  for (let i = 0; i < 4 && offset + i < end; i++) {
    const value = bytes[offset + i]
    length = length * 128 + (value & 0x7f)
    if (!(value & 0x80)) return { length, next: offset + i + 1 }
  }
  return null
}
const parseAacConfig = (bytes: Uint8Array, offset: number, end: number) => {
  let position = offset * 8
  const readBits = (count: number) => {
    let value = 0
    for (let i = 0; i < count; i++) {
      if (Math.floor(position / 8) >= end) return null
      value = value * 2 + ((bytes[Math.floor(position / 8)] >> (7 - position % 8)) & 1)
      position++
    }
    return value
  }
  let objectType = readBits(5)
  if (objectType === 31) objectType = 32 + (readBits(6) ?? 0)
  const index = readBits(4)
  if (objectType == null || index == null) return null
  const rate = index === 15 ? readBits(24) : aacRates[index]
  if (!rate) return null
  // HE-AAC declares its output rate in the extension frequency field.
  if (objectType === 5 || objectType === 29) {
    const extensionIndex = readBits(4)
    if (extensionIndex == null) return validRate(rate)
    return validRate(extensionIndex === 15 ? (readBits(24) ?? 0) : aacRates[extensionIndex] ?? 0)
  }
  return validRate(rate)
}
const parseMp4 = (bytes: Uint8Array) => {
  // ISO-BMFF files start with an ftyp box.  Requiring it prevents strings such
  // as "mp4a" embedded in an HTML response from being treated as metadata.
  if (bytes.length < 12 || !has(bytes, 4, 'ftyp')) return null
  // The audio sample entry stores a 16.16 fixed-point rate. The nested AAC
  // DecoderSpecificInfo is preferred because it carries rates above 65535 Hz.
  let sampleEntryRate: number | null = null
  for (const type of ['mp4a', 'enca', 'alac', 'ac-3', 'ec-3', 'Opus', 'fLaC']) {
    let typeOffset = find(bytes, type)
    while (typeOffset >= 4) {
      const atomOffset = typeOffset - 4
      const atomSize = readU32BE(bytes, atomOffset)
      const rateOffset = typeOffset + 28
      if (atomSize >= 36 && rateOffset + 4 <= bytes.length && (atomSize === 0 || atomOffset + atomSize <= bytes.length)) {
        sampleEntryRate = validRate(Math.round(readU32BE(bytes, rateOffset) / 65536)) ?? sampleEntryRate
      }
      typeOffset = find(bytes, type, typeOffset + 1)
    }
  }
  let esds = find(bytes, 'esds')
  while (esds >= 4) {
    const atomOffset = esds - 4
    const atomSize = readU32BE(bytes, atomOffset)
    const end = atomSize >= 8 && atomOffset + atomSize <= bytes.length ? atomOffset + atomSize : bytes.length
    for (let offset = esds + 4; offset < end; offset++) {
      if (bytes[offset] !== 5) continue
      const descriptor = readDescriptorLength(bytes, offset + 1, end)
      if (!descriptor || descriptor.next + descriptor.length > end) continue
      const rate = parseAacConfig(bytes, descriptor.next, descriptor.next + descriptor.length)
      if (rate) return rate
    }
    esds = find(bytes, 'esds', esds + 1)
  }
  return sampleEntryRate
}

const parseMatroska = (bytes: Uint8Array) => {
  if (!has(bytes, 0, '\x1a\x45\xdf\xa3')) return null
  const marker = 0xb5
  for (let offset = 0; offset + 3 < bytes.length; offset++) {
    if (bytes[offset] !== marker) continue
    const sizeByte = bytes[offset + 1]
    const mask = 0x80
    let width = 1
    while (width <= 8 && !(sizeByte & (mask >> (width - 1)))) width++
    if (width > 8 || offset + 1 + width >= bytes.length) continue
    let length = sizeByte & (mask >> width) - 1
    for (let i = 2; i < width + 1; i++) length = length * 256 + bytes[offset + i]
    const body = offset + 1 + width
    if (length !== 4 && length !== 8) continue
    if (body + length > bytes.length) continue
    const view = new DataView(bytes.buffer, bytes.byteOffset + body, length)
    const rate = length === 4 ? view.getFloat32(0, false) : view.getFloat64(0, false)
    const parsed = validRate(Math.round(rate))
    if (parsed) return parsed
  }
  return null
}

export const parseAudioSampleRate = (bytes: Uint8Array): number | null => {
  for (const parser of [parseFlac, parseWave, parseAiff, parseOgg, parseMp4, parseMatroska, parseAdts, parseMpeg]) {
    const rate = parser(bytes)
    if (rate) return rate
  }
  return null
}

const parseAudioInfo = (bytes: Uint8Array): ParsedAudioInfo | null => {
  for (const parser of [parseFlacInfo, parseWaveInfo, parseAiffInfo, parseAdtsInfo, parseMpegInfo]) {
    const info = parser(bytes)
    if (info) return info
  }
  if (has(bytes, 0, 'OggS')) return parsedInfo(find(bytes, 'OpusHead') >= 0 ? 'opus' : 'ogg', parseOgg(bytes))
  if (bytes.length >= 12 && has(bytes, 4, 'ftyp')) return parsedInfo('m4a', parseMp4(bytes))
  if (has(bytes, 0, '\x1a\x45\xdf\xa3')) return parsedInfo('matroska', parseMatroska(bytes))
  return null
}

const detectAudioFormat = (bytes: Uint8Array): string | null => {
  if (has(bytes, 0, 'fLaC')) return 'flac'
  if ((has(bytes, 0, 'RIFF') || has(bytes, 0, 'RF64') || has(bytes, 0, 'BW64')) && has(bytes, 8, 'WAVE')) return 'wav'
  if (has(bytes, 0, 'FORM') && (has(bytes, 8, 'AIFF') || has(bytes, 8, 'AIFC'))) return 'aiff'
  if (has(bytes, 0, 'OggS')) return find(bytes, 'OpusHead') >= 0 ? 'opus' : 'ogg'
  if (bytes.length >= 12 && has(bytes, 4, 'ftyp')) return 'm4a'
  if (parseAdts(bytes)) return 'aac'
  if (parseMpeg(bytes)) return 'mp3'
  return null
}

const readLimited = async(response: Response, maxBytes: number, signal: AbortSignal) => {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, maxBytes - length)
      chunks.push(chunk)
      length += chunk.length
      if (chunk.length < value.length || length === maxBytes) break
    }
  } finally { await reader.cancel().catch(() => {}) }
  if (signal.aborted) return new Uint8Array()
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

const parseContentRange = (value: string | null) => {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? '')
  if (!match) return null
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3]) }
}

const requestRange = async(source: string, start: number, end: number, signal: AbortSignal, headers: Record<string, string>): Promise<{ chunk: ProbeChunk | null, status: number | null }> => {
  const response = await fetch(source, { signal, headers: { ...headers, Range: `bytes=${start}-${end}` } })
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {})
    return { chunk: null, status: response.status }
  }
  const range = parseContentRange(response.headers.get('content-range'))
  const bytes = await readLimited(response, end - start + 1, signal)
  if (!bytes.length) return { chunk: null, status: response.status }
  if (response.status === 206) {
    if (!range || range.start !== start) return { chunk: null, status: response.status }
    return { chunk: { bytes, start: range.start, end: range.start + bytes.length - 1, total: range.total }, status: response.status }
  }
  if (start !== 0) return { chunk: null, status: response.status }
  const total = Number(response.headers.get('content-length'))
  return { chunk: { bytes, start: 0, end: bytes.length - 1, total: Number.isInteger(total) && total > 0 ? total : null }, status: response.status }
}

const readLocalChunks = async(source: string): Promise<Uint8Array[]> => {
  const stats = await fs.stat(source)
  const handle = await fs.open(source, 'r')
  try {
    const headLength = Math.min(stats.size, PROBE_CHUNK_BYTES)
    const head = Buffer.alloc(headLength)
    await handle.read(head, 0, headLength, 0)
    if (stats.size <= PROBE_CHUNK_BYTES) return [head]
    const tailLength = Math.min(stats.size, PROBE_CHUNK_BYTES)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, stats.size - tailLength)
    return [head, tail]
  } finally { await handle.close() }
}

const readRemoteChunks = async(source: string, headers: Record<string, string>): Promise<{ chunks: Uint8Array[], status: number | null, total: number | null }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, DEFAULT_TIMEOUT_MS)
  try {
    const prefixResult = await requestRange(source, 0, PROBE_CHUNK_BYTES - 1, controller.signal, headers)
    const prefix = prefixResult.chunk
    if (!prefix) return { chunks: [], status: prefixResult.status, total: null }
    const chunks = [prefix.bytes]
    if (prefix.total != null && prefix.end + 1 < prefix.total) {
      const start = Math.max(prefix.end + 1, prefix.total - PROBE_CHUNK_BYTES)
      const tail = await requestRange(source, start, prefix.total - 1, controller.signal, headers)
      if (tail.chunk) chunks.push(tail.chunk.bytes)
    }
    return { chunks, status: prefixResult.status, total: prefix.total }
  } catch { return { chunks: [], status: null, total: null } } finally { clearTimeout(timer) }
}

export const probeAudioSourceSampleRate = async(source: string, headers: Record<string, string> = {}): Promise<number | null> => {
  const remote = /^https?:\/\//i.test(source) ? await readRemoteChunks(source, headers) : null
  const chunks = remote ? remote.chunks : await readLocalChunks(source)
  for (const chunk of chunks) {
    const rate = parseAudioSampleRate(chunk)
    if (rate) return rate
  }
  return null
}

const formatFromContentType = (contentType: string | null) => {
  const value = (contentType ?? '').split(';', 1)[0].trim().toLowerCase()
  const formats: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
  }
  return formats[value] ?? null
}

const formatFromSource = (source: string) => {
  try {
    const extension = new URL(source).pathname.split('.').pop()?.toLowerCase()
    return extension && ['mp3', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wav'].includes(extension) ? extension : null
  } catch { return null }
}

export const probeAudioSourceInfo = async(source: string, headers: Record<string, string> = {}) => {
  const isRemote = /^https?:\/\//i.test(source)
  let contentType: string | null = null
  let contentLength: number | null = null
  let headStatus: number | null = null
  if (isRemote) {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, DEFAULT_TIMEOUT_MS)
    try {
      const response = await fetch(source, { method: 'HEAD', signal: controller.signal, headers })
      headStatus = response.status
      contentType = response.headers.get('content-type')
      const length = Number(response.headers.get('content-length'))
      contentLength = Number.isFinite(length) && length > 0 ? length : null
    } catch {}
    clearTimeout(timer)
  }

  // Read the same bounded header/tail sample used by the sample-rate probe.  A
  // URL suffix or Content-Type is only a hint; the returned bytes are the
  // evidence used to identify the actual container.
  const remote = isRemote ? await readRemoteChunks(source, headers) : null
  const chunks = remote ? remote.chunks : await readLocalChunks(source)
  const parsed = chunks.reduce<ParsedAudioInfo | null>((info, chunk) => info ?? parseAudioInfo(chunk), null)
  const sampleRate = parsed?.sampleRate ?? chunks.reduce<number | null>((rate, chunk) => rate ?? parseAudioSampleRate(chunk), null)
  const detectedFormat = parsed?.format ?? chunks.reduce<string | null>((format, chunk) => format ?? detectAudioFormat(chunk), null)
  const contentTypeFormat = formatFromContentType(contentType)
  const sourceFormat = formatFromSource(source)
  const bytesRead = chunks.reduce((total, chunk) => total + chunk.length, 0)
  if (contentLength == null && remote?.total != null) contentLength = remote.total
  const format = detectedFormat ?? contentTypeFormat
  const formatSource = detectedFormat ? 'header' : contentTypeFormat ? 'content-type' : null
  // HEAD is advisory: many audio CDNs reject HEAD while allowing the ranged
  // GET used for probing.  Prefer the actual data request status whenever it
  // exists, and only fall back to HEAD when no data request was made.
  const httpStatus = remote?.status ?? headStatus
  let error: string | null = null
  if (httpStatus != null && httpStatus >= 400) error = `HTTP ${httpStatus}`
  else if (isRemote && bytesRead === 0) error = '未读取到音频数据'
  return {
    sampleRate,
    contentType,
    contentLength,
    format,
    formatSource,
    formatHint: sourceFormat,
    bitrate: parsed?.bitrate ?? null,
    bitsPerSample: parsed?.bitsPerSample ?? null,
    bytesRead,
    httpStatus,
    error,
  }
}
