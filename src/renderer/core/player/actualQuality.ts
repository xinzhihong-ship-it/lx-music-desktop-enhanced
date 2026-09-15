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
  minBitrate?: number
}

// 有损档位只有「128K 普音」与「320K 高音」两档，中间码率没有对应档位。
const LOSSY_128K_MAX = 180_000
const LOSSY_320K_MIN = 280_000

// 与设置中的档位顺序一致，索引越大档位越低。flac24bit / 192k 只作为兼容键保留。
const QUALITY_RANK = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k']

// 请求档位对证据的最低要求。母带、全景声这类专有档位只要求无损，24bit 档位
// 要求位深达到 24bit（母带不再额外校验采样率，与 ikun 的口径一致）。
const tierRequirements: Record<string, TierRequirement> = {
  '128k': { lossless: false, minBitrate: 0 },
  '192k': { lossless: false, minBitrate: LOSSY_128K_MAX },
  '320k': { lossless: false, minBitrate: LOSSY_320K_MIN },
  flac: { lossless: true, minBits: 16 },
  flac24bit: { lossless: true, minBits: 24 },
  hires: { lossless: true, minBits: 24 },
  master: { lossless: true, minBits: 24 },
  atmos: { lossless: true },
  atmos_plus: { lossless: true },
  ape: { lossless: true },
  wav: { lossless: true },
}

const qualityRank = (tier: string) => {
  const index = QUALITY_RANK.indexOf(tier)
  return index < 0 ? QUALITY_RANK.length : index
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
  if (bitrate <= LOSSY_128K_MAX) return '128k'
  if (bitrate >= LOSSY_320K_MIN) return '320k'
  // 180k–280k 属于中间码率，档位表里没有对应项，不猜档位。
  return null
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
  // 24bit 无损一律算 hires，不再区分 44.1kHz 与 96kHz。
  if (bits != null && bits < 24) return 'flac'
  if (bits != null) return 'hires'
  // 位深读不到时按采样率兜底，避免把高解析度文件标成普通无损。
  return (evidence.sampleRate ?? 0) >= 88_200 ? 'hires' : 'flac'
}

/**
 * 把探测到的音频规格换算成设置中的档位名称，口径与 ikun-music-desktop 一致：
 * 24bit 无损一律算 hires，母带只要「无损且 24bit」即认可，有损只分 128K 普音
 * 与 320K 高音两档。只有拿到确凿证据才判定降质，证据不足时沿用请求档位。
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
  const requirement = tierRequirements[requestedTier]
  if (!requestedTier || !requirement) return { quality: requestedTier, detected, downgraded: false }

  if (!evidence.lossless) {
    if (!requirement.lossless) {
      // 有损请求：只有实测档位明确低于请求档位时才提示降质，中间码率不判定。
      if (detected != null && qualityRank(detected) > qualityRank(requestedTier)) {
        return { quality: detected, detected, downgraded: true }
      }
      return { quality: requestedTier, detected, downgraded: false }
    }
    // 无损请求拿到有损流：明显的降质，中间码率按最低有损档提示。
    return { quality: detected ?? '128k', detected, downgraded: true }
  }

  // 无损流一定能满足有损档位请求。
  if (!requirement.lossless) return { quality: requestedTier, detected, downgraded: false }
  // 位深读不到时不做否定判断，只有明确低于要求才算降质。
  if (requirement.minBits != null && evidence.bits != null && evidence.bits < requirement.minBits) {
    return { quality: 'flac', detected, downgraded: true }
  }
  return { quality: requestedTier, detected, downgraded: false }
}
