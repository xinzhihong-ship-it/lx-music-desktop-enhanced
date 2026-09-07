import fs from 'node:fs/promises'

const PROBE_CHUNK_BYTES = 256 * 1024
const DEFAULT_TIMEOUT_MS = 8000
const MIN_SAMPLE_RATE = 8000
const MAX_SAMPLE_RATE = 384000

interface ProbeChunk {
  bytes: Uint8Array
  start: number
  end: number
  total: number | null
}

const validRate = (value: number) => Number.isInteger(value) && value >= MIN_SAMPLE_RATE && value <= MAX_SAMPLE_RATE ? value : null
const readU16BE = (bytes: Uint8Array, offset: number) => bytes[offset] << 8 | bytes[offset + 1]
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

const parseOgg = (bytes: Uint8Array) => {
  if (find(bytes, 'OpusHead') >= 0) return 48000
  const vorbis = find(bytes, '\x01vorbis')
  if (vorbis >= 0 && vorbis + 16 <= bytes.length) return validRate(readU32LE(bytes, vorbis + 12))
  const speex = find(bytes, 'Speex   ')
  if (speex >= 0 && speex + 40 <= bytes.length) return validRate(readU32LE(bytes, speex + 36))
  return null
}

const parseAdts = (bytes: Uint8Array) => {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
  for (let offset = 0; offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) continue
    const index = (bytes[offset + 2] >> 2) & 0x0f
    if (index < rates.length) return validRate(rates[index])
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
    if (rate) return rate
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

const requestRange = async(source: string, start: number, end: number, signal: AbortSignal, headers: Record<string, string>): Promise<ProbeChunk | null> => {
  const response = await fetch(source, { signal, headers: { ...headers, Range: `bytes=${start}-${end}` } })
  if (!response.ok) return null
  const range = parseContentRange(response.headers.get('content-range'))
  const bytes = await readLimited(response, end - start + 1, signal)
  if (!bytes.length) return null
  if (response.status === 206) {
    if (!range || range.start !== start) return null
    return { bytes, start: range.start, end: range.start + bytes.length - 1, total: range.total }
  }
  if (start !== 0) return null
  const total = Number(response.headers.get('content-length'))
  return { bytes, start: 0, end: bytes.length - 1, total: Number.isInteger(total) && total > 0 ? total : null }
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

const readRemoteChunks = async(source: string, headers: Record<string, string>): Promise<Uint8Array[]> => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, DEFAULT_TIMEOUT_MS)
  try {
    const prefix = await requestRange(source, 0, PROBE_CHUNK_BYTES - 1, controller.signal, headers)
    if (!prefix) return []
    const chunks = [prefix.bytes]
    if (prefix.total != null && prefix.end + 1 < prefix.total) {
      const start = Math.max(prefix.end + 1, prefix.total - PROBE_CHUNK_BYTES)
      const tail = await requestRange(source, start, prefix.total - 1, controller.signal, headers)
      if (tail) chunks.push(tail.bytes)
    }
    return chunks
  } catch { return [] } finally { clearTimeout(timer) }
}

export const probeAudioSourceSampleRate = async(source: string, headers: Record<string, string> = {}): Promise<number | null> => {
  const chunks = /^https?:\/\//i.test(source) ? await readRemoteChunks(source, headers) : await readLocalChunks(source)
  for (const chunk of chunks) {
    const rate = parseAudioSampleRate(chunk)
    if (rate) return rate
  }
  return null
}
