import { onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { musicInfo, playMusicInfo, playQuality } from '@renderer/store/player/state'
import { setStop } from '@renderer/plugins/player'
import { playNext, setMusicUrl, setShouldPlayAfterLoad } from '@renderer/core/player'
import { setAllStatus } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getPlayErrorActions, getPlayErrorApiSourceCount, getPlayErrorRetryCount, isPlayErrorHandlingEnabled } from '@renderer/core/player/errorStrategy'
import { getExactPlayQuality, getOtherSource } from '@renderer/core/music/utils'
import { loadDetailedQuality } from '@renderer/core/music/online'
import { createPlaybackRecoveryPlan, getRecoveryApiIds, type RecoveryCombination } from '@common/utils/playbackRecovery'
import { getCurrentPlaybackAttempt, playbackAttemptKey } from '@renderer/core/player/playbackAttempt'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'
import { userApi } from '@renderer/store'
import { setUserApi } from '@renderer/core/apiSource'
import { getPlaybackIntent, getPlaybackIntentRevision, onPlaybackIntentChange } from '@renderer/core/player/playbackIntent'

export default () => {
  const t = useI18n()
  let retryNum = 0
  let recoveryPlan: AsyncGenerator<RecoveryCombination<LX.Music.MusicInfoOnline>> | null = null
  let failedCombinations = new Set<string>()
  let failedApis = new Set<string>()
  let pendingError = false
  let recoveryFinished = false
  let recoveringRequestId: number | undefined
  let planActions: ReturnType<typeof getPlayErrorActions> = []
  let recoverPromise: Promise<void> | null = null
  let recoveryGeneration = 0
  let recoveryIntentRevision = 0
  const cancelRecoveryWaits = new Set<() => void>()
  const waitForRecovery = async<T>(task: () => Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout
    let cancel: () => void
    return new Promise<T>((resolve, reject) => {
      cancel = () => { reject(new Error('playback recovery cancelled')) }
      cancelRecoveryWaits.add(cancel)
      timer = setTimeout(() => { reject(new Error('playback recovery timeout')) }, 25000)
      Promise.resolve().then(task).then(resolve, reject)
    }).finally(() => {
      clearTimeout(timer)
      cancelRecoveryWaits.delete(cancel)
    })
  }

  let loadingTimeout: NodeJS.Timeout | null = null
  let delayNextTimeout: NodeJS.Timeout | null = null
  const startLoadingTimeout = () => {
    // console.log('start load timeout')
    clearLoadingTimeout()
    loadingTimeout = setTimeout(() => {
      loadingTimeout = null
      if (window.lx.isPlayedStop || !getPlaybackIntent()) {
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
  const isRecoveryCurrent = (generation: number) => generation == recoveryGeneration &&
    recoveryIntentRevision == getPlaybackIntentRevision() && getPlaybackIntent() && !window.lx.isPlayedStop
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
      void playNext(true, () => isRecoveryCurrent(generation))
    }, 5000)
  }

  const handleLoadstart = () => {
    if (window.lx.isPlayedStop) return
    if (appSetting['player.playEngine'] === 'audirvana' && !isBiliVideoActive()) return
    if (getPlaybackIntent() && isPlayErrorHandlingEnabled()) startLoadingTimeout()
    setAllStatus(t('player__loading'))
  }

  const handleLoadeddata = () => {
    clearLoadingTimeout()
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
      void playNext(true, () => isRecoveryCurrent(generation))
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

    if (actions[0] == 'next') {
      recoveryFinished = true
      playNextAfterFailure(generation)
      return
    }
    const attempt = getCurrentPlaybackAttempt()
    const currentAttempt = attempt?.ownerId == currentMusicInfo.id ? attempt : null
    // Retry the actual failed platform/quality, not the original playlist item.
    if (allowRefresh && errCode !== 1 && retryNum < getPlayErrorRetryCount()) {
      retryNum++
      if (!isRecoveryCurrent(generation)) return
      if (shouldResume) setShouldPlayAfterLoad(true)
      setMusicUrl(currentMusicInfo, true, currentAttempt ? { sourceMusicInfo: currentAttempt.musicInfo, quality: currentAttempt.quality } : {})
      setAllStatus(t('player__refresh_url'))
      return
    }

    if (!onlineMusicInfo || isBiliVideoActive()) {
      recoveryFinished = true
      if (actions.includes('next')) playNextAfterFailure(generation)
      else setAllStatus(t('player__error_stopped'))
      return
    }
    if (!recoveryPlan) {
      planActions = [...actions]
      const original = currentAttempt?.musicInfo ?? onlineMusicInfo
      const apiId = currentAttempt?.apiId ?? appSetting['common.apiSource']
      const quality = currentAttempt?.quality ?? appSetting['player.playQuality'] ?? playQuality.value as LX.Quality
      failedCombinations.add(playbackAttemptKey({ ownerId: currentMusicInfo.id, apiId, musicInfo: original, quality }))
      recoveryPlan = createPlaybackRecoveryPlan({
        actions: planActions,
        apiIds: getRecoveryApiIds(apiId, userApi.list.map(api => api.id), getPlayErrorApiSourceCount()),
        quality,
        original,
        async getPlatforms() {
          try {
            const alternatives = await getOtherSource(onlineMusicInfo, true)
            const candidates = original.id == onlineMusicInfo.id && original.source == onlineMusicInfo.source ? alternatives : [onlineMusicInfo, ...alternatives]
            const seen = new Set([JSON.stringify([original.source, original.id])])
            return candidates.filter(info => {
              const key = JSON.stringify([info.source, info.id])
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
          } catch (err) {
            console.warn('find playback platforms failed', err)
            return original.id == onlineMusicInfo.id && original.source == onlineMusicInfo.source ? [] : [onlineMusicInfo]
          }
        },
      })
    }
    if (currentAttempt) failedCombinations.add(playbackAttemptKey(currentAttempt))

    while (isRecoveryCurrent(generation)) {
      const plan = recoveryPlan
      if (!plan) return
      const next = await plan.next()
      if (!isRecoveryCurrent(generation)) return
      if (next.done) {
        recoveryFinished = true
        if (planActions.includes('next')) playNextAfterFailure(generation)
        else setAllStatus(t('player__error_stopped'))
        return
      }
      const combination = { ...next.value, ownerId: currentMusicInfo.id }
      const key = playbackAttemptKey(combination)
      if (failedCombinations.has(key) || failedApis.has(combination.apiId)) continue
      failedCombinations.add(key)
      if (combination.apiId != appSetting['common.apiSource']) {
        const api = userApi.list.find(api => api.id == combination.apiId)
        setAllStatus(t('player__switch_api_source', { name: api?.name ?? combination.apiId }))
        try {
          const initialized = await waitForRecovery(async() => {
            await setUserApi(combination.apiId)
            if (!isRecoveryCurrent(generation)) return false
            return window.lx.apiInitPromise[0]
          })
          if (!isRecoveryCurrent(generation)) return
          if (!initialized || appSetting['common.apiSource'] != combination.apiId) {
            failedApis.add(combination.apiId)
            continue
          }
        } catch (err) {
          console.warn('switch playback api failed', err)
          failedApis.add(combination.apiId)
          continue
        }
      }
      if (!isRecoveryCurrent(generation)) return
      try {
        await waitForRecovery(async() => loadDetailedQuality(combination.musicInfo, combination.quality))
      } catch (err) {
        console.warn('playback quality lookup failed', err)
      }
      if (!isRecoveryCurrent(generation)) return
      const quality = getExactPlayQuality(combination.quality, combination.musicInfo)
      if (!quality) continue
      if (shouldResume) setShouldPlayAfterLoad(true)
      setMusicUrl(currentMusicInfo, true, { sourceMusicInfo: combination.musicInfo, quality, strictQuality: true })
      if (quality != currentAttempt?.quality) setAllStatus(t('player__lower_quality', { quality }))
      else if (combination.musicInfo.source != currentAttempt?.musicInfo.source) setAllStatus(t('toggle_source_try'))
      return
    }

    setAllStatus(t('player__error_stopped'))
  }

  const handleError = (errCode?: number) => {
    if (!musicInfo.id) return
    clearLoadingTimeout()
    if (window.lx.isPlayedStop || !getPlaybackIntent() || recoveryFinished) return
    if (recoverPromise) {
      // Multiple engine/probe errors for the request already being recovered
      // must not consume the next candidate. Only queue a newly loaded failure.
      if (getCurrentPlaybackAttempt()?.requestId == recoveringRequestId) return
      pendingError = true
      return
    }
    // 首次点击播放时，MPV 可能还没发出 playing；此时仍要保留用户的播放意图，
    // 否则首个 CDN 失败后切换备用地址会停在暂停状态，必须再次点击播放。
    const shouldResume = getPlaybackIntent()
    recoveringRequestId = getCurrentPlaybackAttempt()?.requestId
    recoveryIntentRevision = getPlaybackIntentRevision()
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
      if (recoverPromise === recovery) {
        recoverPromise = null
        if (pendingError && isRecoveryCurrent(generation)) {
          pendingError = false
          handleError()
        }
      }
    })
  }

  const handleSetPlayInfo = () => {
    recoveryGeneration++
    for (const cancel of cancelRecoveryWaits) cancel()
    cancelRecoveryWaits.clear()
    retryNum = 0
    recoveryPlan = null
    failedCombinations = new Set()
    failedApis = new Set()
    planActions = []
    pendingError = false
    recoveryFinished = false
    recoveringRequestId = undefined
    recoverPromise = null
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  const removePlaybackIntentListener = onPlaybackIntentChange(playing => {
    if (!playing) handleSetPlayInfo()
  })

  window.app_event.on('playerLoadstart', handleLoadstart)
  window.app_event.on('playerLoadeddata', handleLoadeddata)
  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerWaiting', handleWating)
  window.app_event.on('playerEmptied', handleEmpied)
  window.app_event.on('playerError', handleError)
  window.app_event.on('musicToggled', handleSetPlayInfo)
  window.app_event.on('stop', handleSetPlayInfo)

  onBeforeUnmount(() => {
    removePlaybackIntentListener()
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
