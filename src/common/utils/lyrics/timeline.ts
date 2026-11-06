import type { LyricLine } from './types'

/** pos 时正在唱的行；第一行之前返回 -1 */
export const findLineIndex = (lines: LyricLine[], pos: number) => {
  let lo = 0
  let hi = lines.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start > pos) hi = mid
    else lo = mid + 1
  }
  return lo - 1
}

// 署名行的开头（作词、作曲……），冒号前的部分以这些词开头即视为署名
const CREDIT_PREFIXES = [
  '作词', '作曲', '编曲', '制作', '监制', '混音', '录音', '母带', '和声', '合声', '吉他', '贝斯', '鼓', '键盘', '弦乐',
  '出品', '发行', '统筹', '策划', '演唱', '原唱', '翻唱', '词', '曲', 'OP', 'SP', 'ISRC',
  '作詞', '編曲', '製作', '監製', '錄音',
  'lyrics', 'lyricist', 'music', 'composer', 'composed', 'arranger', 'arranged', 'producer', 'produced', 'written',
]
const MAX_CREDIT_HEAD = 12

/** 判断一行是不是署名（“作词：xxx”），署名不算演唱 */
export const isCreditLine = (text: string) => {
  const index = text.search(/[:：]/)
  if (index <= 0) return false
  const head = text.slice(0, index).trim()
  if (!head || [...head].length > MAX_CREDIT_HEAD) return false
  const lower = head.toLowerCase()
  return CREDIT_PREFIXES.some(prefix => {
    const p = prefix.toLowerCase()
    // 单字（词、曲、鼓）必须整段相等，避免“曲终人散：”之类误判
    return [...p].length == 1 ? lower == p : lower.startsWith(p)
  })
}

export interface QuietRange {
  from: number
  to: number
}

/** 无人声的区间（前奏、间奏、尾奏），至少 least 毫秒；duration 为歌曲时长，0 表示未知 */
export const findQuiets = (lines: LyricLine[], duration: number, least: number): QuietRange[] => {
  const quiets: QuietRange[] = []
  const add = (from: number, to: number) => {
    if (to - from >= least) quiets.push({ from, to })
  }
  let at = 0
  let sung = false
  for (const line of lines) {
    if (isCreditLine(line.text)) continue
    add(at, line.start)
    at = Math.max(at, line.end)
    sung = true
  }
  if (sung && duration > 0) add(at, duration)
  return quiets
}
