// 新歌词显示的数据与时间来源：当前歌曲的 LyricDoc，以及平滑的歌词位置。
// 各视图（滚动歌词、舞台、背景之外的组件）自己决定刷新节奏，需要时调用 readLyricPosition()。
import { computed, watch } from '@common/utils/vueTools'
import { buildLyricDoc, createMediaClock, type LyricDoc } from '@common/utils/lyrics'
import { isPlay, musicInfo } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import { getCurrentTime } from '@renderer/core/lyric'

/** 当前歌曲的歌词（按设置决定是否使用逐字 / 翻译 / 罗马音） */
export const lyricDoc = computed<LyricDoc>(() => buildLyricDoc({
  lyric: musicInfo.lrc ?? '',
  // 有逐字时间就用：新显示没有旧播放器的性能负担，不再受“逐字歌词”开关（macOS 默认关闭）限制
  lxlyric: musicInfo.lxlrc,
  tlyric: appSetting['player.isShowLyricTranslation'] ? musicInfo.tlrc : '',
  rlyric: appSetting['player.isShowLyricRoma'] ? musicInfo.rlrc : '',
}))

/** 翻译与罗马音的显示顺序（true：罗马音在前） */
export const isRomaFirst = computed(() => appSetting['player.isSwapLyricTranslationAndRoma'])

const clock = createMediaClock()

/** 歌词位置（毫秒，已含歌词偏移）：生效位置 = 播放位置 + offset */
export const readLyricPosition = (now = performance.now()) => {
  clock.sample(getCurrentTime(), now, isPlay.value, appSetting['player.playbackRate'])
  return clock.position(now) + lyricDoc.value.offset
}

// 换歌时清掉时钟的单调性记忆，新歌从 0 开始
watch(() => musicInfo.id, () => {
  clock.reset(0, performance.now())
})

/** 跳到某一行（秒级进度，与进度条一致）；暂停中则开始播放 */
export const seekToLyricTime = (lyricTime: number) => {
  const mediaTime = Math.max(0, lyricTime - lyricDoc.value.offset)
  clock.reset(mediaTime, performance.now())
  window.app_event.setProgress(mediaTime / 1000)
}
