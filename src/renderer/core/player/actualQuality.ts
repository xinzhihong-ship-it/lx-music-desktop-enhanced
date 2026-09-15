const lossyFormats = new Set(['mp3', 'aac', 'ogg', 'opus'])
const losslessFormats = new Set(['flac', 'wav', 'aiff', 'ape'])

export interface ActualAudioProbe {
  format: string | null
  sampleRate: number | null
  bitrate?: number | null
  bitsPerSample?: number | null
  contentLength?: number | null
  error?: string | null
  bytesRead?: number
}

const parseDuration = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value !== 'string') return null
  const parts = value.trim().split(':').map(Number)
  if (parts.some(item => !Number.isFinite(item)) || parts.length < 2) return null
  const seconds = parts.reduce((total, item) => total * 60 + item, 0)
  return seconds > 0 ? seconds : null
}

const estimateBitrate = (probe: ActualAudioProbe, interval: unknown): number | null => {
  const bitrate = Number(probe.bitrate)
  if (Number.isFinite(bitrate) && bitrate > 0) return bitrate
  const contentLength = Number(probe.contentLength)
  const duration = parseDuration(interval)
  if (!Number.isFinite(contentLength) || contentLength <= 0 || !duration) return null
  return contentLength * 8 / duration
}

const mapLossyBitrate = (bitrate: number | null): LX.Quality | null => {
  if (!bitrate) return null
  // Network file sizes include tags and encoder padding. Keep the boundaries
  // broad enough to avoid turning a normal 128K file into 192K.
  if (bitrate <= 180_000) return '128k'
  if (bitrate <= 280_000) return '192k'
  return '320k'
}

/**
 * Convert the detected stream properties to one of the quality names exposed
 * in the playback settings. This deliberately leaves proprietary tiers such
 * as Master and Atmos unknown because a container header cannot prove them.
 */
export const resolveActualQuality = (probe: ActualAudioProbe, interval: unknown): LX.Quality | 'unknown' | null => {
  if (!probe || probe.error != null || probe.bytesRead === 0 || !probe.format || !probe.sampleRate) return 'unknown'
  const format = probe.format.toLowerCase()
  if (lossyFormats.has(format)) return mapLossyBitrate(estimateBitrate(probe, interval)) ?? 'unknown'
  if (losslessFormats.has(format)) {
    if (format === 'wav') return 'wav'
    if (format === 'ape') return 'ape'
    if (probe.sampleRate >= 88_200) return 'hires'
    if ((probe.bitsPerSample ?? 0) >= 24) return 'flac24bit'
    return 'flac'
  }
  // M4A may contain AAC, ALAC or a proprietary Atmos stream. Without codec
  // metadata it is safer to leave the displayed quality unconfirmed.
  return 'unknown'
}
