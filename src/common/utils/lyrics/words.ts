import type { LyricWord } from './types'

const CJK_RXP = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const SPACE_RXP = /\s/u

export const isCjkChar = (char: string) => CJK_RXP.test(char)

/** 唱一行通常占这一行时间的大部分，剩下的留给换气 */
const SUNG_RATIO = 0.85

const visibleLength = (text: string) => [...text.trim()].length

/**
 * 把一行文本拆成“字词”：中日韩每个字符单独一个，其他文字按空格切词，
 * 词后的空格并入该词（拼回去与原文一致）。
 */
export const splitWords = (text: string): string[] => {
  const words: string[] = []
  let current = ''
  const flush = () => {
    if (current) {
      words.push(current)
      current = ''
    }
  }
  for (const char of text) {
    if (SPACE_RXP.test(char)) {
      if (current) {
        current += ' '
        flush()
      }
    } else if (isCjkChar(char)) {
      flush()
      words.push(char)
    } else {
      current += char
    }
  }
  flush()
  return words
}

/**
 * 没有逐字时间的行：按可见字符数把 [start, end) 的 85% 分给各个字词。
 */
export const spreadWords = (text: string, start: number, end: number): LyricWord[] => {
  const parts = splitWords(text)
  if (!parts.length) return []
  const total = Math.max(1, parts.reduce((sum, part) => sum + visibleLength(part), 0))
  const span = Math.max(0, end - start) * SUNG_RATIO
  const words: LyricWord[] = []
  let at = start
  for (const part of parts) {
    const duration = span * visibleLength(part) / total
    words.push({ text: part, start: Math.round(at), end: Math.round(at + duration) })
    at += duration
  }
  return words
}

/** 某个字词在 pos 时的演唱进度 0~1 */
export const wordProgress = (word: LyricWord, pos: number) => {
  if (pos <= word.start) return 0
  const duration = word.end - word.start
  if (duration <= 0 || pos >= word.end) return 1
  return (pos - word.start) / duration
}
