/**
 * 平台音质字典：把「平台自己的音质档位」作为一等公民。
 *
 * 项目里同时存在三套档位坐标系，它们互不相同：
 *  1. 平台档位——平台接口的档位码，以及平台在自家客户端里显示给用户的名字（本文件）
 *  2. 软件档位——播放设置里的档位（master / atmos_plus / atmos / hires / flac / 320k / 128k）
 *  3. 探测规格——从音频文件头解析出的真实格式、位深、采样率、码率
 *
 * 同一个「无损」在不同平台可能是 16bit 也可能是 24bit 文件，同一个软件档位在不同平台
 * 对应的平台档位也各不相同。所以凡是需要展示「平台怎么显示」的地方（设置页音质对照、
 * 播放栏标签、音源音质测试）都从这里取词，而不是拿软件档位名硬套。
 *
 * 档位名走 i18n（quality_platform_<source>_<id>），三份语言文件保持同步。
 * 档位码与规格来自各平台官方客户端 / 官方接口文档的实测核对，见各平台注释。
 */

export interface PlatformQualitySpec {
  /** 是否无损容器（flac / wav / aiff 等） */
  lossless: boolean
  /** 最低位深要求，无损档位用 */
  minBits?: number
  /** 最低采样率要求 */
  minSampleRate?: number
  /** 有损档位的码率下限（bps） */
  minBitrate?: number
  /** 有损档位的码率上限（bps） */
  maxBitrate?: number
  /**
   * 能否仅凭容器与文件头证明拿到了该档位。
   * 杜比全景声、DTS:X、3D 音频这类专有编码为 false——即使探测到容器，也只能算「无法确认」。
   */
  verifiable: boolean
}

export interface PlatformQualityEntry {
  /** 平台原生档位码，与平台接口字段以及音源脚本的请求参数对应 */
  id: string
  /** 平台官方显示名的 i18n 键 */
  nameKey: string
  /** 对应的软件档位；平台专有、软件里没有对应档位时为 null */
  softwareQuality: LX.Quality | null
  spec: PlatformQualitySpec
  /** 补充说明的 i18n 键，如酷狗蝰蛇母带「部分曲目会回落 320K」 */
  noteKey?: string
}

/** 有损档位：给出该档位应有的码率区间 */
const LOSSY = (minBitrate: number, maxBitrate: number): PlatformQualitySpec => ({
  lossless: false, minBitrate, maxBitrate, verifiable: true,
})

/** 无损档位：要求达到最低位深 */
const LOSSLESS = (minBits = 16): PlatformQualitySpec => ({
  lossless: true, minBits, verifiable: true,
})

/** 专有编码（全景声 / DTS / 3D）：容器可辨，档位不可证 */
const PROPRIETARY: PlatformQualitySpec = { lossless: false, verifiable: false }

