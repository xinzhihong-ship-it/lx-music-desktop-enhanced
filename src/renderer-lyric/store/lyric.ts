import { markRaw } from '@common/utils/vueTools'

/** 主窗口发来的歌词原文（解析与显示见 core/lyric.ts） */
export const lyrics = markRaw<{
  lyric: string
  tlyric: string | null
  rlyric: string | null
  lxlyric: string | null
}>({
  lyric: '',
  tlyric: '',
  rlyric: '',
  lxlyric: '',
})
