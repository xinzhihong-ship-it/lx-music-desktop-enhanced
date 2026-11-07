import { reactive } from '@common/utils/vueTools'

/** 主窗口当前歌词行（由 core/lyric 的行跟踪更新；歌词内容见 core/lyrics/engine 的 lyricDoc） */
export const lyric = reactive<{
  text: string
  line: number
}>({
  text: '',
  line: 0,
})

export const setText = (text: string, line: number) => {
  lyric.text = text
  lyric.line = line
}
