// 卡拉 OK 式（桌面歌词 / 顶部歌词岛）每一帧要显示什么：
//   主行：当前行，逐字填充（没有真实逐字时间的行整行点亮，不做按字数估算的假填充）；
//         间隔很长时提前显示下一行（未填充），开头之前为空（由视图显示歌名）
//   副行：当前主行的翻译 / 罗马音；没有时显示下一行预告
import type { LyricDoc, LyricLine } from './types'
import { findLineIndex } from './timeline'
import { wordProgress } from './words'

export interface KaraokeWord {
  text: string
  /** 0~1 */
  progress: number
}

export interface KaraokeFrame {
  /** 主行的行号；-1 表示还没开始（或没有歌词） */
  index: number
  words: KaraokeWord[]
  /** 主行是否已唱完（整行点亮） */
  done: boolean
  /** 副行文本及类型 */
  secondary: string
  secondaryKind: 'extended' | 'next' | 'none'
}

/** 间隔超过这么久（毫秒）且上一行已唱完 1 秒，主行提前切到下一行 */
const LONG_GAP = 4000

const extendedText = (line: LyricLine, romaFirst: boolean) => {
  const list = [line.translation, line.roma].filter(Boolean)
  if (romaFirst) list.reverse()
  return list.join(' / ')
}

export const karaokeFrame = (doc: LyricDoc, pos: number, romaFirst = false): KaraokeFrame => {
  const lines = doc.lines
  const empty: KaraokeFrame = { index: -1, words: [], done: false, secondary: '', secondaryKind: 'none' }
  if (!lines.length) return empty
  let index = findLineIndex(lines, pos)
  let upcoming = false
  if (index < 0) {
    // 开头之前：主行留空，副行预告第一行
    return { ...empty, secondary: lines[0].text, secondaryKind: 'next' }
  }
  const current = lines[index]
  const next = lines[index + 1]
  if (next && pos > current.end + 1000 && next.start - current.end > LONG_GAP) {
    index++
    upcoming = true
  }
  const line = lines[index]
  const words: KaraokeWord[] = line.timedWords
    ? line.words.map(word => ({ text: word.text, progress: upcoming ? 0 : wordProgress(word, pos) }))
    : [{ text: line.text, progress: upcoming ? 0 : 1 }]
  const done = !upcoming && words.every(word => word.progress >= 1)
  const extended = extendedText(line, romaFirst)
  if (extended) return { index, words, done, secondary: extended, secondaryKind: 'extended' }
  const following = lines[index + 1]
  return following
    ? { index, words, done, secondary: following.text, secondaryKind: 'next' }
    : { index, words, done, secondary: '', secondaryKind: 'none' }
}

export interface DoubleRow {
  /** 这一行歌词的行号 */
  index: number
  words: KaraokeWord[]
  /** 正在唱（或刚唱完、下一句还没开始）的那一行 */
  active: boolean
}

/**
 * 双行交替（酷狗 / 网易云桌面歌词式）：第 1、3、5… 句固定在上排，第 2、4、6… 句固定在下排。
 * 当前句高亮并逐字填充，另一排预告下一句；唱到下一句时它就在原位亮起，不会跳到上排，
 * 唱完的那一排再换成下下句。返回 [上排, 下排]，没有内容的一排为 null。
 */
export const doubleLineFrame = (doc: LyricDoc, pos: number): [DoubleRow | null, DoubleRow | null] => {
  const lines = doc.lines
  const plain = (index: number): DoubleRow | null => {
    const line = lines[index]
    return line ? { index, words: [{ text: line.text, progress: 0 }], active: false } : null
  }
  if (!lines.length) return [null, null]
  const index = findLineIndex(lines, pos)
  // 开头之前：两排分别预告第一、二句
  if (index < 0) return [plain(0), plain(1)]
  const line = lines[index]
  const current: DoubleRow = {
    index,
    words: line.timedWords
      ? line.words.map(word => ({ text: word.text, progress: wordProgress(word, pos) }))
      : [{ text: line.text, progress: 1 }],
    active: true,
  }
  const next = plain(index + 1)
  return index % 2 == 0 ? [current, next] : [next, current]
}
