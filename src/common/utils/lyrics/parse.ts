import type { LyricDoc, LyricLine, LyricSourceText, LyricWord } from './types'
import { spreadWords } from './words'

export interface LrcEntry {
  time: number
  text: string
}

export interface ParsedLrc {
  entries: LrcEntry[]
  tags: Record<string, string>
}

// 行首连续的时间戳：[mm:ss] [mm:ss.x] [mm:ss.xx] [mm:ss.xxx] [mm:ss:xx]
const LEADING_TIMES_RXP = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/
const TIME_RXP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const TAG_RXP = /^\[([a-z]+):([^\]]*)\]$/i
const LX_WORD_RXP = /<(\d+),(\d+)>/g
const LINE_SPLIT_RXP = /\r\n|\n|\r/

/** 没有逐字时间时，一行最多持续这么久（之后视为无人声） */
const MAX_LINE_DURATION = 6000
/** 翻译 / 罗马音与原文行的最大时间差 */
const EXTENDED_MATCH_GAP = 1500

const toMs = (min: string, sec: string, frac?: string) => {
  let ms = parseInt(min) * 60_000 + parseInt(sec) * 1000
  if (frac) ms += Math.round(parseInt(frac) * 1000 / 10 ** frac.length)
  return ms
}

const stripBom = (text: string) => text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

/** 解析 LRC：一行可带多个时间戳；空文本行保留（用来确定上一行的结束时间） */
export const parseLrc = (lrc: string | null | undefined): ParsedLrc => {
  const entries: LrcEntry[] = []
  const tags: Record<string, string> = {}
  if (!lrc) return { entries, tags }
  for (const rawLine of stripBom(lrc).split(LINE_SPLIT_RXP)) {
    const line = rawLine.trim()
    if (!line) continue
    const leading = LEADING_TIMES_RXP.exec(line)
    if (!leading) {
      const tag = TAG_RXP.exec(line)
      if (tag) tags[tag[1].toLowerCase()] = tag[2].trim()
      continue
    }
    const text = line.slice(leading[0].length).trim()
    for (const match of leading[0].matchAll(TIME_RXP)) {
      entries.push({ time: toMs(match[1], match[2], match[3]), text })
    }
  }
  // 稳定排序：同一时间的多行保持原顺序
  entries.sort((a, b) => a.time - b.time)
  return { entries, tags }
}

/** 解析一行 lxlrc 的逐字部分：<相对行首偏移,时长>字 */
export const parseLxWords = (text: string, lineStart: number): LyricWord[] | null => {
  const words: LyricWord[] = []
  const matches = [...text.matchAll(LX_WORD_RXP)]
  if (!matches.length) return null
  // 第一个标记之前不能有文字，否则不是合法的逐字行
  if (text.slice(0, matches[0].index).trim()) return null
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const from = match.index + match[0].length
    const to = i + 1 < matches.length ? matches[i + 1].index : text.length
    const wordText = text.slice(from, to)
    if (!wordText) continue
    const start = lineStart + parseInt(match[1])
    words.push({ text: wordText, start, end: start + parseInt(match[2]) })
  }
  return words.length ? words : null
}

const parseOffset = (value: string | undefined) => {
  if (!value) return 0
  const offset = parseInt(value)
  return Number.isNaN(offset) ? 0 : offset
}

const isIgnoredExtendedText = (text: string) => !text || text == '//'

/** 把翻译 / 罗马音挂到时间最近（且不超过 1.5 秒）的原文行上，每行只取第一条 */
const attachExtended = (lines: LyricLine[], lrc: string | null | undefined, field: 'translation' | 'roma') => {
  if (!lrc || !lines.length) return
  for (const entry of parseLrc(lrc).entries) {
    if (isIgnoredExtendedText(entry.text)) continue
    let best = -1
    let bestGap = EXTENDED_MATCH_GAP
    // lines 按时间排序：二分定位后只看两侧
    let lo = 0
    let hi = lines.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (lines[mid].start < entry.time) lo = mid + 1
      else hi = mid
    }
    for (let i = Math.max(0, lo - 1); i <= Math.min(lines.length - 1, lo); i++) {
      const gap = Math.abs(lines[i].start - entry.time)
      if (gap <= bestGap && (best < 0 || gap < bestGap)) {
        best = i
        bestGap = gap
      }
    }
    if (best >= 0 && !lines[best][field]) lines[best][field] = entry.text
  }
}

const buildLines = (entries: LrcEntry[], useLxWords: boolean): LyricLine[] => {
  const lines: LyricLine[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry.text) continue
    // 下一条时间戳（包括空文本行）就是这一行最晚的结束时间
    let nextTime = Infinity
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].time > entry.time) {
        nextTime = entries[j].time
        break
      }
    }
    const timed = useLxWords ? parseLxWords(entry.text, entry.time) : null
    const text = timed ? timed.map(word => word.text).join('').trim() : entry.text
    if (!text) continue
    let end: number
    let words: LyricWord[]
    if (timed) {
      words = timed
      end = Math.max(entry.time + 1, ...timed.map(word => word.end))
    } else {
      end = Math.min(entry.time + MAX_LINE_DURATION, nextTime)
      if (end <= entry.time) end = entry.time + MAX_LINE_DURATION
      words = spreadWords(text, entry.time, end)
    }
    lines.push({ start: entry.time, end, text, translation: '', roma: '', words, timedWords: !!timed })
  }
  return lines
}

/** 由各平台返回的歌词文本生成 LyricDoc：有逐字（lxlyric）优先用逐字 */
export const buildLyricDoc = (source: LyricSourceText | null | undefined): LyricDoc => {
  const empty: LyricDoc = { lines: [], offset: 0, hasWords: false, hasTranslation: false, hasRoma: false, tags: {} }
  if (!source) return empty
  const base = parseLrc(source.lyric)
  let lines: LyricLine[] = []
  if (source.lxlyric) {
    lines = buildLines(parseLrc(source.lxlyric).entries, true)
    // 逐字解析失败过半时视为无效，退回普通歌词
    if (lines.filter(line => line.timedWords).length * 2 < lines.length) lines = []
  }
  if (!lines.length) lines = buildLines(base.entries, false)
  attachExtended(lines, source.tlyric, 'translation')
  attachExtended(lines, source.rlyric, 'roma')
  return {
    lines,
    offset: parseOffset(base.tags.offset),
    hasWords: lines.some(line => line.timedWords),
    hasTranslation: lines.some(line => !!line.translation),
    hasRoma: lines.some(line => !!line.roma),
    tags: base.tags,
  }
}

/** 文本里是否含有带时间戳的歌词行 */
export const hasTimedLyric = (lrc: string | null | undefined) => !!lrc && parseLrc(lrc).entries.some(entry => !!entry.text)
