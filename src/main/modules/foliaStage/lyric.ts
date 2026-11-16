// 把落雪的四份歌词（原文 / 翻译 / 罗马音 / 逐字）转成 Folia 认识的洛雪歌词容器 `[awlrc:lrc:B64,tlrc:B64,rlrc:B64,awlrc:B64]`
// （Folia 的 src/utils/lyrics/awlrcContainer.ts 专门解析它，原文、翻译、罗马音、逐字四轨都取）。
//
// 不把原始文本原样转发：先用本项目的歌词引擎解析成 LyricDoc（与播放详情页、桌面歌词同一份结果，
// 含 [offset:] 偏移和逐字解析失败时的回退），再按毫秒重新写出，Folia 显示的就是落雪显示的：
//   - 时间戳一律写成三位毫秒 [mm:ss.mmm]。Folia 把容器里的小数部分当毫秒数读（[02:43.97] 是 43 秒 97 毫秒），
//     平台原文里两位的小数会被读错；三位时两种读法一致。
//   - 偏移直接折进时间戳（生效位置 = 播放位置 + offset，所以写出的时间 = 歌词时间 - offset）。
//   - 翻译、罗马音用所属原文行的行首时间，Folia 按时间戳精确对齐，不会错位到相邻行。
import { buildLyricDoc } from '@common/utils/lyrics'
import type { LyricDoc, LyricLine, LyricSourceText } from '@common/utils/lyrics'

const pad = (value: number, length: number) => String(value).padStart(length, '0')

/** 毫秒 → `[mm:ss.mmm]` */
export const formatStamp = (ms: number) => {
  const time = Math.max(0, Math.round(ms))
  return `[${pad(Math.floor(time / 60000), 2)}:${pad(Math.floor(time % 60000 / 1000), 2)}.${pad(time % 1000, 3)}]`
}

// 逐字标记 `<偏移,时长>` 以 `<` 起头，行内文字里的 `<` 会截断它
const cleanText = (text: string) => text.replace(/[\r\n]+/g, ' ').replace(/</g, '‹')

const buildWordLine = (line: LyricLine, start: number, offset: number) => {
  const words = line.words.length ? line.words : [{ text: line.text, start: line.start, end: line.end }]
  let body = ''
  for (const word of words) {
    if (!word.text) continue
    const wordStart = Math.max(0, Math.round(word.start - offset - start))
    const duration = Math.max(1, Math.round(word.end - word.start))
    body += `<${wordStart},${duration}>${cleanText(word.text)}`
  }
  return body ? formatStamp(start) + body : ''
}

const encode = (text: string) => Buffer.from(text, 'utf-8').toString('base64')

/** LyricDoc → 歌词容器；没有可显示的行时返回 null */
export const buildAwlrcContainerFromDoc = (doc: LyricDoc): string | null => {
  const lrc: string[] = []
  const tlrc: string[] = []
  const rlrc: string[] = []
  const awlrc: string[] = []
  for (const line of doc.lines) {
    const text = cleanText(line.text).trim()
    if (!text) continue
    const start = Math.max(0, line.start - doc.offset)
    const stamp = formatStamp(start)
    lrc.push(stamp + text)
    if (line.translation.trim()) tlrc.push(stamp + cleanText(line.translation).trim())
    if (line.roma.trim()) rlrc.push(stamp + cleanText(line.roma).trim())
    if (doc.hasWords) {
      const wordLine = buildWordLine(line, start, doc.offset)
      if (wordLine) awlrc.push(wordLine)
    }
  }
  if (!lrc.length) return null

  const tracks = [`lrc:${encode(lrc.join('\n'))}`]
  if (tlrc.length) tracks.push(`tlrc:${encode(tlrc.join('\n'))}`)
  if (rlrc.length) tracks.push(`rlrc:${encode(rlrc.join('\n'))}`)
  if (awlrc.length) tracks.push(`awlrc:${encode(awlrc.join('\n'))}`)
  return `[awlrc:${tracks.join(',')}]`
}

/** 落雪播放状态里的四份歌词 → 歌词容器；没有歌词时返回 null */
export const buildFoliaLyricContent = (texts: LyricSourceText | null | undefined): string | null => {
  if (!texts?.lyric && !texts?.lxlyric) return null
  return buildAwlrcContainerFromDoc(buildLyricDoc(texts))
}
