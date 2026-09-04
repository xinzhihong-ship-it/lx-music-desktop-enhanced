import { onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { musicInfo, playMusicInfo, isPlay, playQuality } from '@renderer/store/player/state'
import { setStop } from '@renderer/plugins/player'
import { getShouldPlayAfterLoad, playNext, setMusicUrl, setShouldPlayAfterLoad } from '@renderer/core/player'
import { setAllStatus } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getPlayErrorActions, getPlayErrorApiSourceCount, getPlayErrorRetryCount, isPlayErrorHandlingEnabled } from '@renderer/core/player/errorStrategy'
import { getLowerPlayQuality, getPlayQuality, QUALITY_RANK } from '@renderer/core/music/utils'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'
import { getNextApiSourceId } from '@common/utils/playErrorStrategy'
import { userApi } from '@renderer/store'
import { setUserApi } from '@renderer/core/apiSource'

export default () => {
  const t = useI18n()
  let retryNum = 0
  let actionIndex = 0
  let apiSourceAttempts = 0
  let triedApiSourceIds = new Set<string>()
  let recoverPromise: Promise<void> | null = null
  let recoveryGeneration = 0

  let loadingTimeout: NodeJS.Timeout | null = null
  let delayNextTimeout: NodeJS.Timeout | null = null
  const startLoadingTimeout = () => {
    // console.log('start load timeout')
    clearLoadingTimeout()
    loadingTimeout = setTimeout(() => {
      if (window.lx.isPlayedStop) {
        setAllStatus('')
        return
      }
      window.app_event.playerError()
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
  const isRecoveryCurrent = (generation: number) => generation == recoveryGeneration && !window.lx.isPlayedStop
  const addDelayNextTimeout = (generation: number) => {
    if (!isRecoveryCurrent(generation)) return
    clearDelayNextTimeout()
    delayNextTimeout = setTimeout(() => {
      delayNextTimeout = null
      if (!isRecoveryCurrent(generation)) return
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

  const playNextAfterFailure = (generation: number) => {
    if (!isRecoveryCurrent(generation)) return
    if (document.hidden) {
      console.warn('error skip to next')
      void playNext(true)
    } else {
      setAllStatus(t('player__error'))
      setTimeout(() => { addDelayNextTimeout(generation) })
    }
  }

  const recoverPlayback = async(allowRefresh: boolean, shouldResume: boolean, generation: number, errCode?: number) => {
    if (!isRecoveryCurrent(generation)) return
    const currentMusicInfo = playMusicInfo.musicInfo
    const actions = getPlayErrorActions()
    if (!currentMusicInfo || !actions.length) {
      setAllStatus(t('player__error_stopped'))
      return
    }

    const onlineMusicInfo = !('progress' in currentMusicInfo) && currentMusicInfo.source != 'local'
      ? currentMusicInfo
      : null

    // “直接下一曲”保持原行为；其他策略先按用户设置刷新当前链接。
    if (actions[0] != 'next' && allowRefresh && errCode !== 1 && retryNum < getPlayErrorRetryCount()) {
      retryNum++
      if (!isRecoveryCurrent(generation)) return
      if (shouldResume) setShouldPlayAfterLoad(true)
      setMusicUrl(currentMusicInfo, true)
      setAllStatus(t('player__refresh_url'))
      return
    }

    while (actionIndex < actions.length) {
      if (!isRecoveryCurrent(generation)) return
      switch (actions[actionIndex]) {
        case 'apiSource': {
          if (!onlineMusicInfo) {
            actionIndex++
            continue
          }
          triedApiSourceIds.add(appSetting['common.apiSource'])
          while (apiSourceAttempts < getPlayErrorApiSourceCount()) {
            const nextId = getNextApiSourceId(
              appSetting['common.apiSource'],
              triedApiSourceIds,
              userApi.list.map(api => api.id),
            )
            if (!nextId) break
            const api = userApi.list.find(api => api.id == nextId)
            triedApiSourceIds.add(nextId)
            apiSourceAttempts++
            if (!isRecoveryCurrent(generation)) return
            setAllStatus(t('player__switch_api_source', { name: api?.name ?? nextId }))
            let initialized = false
            try {
              if (!isRecoveryCurrent(generation)) return
              await setUserApi(nextId)
              if (!isRecoveryCurrent(generation)) return
              initialized = await window.lx.apiInitPromise[0]
            } catch (err) {
              console.warn('switch api source failed', err)
            }
            if (!isRecoveryCurrent(generation)) return
            if (!initialized) continue
            if (shouldResume) setShouldPlayAfterLoad(true)
            setMusicUrl(currentMusicInfo, true)
            return
          }
          actionIndex++
          continue
        }
        case 'platform':
          actionIndex++
          if (!onlineMusicInfo) continue
          if (!isRecoveryCurrent(generation)) return
          if (shouldResume) setShouldPlayAfterLoad(true)
          setMusicUrl(currentMusicInfo, true, { forceToggleSource: true })
          setAllStatus(t('toggle_source_try'))
          return
        case 'quality': {
          actionIndex++
          if (!onlineMusicInfo) continue
          const currentQuality = QUALITY_RANK.includes(playQuality.value as LX.Quality)
            ? playQuality.value as LX.Quality
            : getPlayQuality(appSetting['player.playQuality'], onlineMusicInfo)
          const lowerQuality = getLowerPlayQuality(currentQuality, onlineMusicInfo)
          if (!lowerQuality) continue
          if (!isRecoveryCurrent(generation)) return
          if (shouldResume) setShouldPlayAfterLoad(true)
          setMusicUrl(currentMusicInfo, true, { quality: lowerQuality })
          setAllStatus(t('player__lower_quality', { quality: lowerQuality }))
          return
        }
        case 'next':
          actionIndex = actions.length
          playNextAfterFailure(generation)
          return
      }
    }

    setAllStatus(t('player__error_stopped'))
  }

  const handleError = (errCode?: number) => {
    if (!musicInfo.id) return
    clearLoadingTimeout()
    if (window.lx.isPlayedStop || recoverPromise) return
    // 首次点击播放时，MPV 可能还没发出 playing；此时仍要保留用户的播放意图，
    // 否则首个 CDN 失败后切换备用地址会停在暂停状态，必须再次点击播放。
    const shouldResume = isPlay.value || getShouldPlayAfterLoad()
    const currentMusicId = musicInfo.id
    const generation = ++recoveryGeneration
    // 即使 renderer 已经把 mpv 标记为空，主进程仍可能正在播放旧 URL；
    // 必须先等 stop 命令完成，再开始刷新/换源，避免两条 load 命令交叉。
    const recovery = setStop().then(async() => {
      if (!isRecoveryCurrent(generation) || musicInfo.id != currentMusicId) return
      return recoverPlayback(true, shouldResume, generation, errCode)
    })
    recoverPromise = recovery
    void recovery.catch(err => { console.warn('recover playback failed', err) }).finally(() => {
      if (recoverPromise === recovery) recoverPromise = null
    })
  }

  const handleSetPlayInfo = () => {
    recoveryGeneration++
    retryNum = 0
    actionIndex = 0
    apiSourceAttempts = 0
    triedApiSourceIds = new Set([appSetting['common.apiSource']])
    recoverPromise = null
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
  window.app_event.on('stop', handleSetPlayInfo)

  onBeforeUnmount(() => {
    handleSetPlayInfo()
    window.app_event.off('playerLoadstart', handleLoadstart)
    window.app_event.off('playerLoadeddata', handleLoadeddata)
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerWaiting', handleWating)
    window.app_event.off('playerEmptied', handleEmpied)
    window.app_event.off('playerError', handleError)
    window.app_event.off('musicToggled', handleSetPlayInfo)
    window.app_event.off('stop', handleSetPlayInfo)
  })
}
