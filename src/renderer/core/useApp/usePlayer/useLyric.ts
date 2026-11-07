import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { debounce } from '@common/utils/common'
// import { setDesktopLyricInfo, onGetDesktopLyricInfo } from '@renderer/utils/ipc'
// import { musicInfo } from '@renderer/store/player/state'
import {
  pause,
  play,
  setLyric,
  stop,
  init,
  sendInfo,
  setPlaybackRate,
  sendDesktopLyricInfo,
} from '@renderer/core/lyric'
import { appSetting } from '@renderer/store/setting'
import { isPlay, musicInfo } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'

const handleApplyPlaybackRate = debounce(setPlaybackRate, 300)

export default () => {
  init()

  const setPlayInfo = () => {
    stop()
    sendInfo()
  }

  watch(() => appSetting['player.isShowLyricTranslation'], setLyric)
  watch(() => appSetting['player.isShowLyricRoma'], setLyric)
  watch(() => appSetting['player.isSwapLyricTranslationAndRoma'], setLyric)

  window.app_event.on('play', play)
  window.app_event.on('pause', pause)
  window.app_event.on('stop', stop)
  window.app_event.on('error', pause)
  window.app_event.on('musicToggled', setPlayInfo)
  window.app_event.on('lyricUpdated', setLyric)
  window.app_event.on('setPlaybackRate', handleApplyPlaybackRate)
  const handleSeeked = () => {
    // 暂停时只跳转到新位置，不启动滚动；播放时才继续滚动。
    if (isPlay.value) {
      play()
    } else {
      play()
      pause()
    }
  }
  window.app_event.on('playerSeeked', handleSeeked)

  // 歌词岛需要封面与时长（桌面歌词忽略这两个消息）
  const sendPic = () => { sendDesktopLyricInfo({ action: 'set_pic', data: musicInfo.pic ?? null }) }
  window.app_event.on('picUpdated', sendPic)
  watch(() => playProgress.maxPlayTime, duration => { sendDesktopLyricInfo({ action: 'set_duration', data: duration }) })

  onBeforeUnmount(() => {
    window.app_event.off('play', play)
    window.app_event.off('pause', pause)
    window.app_event.off('stop', stop)
    window.app_event.off('error', pause)
    window.app_event.off('musicToggled', setPlayInfo)
    window.app_event.off('lyricUpdated', setLyric)
    window.app_event.off('setPlaybackRate', handleApplyPlaybackRate)
    window.app_event.off('playerSeeked', handleSeeked)
    window.app_event.off('picUpdated', sendPic)
  })
}
