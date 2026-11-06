// 整行的 [offset:] 标签（含行尾换行）
const OFFSET_TAG_RXP = /^[ \t]*\[offset:[^\]]*\][ \t]*(?:\r?\n|$)/gim

/**
 * 设置 LRC 文本的 [offset:] 标签（毫秒，生效位置 = 播放位置 + offset）：去掉原有的 offset 标签，
 * offset 非 0 时在开头写入新标签。空文本原样返回。
 */
export const setLrcOffsetTag = (lrc: string | null | undefined, offset: number): string => {
  if (!lrc) return lrc ?? ''
  const body = lrc.replace(OFFSET_TAG_RXP, '')
  const value = Math.round(offset)
  return value ? `[offset:${value}]\n${body}` : body
}
