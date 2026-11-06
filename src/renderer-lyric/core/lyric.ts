// 桌面歌词的数据与时间：主窗口发来歌词原文与播放 / 暂停 / 偏移 / 倍速事件，
// 这里解析成统一的 LyricDoc，并按收到的播放时间锚定一个时钟，由视图按帧读取位置。
// （对外函数名保持不变，主窗口通道 mainWindowChannel 无需改动）
import { computed, ref, shallowRef } from '@common/utils/vueTools'
import { buildLyricDoc, type LyricDoc } from '@common/utils/lyrics'
import { lyrics } from '@lyric/store/lyric'
import { isPlay, musicInfo, setting } from '@lyric/store/state'

interface LyricSource {
  lyric: string
  tlyric: string | null
  rlyric: string | null
  lxlyric: string | null
}

const source = shallowRef<LyricSource>({ lyric: '', tlyric: '', rlyric: '', lxlyric: '' })
/** 菜单里临时调整的偏移（毫秒），叠加在歌词 [offset:] 标签之上 */
const tempOffset = ref(0)

export const lyricDoc = computed<LyricDoc>(() => buildLyricDoc({
  lyric: source.value.lyric,
  lxlyric: setting['player.isPlayLxlrc'] ? source.value.lxlyric : '',
  tlyric: setting['player.isShowLyricTranslation'] ? source.value.tlyric : '',
  rlyric: setting['player.isShowLyricRoma'] ? source.value.rlyric : '',
}))

export const isRomaFirst = computed(() => setting['player.isSwapLyricTranslationAndRoma'])

// 播放时钟：主窗口在播放、跳转、倍速变化、卡住恢复时发来当前时间
const clock = { time: 0, at: 0, playing: false, rate: 1 }
/** 时钟每次被重新锚定时自增，视图据此立即刷新 */
export const clockRevision = ref(0)

const anchor = (time: number, playing: boolean) => {
  clock.time = time
  clock.at = performance.now()
  clock.playing = playing
  clockRevision.value++
}

/** 当前歌词位置（毫秒）：生效位置 = 播放位置 + 歌词偏移 + 临时偏移 */
export const readLyricPosition = (now = performance.now()) => {
  const media = clock.playing ? clock.time + Math.max(0, now - clock.at) * clock.rate : clock.time
  return media + lyricDoc.value.offset + tempOffset.value
}

/** 当前播放位置（毫秒，不含歌词偏移），进度条用 */
export const readMediaTime = (now = performance.now()) => clock.playing ? clock.time + Math.max(0, now - clock.at) * clock.rate : clock.time

export const init = () => {
  clock.rate = setting['player.playbackRate'] || 1
}

export const setLyricOffset = (offset: number) => {
  tempOffset.value = offset
}

export const setPlaybackRate = (rate: number) => {
  // 先按旧倍速把时钟推进到现在，再换倍速，位置保持连续
  if (clock.playing) anchor(readLyricPosition() - lyricDoc.value.offset - tempOffset.value, true)
  clock.rate = rate > 0 ? rate : 1
}

export const setLyric = () => {
  if (!musicInfo.id) return
  source.value = { lyric: lyrics.lyric ?? '', tlyric: lyrics.tlyric, rlyric: lyrics.rlyric, lxlyric: lyrics.lxlyric }
  tempOffset.value = 0
}

export const play = (time: number) => {
  anchor(time, true)
}

export const pause = () => {
  if (clock.playing) anchor(readLyricPosition() - lyricDoc.value.offset - tempOffset.value, false)
}

export const stop = () => {
  source.value = { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
  tempOffset.value = 0
  anchor(0, false)
}

/** 竖排由视图按设置切换，这里无需处理（保留函数供旧调用方使用） */
export const setVertical = (_isVertical: boolean) => {}

export { isPlay }