export const PLATFORM_QUALITYS: Partial<Record<LX.Source, PlatformQualityEntry[]>> = {
  // 酷我：档位码就是 N_MINFO 里的 bitrate 值，采集端（kw/musicSearch.js 等 5 处）按它匹配。
  // 名称来自官方 APK 的 classes*.dex；zply / zpga* / dtsx / ac4 / dd* 是酷我自己的占位码率。
  kw: [
    { id: '48', nameKey: 'quality_platform_kw_48', softwareQuality: null, spec: LOSSY(0, 96_000) },
    { id: '128', nameKey: 'quality_platform_kw_128', softwareQuality: '128k', spec: LOSSY(96_000, 160_000) },
    { id: '320', nameKey: 'quality_platform_kw_320', softwareQuality: '320k', spec: LOSSY(280_000, 400_000) },
    { id: '2000', nameKey: 'quality_platform_kw_2000', softwareQuality: 'flac', spec: LOSSLESS(16) },
    { id: '4000', nameKey: 'quality_platform_kw_4000', softwareQuality: 'hires', spec: LOSSLESS(24) },
    { id: '20201', nameKey: 'quality_platform_kw_zpga', softwareQuality: 'atmos_plus', spec: LOSSLESS(24) },
    { id: '20900', nameKey: 'quality_platform_kw_zply', softwareQuality: 'master', spec: LOSSLESS(24) },
    { id: '11000', nameKey: 'quality_platform_kw_dolby', softwareQuality: 'atmos', spec: PROPRIETARY },
    { id: '25000', nameKey: 'quality_platform_kw_dtsx', softwareQuality: 'atmos', spec: PROPRIETARY },
  ],

  // 酷狗：档位码即 get_res_privilege 的 quality 字段（kg/quality_detail.js 的 qualityMap）。
  // 「蝰蛇超清」viper_clear 实测 3621kbps、24bit，规格上属母带级；官方的「蝰蛇母带」
  // 是 viper_tape，但大部分曲目没有该档，接口会回落成 320K。
  kg: [
    { id: '128', nameKey: 'quality_platform_kg_128', softwareQuality: '128k', spec: LOSSY(96_000, 160_000) },
    { id: '320', nameKey: 'quality_platform_kg_320', softwareQuality: '320k', spec: LOSSY(280_000, 400_000) },
    { id: 'flac', nameKey: 'quality_platform_kg_flac', softwareQuality: 'flac', spec: LOSSLESS(16) },
    { id: 'high', nameKey: 'quality_platform_kg_high', softwareQuality: 'hires', spec: LOSSLESS(24) },
    { id: 'viper_clear', nameKey: 'quality_platform_kg_viper_clear', softwareQuality: 'master', spec: LOSSLESS(24) },
    {
      id: 'viper_tape',
      nameKey: 'quality_platform_kg_viper_tape',
      softwareQuality: 'master',
      spec: LOSSLESS(24),
      noteKey: 'quality_platform_note_kg_viper_tape',
    },
    { id: 'viper_atmos', nameKey: 'quality_platform_kg_viper_atmos', softwareQuality: 'atmos', spec: PROPRIETARY },
    { id: 'dolby', nameKey: 'quality_platform_kg_dolby', softwareQuality: 'atmos', spec: PROPRIETARY },
  ],

  // QQ：档位码即 trackInfo.file 的字段名。size_new 是「臻品系列」数组，
  // 索引语义取自 QQMusicApi 的 file 模型文档（另有一份参考把 [1]/[2] 都算作全景声，
  // 这两档的归属仍需用真实地址抓文件头确认后校正）。
  tx: [
    { id: 'size_48aac', nameKey: 'quality_platform_tx_48aac', softwareQuality: null, spec: LOSSY(0, 96_000) },
    { id: 'size_128mp3', nameKey: 'quality_platform_tx_128mp3', softwareQuality: '128k', spec: LOSSY(96_000, 160_000) },
    { id: 'size_320mp3', nameKey: 'quality_platform_tx_320mp3', softwareQuality: '320k', spec: LOSSY(280_000, 400_000) },
    { id: 'size_flac', nameKey: 'quality_platform_tx_flac', softwareQuality: 'flac', spec: LOSSLESS(16) },
    { id: 'size_hires', nameKey: 'quality_platform_tx_hires', softwareQuality: 'hires', spec: LOSSLESS(24) },
    { id: 'size_new0', nameKey: 'quality_platform_tx_master', softwareQuality: 'master', spec: LOSSLESS(24) },
    { id: 'size_new1', nameKey: 'quality_platform_tx_atmos_plus', softwareQuality: 'atmos_plus', spec: LOSSLESS(24) },
    { id: 'size_new2', nameKey: 'quality_platform_tx_atmos', softwareQuality: 'atmos', spec: PROPRIETARY },
    { id: 'size_new3', nameKey: 'quality_platform_tx_ogg320', softwareQuality: '320k', spec: LOSSY(280_000, 400_000) },
    { id: 'size_new5', nameKey: 'quality_platform_tx_ogg640', softwareQuality: 'flac', spec: LOSSLESS(16) },
    { id: 'size_new7', nameKey: 'quality_platform_tx_nac', softwareQuality: null, spec: LOSSY(0, 240_000) },
    { id: 'size_new9', nameKey: 'quality_platform_tx_dtsx', softwareQuality: null, spec: PROPRIETARY },
    { id: 'size_dolby', nameKey: 'quality_platform_tx_dolby', softwareQuality: 'atmos', spec: PROPRIETARY },
    { id: 'size_dts', nameKey: 'quality_platform_tx_dts', softwareQuality: null, spec: PROPRIETARY },
  ],

  // 网易：档位码即 detail/get 响应里的字段名，也就是 eapi 的 level 键。
  // je（高清臻音）实测为 96kHz/24bit 无损、与 QQ 的 size_hires 同源，因此归 hires；
  // 真正的杜比全景声是 db（768kbps / 48kHz E-AC3）。m 是 192kbps，不是 128k。
  wy: [
    { id: 'l', nameKey: 'quality_platform_wy_l', softwareQuality: '128k', spec: LOSSY(96_000, 160_000) },
    { id: 'm', nameKey: 'quality_platform_wy_m', softwareQuality: '192k', spec: LOSSY(160_000, 256_000) },
    { id: 'h', nameKey: 'quality_platform_wy_h', softwareQuality: '320k', spec: LOSSY(280_000, 400_000) },
    { id: 'sq', nameKey: 'quality_platform_wy_sq', softwareQuality: 'flac', spec: LOSSLESS(16) },
    { id: 'hr', nameKey: 'quality_platform_wy_hr', softwareQuality: 'hires', spec: LOSSLESS(24) },
    { id: 'je', nameKey: 'quality_platform_wy_je', softwareQuality: 'hires', spec: LOSSLESS(24) },
    { id: 'jm', nameKey: 'quality_platform_wy_jm', softwareQuality: 'master', spec: LOSSLESS(24) },
    { id: 'sk', nameKey: 'quality_platform_wy_sk', softwareQuality: null, spec: PROPRIETARY },
    { id: 'db', nameKey: 'quality_platform_wy_db', softwareQuality: 'atmos', spec: PROPRIETARY },
  ],

  // 咪咕：档位码是 toneFlag（newRateFormats 的 formatType），规格取自咪咕 CDN 的文件路径。
  // 注意有效的 24bit 档位码是 ZQ24，不是 ZQ（ZQ32 是 32bit wav）。
  mg: [
    { id: 'LQ', nameKey: 'quality_platform_mg_lq', softwareQuality: null, spec: LOSSY(0, 96_000) },
    { id: 'PQ', nameKey: 'quality_platform_mg_pq', softwareQuality: '128k', spec: LOSSY(96_000, 160_000) },
    { id: 'HQ', nameKey: 'quality_platform_mg_hq', softwareQuality: '320k', spec: LOSSY(280_000, 400_000) },
    { id: 'SQ', nameKey: 'quality_platform_mg_sq', softwareQuality: 'flac', spec: LOSSLESS(16) },
    { id: 'ZQ24', nameKey: 'quality_platform_mg_zq24', softwareQuality: 'hires', spec: LOSSLESS(24) },
    { id: 'ZQ32', nameKey: 'quality_platform_mg_zq32', softwareQuality: 'master', spec: LOSSLESS(24) },
    { id: 'Z3D', nameKey: 'quality_platform_mg_z3d', softwareQuality: 'atmos', spec: PROPRIETARY },
    { id: 'I3D', nameKey: 'quality_platform_mg_i3d', softwareQuality: 'atmos', spec: PROPRIETARY },
  ],
}

