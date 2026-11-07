// 歌词统一数据结构：所有来源（各平台、本地文件、自定义源）解析后都转成 LyricDoc，
// 播放详情页、舞台、桌面歌词、顶部岛、状态栏都只读这一种结构。
// 时间单位统一为毫秒，均为相对歌曲开头的绝对时间。

export interface LyricWord {
  text: string
  start: number
  end: number
}

export interface LyricLine {
  start: number
  end: number
  text: string
  /** 翻译，没有为空串 */
  translation: string
  /** 罗马音，没有为空串 */
  roma: string
  /** 逐字（每个中日韩字符一个；其他语言按空格分词，词尾空格保留在词里） */
  words: LyricWord[]
  /** words 是否来自真实的逐字时间；false 表示按字数估算 */
  timedWords: boolean
}

export interface LyricDoc {
  lines: LyricLine[]
  /** LRC [offset:] 标签的偏移（毫秒）。生效位置 = 播放位置 + offset */
  offset: number
  hasWords: boolean
  hasTranslation: boolean
  hasRoma: boolean
  /** ti / ar / al / by 等标签 */
  tags: Record<string, string>
}

/** 各平台接口返回的原始文本（与 LX.Music.LyricInfo 字段一致） */
export interface LyricSourceText {
  lyric: string
  tlyric?: string | null
  rlyric?: string | null
  lxlyric?: string | null
}
