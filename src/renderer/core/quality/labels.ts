import { platformQualityBySoftware } from '@common/quality/platformQualitys'

/**
 * 软件档位（master / atmos_plus / atmos / hires / flac / 320k / 128k …）的文案出口。
 *
 * 同一档位有两套文案：列表徽标用的短标签（Master / Hires / SQ / HQ）和设置、弹窗用的
 * 完整名（臻品母带 / Hires 无损24-Bit / FLAC 无损）。这两套以前散落在播放栏、歌曲列表、
 * 下载弹窗与音质测试弹窗里各写一份，改一处就会漏一处，这里收敛成单一出口。
 */

type Translate = (key: string) => string

/** 短标签：歌曲列表、播放栏等窄位置用 */
const SHORT_LABEL_KEYS: Partial<Record<string, string>> = {
  master: 'tag__lossless_master',
  atmos_plus: 'tag__lossless_atmos_plus',
  atmos: 'tag__lossless_atmos',
  hires: 'tag__lossless_hires',
  // 旧键与新键是同一个档位，共用一个标签
  flac24bit: 'tag__lossless_hires',
  flac: 'tag__lossless',
  // ape / wav 是容器格式而不是档位，短标签直接用协议名（见 RAW_LABELS）
  '320k': 'tag__high_quality',
  '192k': 'tag__hq_192k',
}

/** 完整名：设置页、下载弹窗、音质测试等需要说清楚的场合 */
const FULL_LABEL_KEYS: Partial<Record<string, string>> = {
  master: 'setting__play_quality_master',
  atmos_plus: 'setting__play_quality_atmos_plus',
  atmos: 'setting__play_quality_atmos',
  hires: 'setting__play_quality_hires',
  flac24bit: 'setting__play_quality_flac24bit',
  flac: 'setting__play_quality_flac',
  '320k': 'setting__play_quality_320k',
  '192k': 'setting__play_quality_192k',
  '128k': 'setting__play_quality_128k',
  // APE / WAV 是协议名，完整名里补上「无损」以免在下载场景被当成普通格式
  ape: 'setting__play_quality_ape',
  wav: 'setting__play_quality_wav',
}

/** 短标签位置窄，APE / WAV 直接用协议名 */
const RAW_LABELS: Record<string, string> = { ape: 'APE', wav: 'WAV' }

const translate = (t: Translate, table: Partial<Record<string, string>>, quality: string): string => {
  const key = table[quality]
  if (!key) return RAW_LABELS[quality] ?? quality
  const text = t(key)
  return text === key ? (RAW_LABELS[quality] ?? quality) : text
}

export const qualityShortLabel = (t: Translate, quality: string): string => translate(t, SHORT_LABEL_KEYS, quality)

export const qualityFullLabel = (t: Translate, quality: string): string => translate(t, FULL_LABEL_KEYS, quality)

/** 设置页展示平台对照时的顺序，与音源选择里各平台的排列一致 */
const PLATFORM_ORDER: LX.Source[] = ['kw', 'kg', 'tx', 'wy', 'mg']

/**
 * 某个软件档位在各平台对应的平台档位名，供设置页 hover 提示使用。
 * 一个平台可能有多个档位落到同一软件档位（网易的 hires 对应 hr 与高清臻音），
 * 这种情况全部列出，让用户看到平台口径的差异。
 */
export const platformQualityTip = (t: Translate, quality: LX.Quality): string => {
  const lines: string[] = []
  for (const source of PLATFORM_ORDER) {
    const entries = platformQualityBySoftware(source, quality)
    if (!entries.length) continue
    const names = entries
      .map(entry => {
        const name = t(entry.nameKey)
        return entry.noteKey ? `${name}（${t(entry.noteKey)}）` : name
      })
      .join(' / ')
    lines.push(`${t(`source_${source}`)}：${names}`)
  }
  return lines.join('\n')
}