/** 平台档位码 → 档位定义 */
export const getPlatformQuality = (source: LX.Source, id: string): PlatformQualityEntry | undefined =>
  PLATFORM_QUALITYS[source]?.find(entry => entry.id === id)

/**
 * 平台的全部档位，按从低到高排列（与字典里的书写顺序一致）。
 * GitCode / Bilibili 没有平台档位表，返回空数组。
 */
export const getPlatformQualities = (source: LX.Source): PlatformQualityEntry[] =>
  PLATFORM_QUALITYS[source] ?? []

// 24bit 无损的新旧口径：新档位叫 hires，旧数据与旧音源脚本仍用 flac24bit。
const SOFTWARE_ALIASES: Partial<Record<string, string>> = { flac24bit: 'hires', hires: 'flac24bit' }

/**
 * 一个软件档位在某个平台对应的全部平台档位。
 * 返回数组是为了天然处理多对一：网易的 hires 同时对应 hr 与 je，酷狗的 master 同时对应
 * viper_clear 与 viper_tape。
 */
export const platformQualityBySoftware = (source: LX.Source, quality: LX.Quality): PlatformQualityEntry[] => {
  const entries = getPlatformQualities(source)
  const direct = entries.filter(entry => entry.softwareQuality === quality)
  if (direct.length) return direct
  // 旧键（flac24bit）与新键（hires）互为别名，任一方向都要能查到。
  const alias = SOFTWARE_ALIASES[quality]
  return alias ? entries.filter(entry => entry.softwareQuality === alias) : []
}
