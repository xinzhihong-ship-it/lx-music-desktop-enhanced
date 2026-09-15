const lossyFormats = new Set(['mp3', 'aac', 'ogg', 'opus'])
const losslessFormats = new Set(['flac', 'wav', 'aiff'])

export interface ActualAudioProbe {
  format: string | null
  sampleRate: number | null
  bitrate?: number | null
  bitsPerSample?: number | null
  contentLength?: number | null
  error?: string | null
  bytesRead?: number
}

export interface ActualQualityResult {
  /** 界面显示用的档位名称，与设置中的音质名称一致 */
  quality: string
  /** 仅凭音频规格能证明的档位，无法证明时为 null */
  detected: string | null
  /** 探测结果低于请求档位时为 true */
  downgraded: boolean
}

interface AudioEvidence {
  lossless: boolean
  bitrate: number | null
  bits: number | null
  sampleRate: number | null
}

interface TierRequirement {
  lossless: boolean
  minBits?: number
  minRate?: number
  minBitrate?: number
}

// 各档位要求的最低规格。母带、全景声这类专有档位无法从容器直接证明，因此
// 只在探测结果满足规格要求时沿用请求档位名称，避免把真实的高规格文件标低。
const tierRequirements: Record<string, TierRequirement> = {
  '128k': { lossless: false, minBitrate: 0 },
  '192k': { lossless: false, minBitrate: 180_000 },
  '320k': { lossless: false, minBitrate: 280_000 },
  flac: { lossless: true, minBits: 16 },
  flac24bit: { lossless: true, minBits: 24 },
  hires: { lossless: true, minBits: 24 },
  // 96kHz 与 192kHz 都会被平台标注为母带，24bit 高采样率即视为满足。
  master: { lossless: true, minBits: 24, minRate: 88_200 },
  atmos: { lossless: true },
  atmos_plus: { lossless: true },
  ape: { lossless: true },
  wav: { lossless: true },
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

const mapLossyBitrate = (bitrate: number | null): string | null => {
  if (!bitrate) return null
  // 网络文件大小包含标签与编码器填充，边界放宽以免把 128K 误判为 192K。
  if (bitrate <= 180_000) return '128k'
  if (bitrate <= 280_000) return '192k'
  return '320k'
}

const readEvidence = (probe: ActualAudioProbe | null | undefined, interval: unknown): AudioEvidence | null => {
  if (!probe || probe.error != null || !probe.bytesRead || !probe.format || probe.sampleRate == null) return null
  const format = probe.format.toLowerCase()
  if (lossyFormats.has(format)) {
    return { lossless: false, bitrate: estimateBitrate(probe, interval), bits: null, sampleRate: probe.sampleRate }
  }
  // M4A、Matroska 等容器可能是 AAC、ALAC 或专有编码，仅凭容器无法判定。
  if (!losslessFormats.has(format)) return null
  return { lossless: true, bitrate: null, bits: probe.bitsPerSample ?? null, sampleRate: probe.sampleRate }
}

const resolveDetectedTier = (evidence: AudioEvidence): string | null => {
  if (!evidence.lossless) return mapLossyBitrate(evidence.bitrate)
  const bits = evidence.bits
  const rate = evidence.sampleRate ?? 0
  // 明确是 16bit 时即使采样率很高也只是普通无损，不能算高解析度。
  if (bits != null && bits < 24) return 'flac'
  if (bits != null) return rate >= 88_200 ? 'hires' : 'flac24bit'
  // 位深未知但采样率很高时按高解析度处理，避免把 24bit 文件标成普通无损。
  if (rate >= 88_200) return 'hires'
  return 'flac'
}

const meetsRequirement = (tier: string, evidence: AudioEvidence): boolean => {
  const requirement = tierRequirements[tier]
  if (!requirement) return true
  if (evidence.lossless) {
    // 无损流一定能满足有损档位请求。
    if (!requirement.lossless) return true
    // 位深读不到时不做否定判断，只有明确低于要求才算降质。
    if (requirement.minBits != null && evidence.bits != null && evidence.bits < requirement.minBits) return false
    return (evidence.sampleRate ?? 0) >= (requirement.minRate ?? 0)
  }
  if (requirement.lossless) return false
  return (evidence.bitrate ?? 0) >= (requirement.minBitrate ?? 0)
}

/**
 * 把探测到的音频规格换算成设置中的档位名称。只有拿到确凿的规格证据时才判定
 * 降质：请求无损却返回有损、请求高码率却返回低码率、请求 24bit 却返回 16bit。
 * 证据不足（例如 M4A 容器里的全景声）时沿用请求档位，不把不确定当成降质。
 */
export const describeActualQuality = ({ probe, interval, requested }: {
  probe?: ActualAudioProbe | null
  interval?: unknown
  requested?: string | null
}): ActualQualityResult => {
  const requestedTier = typeof requested === 'string' ? requested : ''
  const evidence = readEvidence(probe, interval)
  if (!evidence) return { quality: requestedTier, detected: null, downgraded: false }
  const detected = resolveDetectedTier(evidence)
  if (!requestedTier || meetsRequirement(requestedTier, evidence)) {
    return { quality: requestedTier, detected, downgraded: false }
  }
  return { quality: detected ?? requestedTier, detected, downgraded: detected != null }
}
