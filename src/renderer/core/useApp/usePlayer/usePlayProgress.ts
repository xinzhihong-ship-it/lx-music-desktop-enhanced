import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { formatPlayTime2, getRandom } from '@common/utils/common'
import { throttle } from '@common/utils'
import { savePlayInfo } from '@renderer/utils/ipc'
import { onTimeupdate, getCurrentTime, getDuration, setCurrentTime, setPlay, onVisibilityChange } from '@renderer/plugins/player'
import * as mpvPlayer from '@renderer/plugins/player/mpv'
import { clearPendingSeek } from '@renderer/plugins/player/mpv'
import { playProgress, setNowPlayTime, setMaxplayTime } from '@renderer/store/player/playProgress'
import { musicInfo, playMusicInfo, playInfo, isPlay } from '@renderer/store/player/state'
// import { getList } from '@renderer/store/utils'
import { appSetting } from '@renderer/store/setting'
import { playNext, setShouldPlayAfterSeek } from '@renderer/core/player'
import { updateListMusics } from '@renderer/store/list/action'

const delaySavePlayInfo = throttle(savePlayInfo, 2000)

export default () => {
  let restorePlayTime = 0
  const mediaBuffer: {
    timeout: NodeJS.Timeout | null
    playTime: number
  } = {
    timeout: null,
    playTime: 0,
  }

  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  const startBuffering = () => {
    console.log('start t')
    if (mediaBuffer.timeout) return
    mediaBuffer.timeout = setTimeout(() => {
      mediaBuffer.timeout = null
      if (window.lx.isPlayedStop) return
      const currentTime = getCurrentTime()

      mediaBuffer.playTime ||= currentTime
      let skipTime = currentTime + getRandom(3, 6)
      if (skipTime > playProgress.maxPlayTime) skipTime = (playProgress.maxPlayTime - currentTime) / 2
      if (skipTime - mediaBuffer.playTime < 1 || playProgress.maxPlayTime - skipTime < 1) {
        mediaBuffer.playTime = 0
        if (appSetting['player.autoSkipOnError']) {
          console.warn('buffering end')
          void playNext(true)
        }
        return
      }
      startBuffering()
      setCurrentTime(skipTime)
      console.log(mediaBuffer.playTime)
      console.log(currentTime)
    }, 3000)
  }
  const clearBufferTimeout = () => {
    console.log('clear t')
    if (!mediaBuffer.timeout) return
    clearTimeout(mediaBuffer.timeout)
    mediaBuffer.timeout = null
    mediaBuffer.playTime = 0
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!musicInfo.id) return
    // 记录拖动前的播放状态，用于内置引擎 seek 后主动恢复。
    const wasPlaying = isPlay.value
    if (maxTime != null) setMaxplayTime(maxTime)
    console.log('setProgress', time, maxTime)
    if (time > 0) restorePlayTime = time
    if (mediaBuffer.playTime) {
      clearBufferTimeout()
      mediaBuffer.playTime = time
      startBuffering()
    }
    setNowPlayTime(time)

    // 内置引擎拖动进度条前若正在播放，则标记 seek 后需要恢复播放，
    // 避免 audio seek 期间 isPlay 被临时置为 false 导致 canplay 时误暂停。
    if (appSetting['player.playEngine'] == 'electron' && wasPlaying) {
      setShouldPlayAfterSeek(true)
    }

    setCurrentTime(time)

    // 内置引擎在拖动进度条后，某些情况下 audio 会被浏览器停在暂停状态，
    // 如果拖动前正在播放，则主动调用 play() 恢复。
    if (appSetting['player.playEngine'] == 'electron' && wasPlaying) {
      setPlay()
    }
  }

  const handlePause = () => {
    clearBufferTimeout()
    // 暂停时清空残留的恢复位置，避免恢复播放时被旧 seek 目标拉回去。
    restorePlayTime = 0
    mediaBuffer.playTime = 0
  }

  const handleStop = () => {
    setNowPlayTime(0)
    setMaxplayTime(0)
  }

  const handleError = () => {
    restorePlayTime ||= getCurrentTime() // 记录出错的播放时间
    console.log('handleError')
  }

  const handleLoadeddata = () => {
    setMaxplayTime(getDuration())

    // 启动恢复时，在文件加载完成后立即 seek 到上次保存的位置，
    // 避免 MPV 先开始播放再 seek 造成的短暂“从头播放”。
    if (restorePlayTime > 0) {
      setCurrentTime(restorePlayTime)
      restorePlayTime = 0
    }

    if (playMusicInfo.musicInfo && 'source' in playMusicInfo.musicInfo && !playMusicInfo.musicInfo.interval) {
      // console.log(formatPlayTime2(playProgress.maxPlayTime))

      if (playMusicInfo.listId) {
        void updateListMusics([{
          id: playMusicInfo.listId,
          musicInfo: {
            ...playMusicInfo.musicInfo,
            interval: formatPlayTime2(playProgress.maxPlayTime),
          },
        }])
      }
    }
  }

  const handlePlaying = () => {
    console.log('handlePlaying', mediaBuffer.playTime, restorePlayTime)
    clearBufferTimeout()
    if (mediaBuffer.playTime) {
      let playTime = mediaBuffer.playTime
      mediaBuffer.playTime = 0
      setCurrentTime(playTime)
    } else if (restorePlayTime) {
      setCurrentTime(restorePlayTime)
      restorePlayTime = 0
    }
  }
  const handleWating = () => {
    startBuffering()
  }

  const handleEmpied = () => {
    mediaBuffer.playTime = 0
    clearBufferTimeout()
  }

  const handleSetPlayInfo = () => {
    // 切歌时新文件应从头播放，不应继承上一首歌的 restorePlayTime，
    // 否则 MPV 加载后会 seek 到上一首歌的位置，出现“回退/跳跃几秒”。
    restorePlayTime = 0
    clearPendingSeek()
    handlePause()
    if (!playMusicInfo.isTempPlay && playMusicInfo.listId) {
      delaySavePlayInfo({
        time: playProgress.nowPlayTime,
        maxTime: playProgress.maxPlayTime,
        listId: playMusicInfo.listId,
        index: playInfo.playIndex,
      })
    }
  }

  watch(() => playProgress.nowPlayTime, (newValue, oldValue) => {
    if (Math.abs(newValue - oldValue) > 2) window.app_event.activePlayProgressTransition()
    if (appSetting['player.isSavePlayTime'] && !playMusicInfo.isTempPlay) {
      delaySavePlayInfo({
        time: newValue,
        maxTime: playProgress.maxPlayTime,
        listId: playMusicInfo.listId as string,
        index: playInfo.playIndex,
      })
    }
  })
  watch(() => playProgress.maxPlayTime, maxPlayTime => {
    if (!playMusicInfo.isTempPlay) {
      delaySavePlayInfo({
        time: playProgress.nowPlayTime,
        maxTime: maxPlayTime,
        listId: playMusicInfo.listId as string,
        index: playInfo.playIndex,
      })
    }
  })

  // window.app_event.on('play', handlePlay)
  window.app_event.on('pause', handlePause)
  window.app_event.on('stop', handleStop)
  window.app_event.on('error', handleError)
  window.app_event.on('setProgress', setProgress)
  // window.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  window.app_event.on('playerLoadeddata', handleLoadeddata)
  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerWaiting', handleWating)
  window.app_event.on('playerEmptied', handleEmpied)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  const rOnTimeupdate = onTimeupdate(() => {
    setNowPlayTime(getCurrentTime())
  })
  const rOnMpvDuration = mpvPlayer.onDuration((dur: number) => {
    setMaxplayTime(dur)
  })

  let currentPlayTime = 0
  const rVisibilityChange = onVisibilityChange(() => {
    if (document.hidden) {
      currentPlayTime = playProgress.nowPlayTime
    } else {
      if (Math.abs(playProgress.nowPlayTime - currentPlayTime) > 2) {
        window.app_event.activePlayProgressTransition()
      }
    }
  })

  onBeforeUnmount(() => {
    rOnTimeupdate()
    rOnMpvDuration()
    rVisibilityChange()
    // window.app_event.off('play', handlePlay)
    window.app_event.off('pause', handlePause)
    window.app_event.off('stop', handleStop)
    window.app_event.off('error', handleError)
    window.app_event.off('setProgress', setProgress)
    // window.app_event.off(eventPlayerNames.restorePlay, handleRestorePlay)
    window.app_event.off('playerLoadeddata', handleLoadeddata)
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerWaiting', handleWating)
    window.app_event.off('playerEmptied', handleEmpied)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
