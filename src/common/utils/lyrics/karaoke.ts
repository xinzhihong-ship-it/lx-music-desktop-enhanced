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
