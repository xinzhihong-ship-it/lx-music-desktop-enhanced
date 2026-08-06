import { onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { musicInfo, playMusicInfo, isPlay, playQuality } from '@renderer/store/player/state'
import { setStop } from '@renderer/plugins/player'
import { getShouldPlayAfterLoad, playNext, setMusicUrl, setShouldPlayAfterLoad } from '@renderer/core/player'
import { setAllStatus } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { isPlayErrorHandlingEnabled, shouldLowerQualityOnError, shouldSkipOnError, shouldToggleSourceOnError } from '@renderer/core/player/errorStrategy'
import { getLowerPlayQuality, getPlayQuality, QUALITY_RANK } from '@renderer/core/music/utils'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'

export default () => {
  const t = useI18n()
  let retryNum = 0
  let prevTimeoutId: string | null = null
  let sourceAttempted = false
  let qualityAttempted = false

  let loadingTimeout: NodeJS.Timeout | null = null
  let delayNextTimeout: NodeJS.Timeout | null = null
  const startLoadingTimeout = () => {
    // console.log('start load timeout')
    clearLoadingTimeout()
    loadingTimeout = setTimeout(() => {
      if (window.lx.isPlayedStop) {
        prevTimeoutId = null
        setAllStatus('')
        return
      }

      // 如果加载超时，则尝试刷新URL
      if (prevTimeoutId == musicInfo.id) {
        prevTimeoutId = null
        recoverPlayback(false, isPlay.value)
      } else {
        prevTimeoutId = musicInfo.id
        if (playMusicInfo.musicInfo) {
          // 只有当前确实在播放才保持加载后自动播放；
          // 启动恢复或用户未主动播放时保持原有暂停状态。
          if (isPlay.value) setShouldPlayAfterLoad(true)
          setMusicUrl(playMusicInfo.musicInfo, true)
        }
      }
    }, 25000)
  }
  const clearLoadingTimeout = () => {
    if (!loadingTimeout) return
    // console.log('clear load timeout')
    clearTimeout(loadingTimeout)
    loadingTimeout = null
  }

  const clearDelayNextTimeout = () => {
    // console.log(this.delayNextTimeout)
    if (!delayNextTimeout) return
    clearTimeout(delayNextTimeout)
    delayNextTimeout = null
  }
  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    delayNextTimeout = setTimeout(() => {
      if (window.lx.isPlayedStop) {
        setAllStatus('')
        return
      }
      void playNext(true)
    }, 5000)
  }

  const handleLoadstart = () => {
    if (window.lx.isPlayedStop) return
    if (appSetting['player.playEngine'] === 'audirvana' && !isBiliVideoActive()) return
    if (isPlayErrorHandlingEnabled()) startLoadingTimeout()
    setAllStatus(t('player__loading'))
  }

  const handleLoadeddata = () => {
    if (appSetting['player.playEngine'] === 'audirvana' && !isBiliVideoActive()) return
    // 文件已加载完成，清除“加载中”状态；
    // 若随后进入播放，handlePlaying 会再次清空；若保持暂停，也不应继续显示加载中。
    setAllStatus('')
  }

  const handlePlaying = () => {
    setAllStatus('')
    clearLoadingTimeout()
  }

  const handleEmpied = () => {
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  const handleWating = () => {
    setAllStatus(t('player__buffering'))
  }

  const finishPlaybackFailure = () => {
    if (shouldSkipOnError()) {
      if (document.hidden) {
        console.warn('error skip to next')
        void playNext(true)
      } else {
        setAllStatus(t('player__error'))
        setTimeout(addDelayNextTimeout)
      }
    } else {
      setAllStatus(t('player__error_stopped'))
    }
  }

  const recoverPlayback = (allowRefresh: boolean, shouldResume: boolean, errCode?: number) => {
    const currentMusicInfo = playMusicInfo.musicInfo
    if (!currentMusicInfo) {
      finishPlaybackFailure()
      return
    }

    // A direct-next strategy should not spend time retrying the same URL.
    if (appSetting['player.playErrorStrategy'] == 'next') {
      finishPlaybackFailure()
      return
    }

    const onlineMusicInfo = !('progress' in currentMusicInfo) && currentMusicInfo.source != 'local'
      ? currentMusicInfo
      : null

    if (allowRefresh && errCode !== 1 && retryNum < 1) {
      retryNum++
      if (shouldResume) setShouldPlayAfterLoad(true)
      setMusicUrl(currentMusicInfo, true)
      setAllStatus(t('player__refresh_url'))
      return
    }

    if (!sourceAttempted && shouldToggleSourceOnError() && onlineMusicInfo) {
      sourceAttempted = true
      if (shouldResume) setShouldPlayAfterLoad(true)
      setMusicUrl(currentMusicInfo, true, { forceToggleSource: true })
      setAllStatus(t('toggle_source_try'))
      return
    }

    if (!qualityAttempted && shouldLowerQualityOnError() && onlineMusicInfo) {
      qualityAttempted = true
      const currentQuality = QUALITY_RANK.includes(playQuality.value as LX.Quality)
        ? playQuality.value as LX.Quality
        : getPlayQuality(appSetting['player.playQuality'], onlineMusicInfo)
      const lowerQuality = getLowerPlayQuality(currentQuality, onlineMusicInfo)
      if (lowerQuality) {
        if (shouldResume) setShouldPlayAfterLoad(true)
        setMusicUrl(currentMusicInfo, true, { quality: lowerQuality, hasLoweredQuality: true })
        setAllStatus(t('player__lower_quality', { quality: lowerQuality }))
        return
      }
    }

    finishPlaybackFailure()
  }

  const handleError = (errCode?: number) => {
    if (!musicInfo.id) return
    clearLoadingTimeout()
    if (window.lx.isPlayedStop) return
    // 首次点击播放时，MPV 可能还没发出 playing；此时仍要保留用户的播放意图，
    // 否则首个 CDN 失败后切换备用地址会停在暂停状态，必须再次点击播放。
    const shouldResume = isPlay.value || getShouldPlayAfterLoad()
    const recover = () => {
      if (!window.lx.isPlayedStop) recoverPlayback(true, shouldResume, errCode)
    }
    // 即使 renderer 已经把 mpv 标记为空，主进程仍可能正在播放旧 URL；
    // 必须先等 stop 命令完成，再开始刷新/换源，避免两条 load 命令交叉。
    void setStop().then(recover, recover)
  }

  const handleSetPlayInfo = () => {
    retryNum = 0
    prevTimeoutId = null
    sourceAttempted = false
    qualityAttempted = false
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  window.app_event.on('playerLoadstart', handleLoadstart)
  window.app_event.on('playerLoadeddata', handleLoadeddata)
  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerWaiting', handleWating)
  window.app_event.on('playerEmptied', handleEmpied)
  window.app_event.on('playerError', handleError)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  onBeforeUnmount(() => {
    window.app_event.off('playerLoadstart', handleLoadstart)
    window.app_event.off('playerLoadeddata', handleLoadeddata)
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerWaiting', handleWating)
    window.app_event.off('playerEmptied', handleEmpied)
    window.app_event.off('playerError', handleError)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
