import { getPlatformQuality, getPlatformQualities } from '@common/quality/platformQualitys'
import type { PlatformQualityEntry, PlatformQualitySpec } from '@common/quality/platformQualitys'
import { describeAudioSpec, detectQualityTier } from '@renderer/core/player/actualQuality'
import type { ActualAudioProbe, AudioEvidence } from '@renderer/core/player/actualQuality'

/**
 * 按平台口径判定音质。
 *
 * `actualQuality.ts` 那套规则把「音频规格」折算成软件档位，用于播放栏显示；但它不能用来说明
 * 「平台定义的这个档位到底拿到了没有」——同一个软件档位在各平台的真实规格并不相同：
 * QQ 的 SQ 无损实际交付的常是 24bit 文件，酷狗的无损则是 16bit；网易的高清臻音是 24bit/96kHz
 * 无损，却不在软件的 hires 定义里。所以平台的音质测试按各平台自己声明的档位规格来判，
 * 平台怎么定义档位，就按平台的规格去比。
 */

export type PlatformQualityVerdictKind = 'pass' | 'downgrade' | 'unknown'

export interface PlatformQualityVerdict {
  /** 被测试的平台档位 */
  entry: PlatformQualityEntry
  /** 探测到的音频规格，证据不足时为 null */
  actual: AudioEvidence | null
  kind: PlatformQualityVerdictKind
  /**
   * 判定后落在哪个软件档位：通过时是该平台档位对应的软件档位，降级时是实测落到的档位，
   * 无法确认时为 null。
   */
  tier: LX.Quality | null
}

/**
 * 按平台档位的预期规格判定实测结果：
 * 规格达标为 pass；实测明确低于该档位要求为 downgrade；拿不到证据、或该档位本身无法证明时为 unknown。
 */
export const evaluateAudioSpec = (spec: PlatformQualitySpec, actual: AudioEvidence | null): PlatformQualityVerdictKind => {
  // 全景声、DTS:X、3D 音频这类专有编码，即使探测到容器也无法证明档位
  if (!spec.verifiable) return 'unknown'
  if (!actual) return 'unknown'
  if (spec.lossless) {
    if (!actual.lossless) return 'downgrade'
    // 位深读不到时不做否定判断，只有明确低于要求才算降质
    if (spec.minBits != null && actual.bits != null && actual.bits < spec.minBits) return 'downgrade'
    return 'pass'
  }
  // 无损流一定能满足有损档位
  if (actual.lossless) return 'pass'
  if (actual.bitrate == null) return 'unknown'
  if (spec.minBitrate != null && actual.bitrate < spec.minBitrate) return 'downgrade'
  // 码率高于该档位要求同样不算降质
  return 'pass'
}

/**
 * 判定一次针对某个平台档位的请求。
 * 档位码（平台接口/脚本里的档位标识，如 kg 的 viper_clear、wy 的 jyeffect）不在字典里时返回 null。
 */
export const describePlatformQuality = ({ probe, interval, source, qualityId }: {
  probe?: ActualAudioProbe | null
  interval?: unknown
  source: LX.Source
  qualityId: string
}): PlatformQualityVerdict | null => {
  const entry = getPlatformQuality(source, qualityId)
  if (!entry) return null
  const actual = describeAudioSpec(probe, interval)
  const kind = evaluateAudioSpec(entry.spec, actual)
  if (kind === 'pass') return { entry, actual, kind, tier: entry.softwareQuality }
  if (kind === 'downgrade') {
    // 降级时给出实测真正落到了哪一档，供界面对照
    const detected = actual ? detectQualityTier(actual) : null
    return { entry, actual, kind, tier: (detected as LX.Quality | null) }
  }
  return { entry, actual, kind, tier: null }
}

/** 一个平台档位在当前音源脚本下能否被测到 */
export type PlatformTestSkipReason = 'no_music_url' | 'platform_proprietary' | 'source_not_declared'

export interface PlatformTestRow {
  source: LX.Source
  /** 平台档位码；兜底行（字典里没有的软件档位）为空串 */
  qualityId: string
  /** 请求时传给音源脚本的档位键；平台专有档位没有对应键时为 null */
  requestType: LX.Quality | null
  /** 该平台档位的预期规格；兜底行为 null，表示退回软件档位的通用规则判定 */
  spec: PlatformQualitySpec | null
  /** 平台档位名的 i18n 键；兜底行为空串 */
  nameKey: string
  noteKey?: string
  /** 能否发起测试 */
  requestable: boolean
  reason?: PlatformTestSkipReason
}

// 24bit 无损的新旧口径：新键 hires 与旧键 flac24bit 是同一个档位
const qualityAlias = (quality: LX.Quality): LX.Quality | null =>
  quality === 'hires' ? 'flac24bit' : quality === 'flac24bit' ? 'hires' : null

/**
 * 组装某个平台的音质测试计划。
 *
 * 以平台自己的档位表为骨架逐档出列——平台有哪几档就测哪几档，测试结果也就按平台的叫法展示，
 * 而不是按软件档位。脚本没声明的档位、以及平台专有而软件没有对应键的档位都保留在计划里，
 * 只是标记为不可请求，让用户看到「这个平台有这一档，但当前音源给不了」。
 */
export const buildPlatformTestPlan = ({ source, declaredQualitys, hasMusicUrl }: {
  source: LX.Source
  declaredQualitys: readonly LX.Quality[]
  hasMusicUrl: boolean
}): PlatformTestRow[] => {
  const declared = new Set<string>(declaredQualitys)
  const rows: PlatformTestRow[] = getPlatformQualities(source).map(entry => {
    const requestType = entry.softwareQuality
    let requestable = false
    let reason: PlatformTestSkipReason | undefined
    if (!hasMusicUrl) reason = 'no_music_url'
    else if (requestType == null) reason = 'platform_proprietary'
    else {
      const alias = qualityAlias(requestType)
      if (declared.has(requestType) || (alias != null && declared.has(alias))) requestable = true
      else reason = 'source_not_declared'
    }
    return {
      source,
      qualityId: entry.id,
      requestType,
      spec: entry.spec,
      nameKey: entry.nameKey,
      noteKey: entry.noteKey,
      requestable,
      reason,
    }
  })

  // 脚本声明了、但平台档位表里没有对应项的软件档位补一行兜底，避免这些档位在测试里消失。
  // 这类行没有平台规格，判定退回软件档位的通用规则。
  const covered = new Set<string>()
  for (const row of rows) {
    if (!row.requestType) continue
    covered.add(row.requestType)
    const alias = qualityAlias(row.requestType)
    if (alias) covered.add(alias)
  }
  for (const quality of declaredQualitys) {
    if (covered.has(quality)) continue
    covered.add(quality)
    rows.push({
      source,
      qualityId: '',
      requestType: quality,
      spec: null,
      nameKey: '',
      requestable: hasMusicUrl,
      reason: hasMusicUrl ? undefined : 'no_music_url',
    })
  }
  return rows
}
