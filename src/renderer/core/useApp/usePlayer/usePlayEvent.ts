import { onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { musicInfo, playMusicInfo, playQuality, statusText } from '@renderer/store/player/state'
import { setStop } from '@renderer/plugins/player'
import { cancelPendingUrlRequests, playNext, setMusicUrl, setShouldPlayAfterLoad } from '@renderer/core/player'
import { setAllStatus } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getPlayErrorActions, getPlayErrorApiSourceCount, getPlayErrorRetryCount, isPlayErrorHandlingEnabled, isStrictPlayQualityEnabled } from '@renderer/core/player/errorStrategy'
import { getExactPlayQuality, getOtherSource } from '@renderer/core/music/utils'
import { loadDetailedQuality } from '@renderer/core/music/online'
import { createPlaybackRecoveryPlan, getRecoveryApiIds, type RecoveryCombination } from '@common/utils/playbackRecovery'
import { getCurrentPlaybackAttempt, playbackAttemptKey } from '@renderer/core/player/playbackAttempt'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'
import { userApi } from '@renderer/store'
import { getRequestedApiId, setUserApi } from '@renderer/core/apiSource'
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

  // ---- 临时音源：错误恢复只切换运行时音源，不写回设置；恢复结束后切回用户在设置中选择的音源 ----
  let tempApiId: string | null = null
  /** 当前实际使用的音源（运行时），临时换源期间与 appSetting['common.apiSource'] 不同 */
  const getActiveApiId = () => getRequestedApiId() || appSetting['common.apiSource']
  const getApiName = (id: string) => userApi.list.find(api => api.id == id)?.name ?? id
  /**
   * 结束临时音源，切回设置中的音源。返回本次临时使用过的音源 id（未切换过则为 null）。
   * 切回会立即替换 apiInitPromise，之后发起的取址请求（下一首、预加载）都会等待原音源初始化完成。
   */
  const restoreUserApiSource = (): string | null => {
    if (!tempApiId) return null
    const usedId = tempApiId
    tempApiId = null
    const userApiId = appSetting['common.apiSource']
    if (getRequestedApiId() != userApiId) {
      void setUserApi(userApiId).catch(err => { console.warn('restore user api source failed', err) })
    }
    return usedId
  }
  /** 撤销超时未完成的音源切换：仍停留在该音源时立即切回用户音源，迟到的初始化结果不再生效 */
  const abandonApiSwitch = (apiId: string) => {
    if (getRequestedApiId() != apiId) return
    if (tempApiId == apiId) tempApiId = null
    void setUserApi(appSetting['common.apiSource']).catch(err => { console.warn('abandon api switch failed', err) })
  }
  const showTempApiNotice = (usedId: string) => {
    const message = t('player__api_source_temp_used', { name: getApiName(usedId), original: getApiName(appSetting['common.apiSource']) })
    // 放到本轮 playing 事件处理之后，避免被其他 playing 监听清空
    setTimeout(() => {
      setAllStatus(message)
      setTimeout(() => { if (statusText.value == message) setAllStatus('') }, 6000)
    })
  }
  /**
   * 等待恢复步骤，最长 25 秒。超时只能结束等待，无法中止步骤本身，
   * 因此超时时调用 onTimeout 让调用方主动撤销该步骤的副作用（如切回用户音源）。
   */
  const waitForRecovery = async<T>(task: () => Promise<T>, onTimeout?: () => void): Promise<T> => {
    let timer: NodeJS.Timeout
    let cancel: () => void
    return new Promise<T>((resolve, reject) => {
      cancel = () => { reject(new Error('playback recovery cancelled')) }
      cancelRecoveryWaits.add(cancel)
      timer = setTimeout(() => {
        onTimeout?.()
        reject(new Error('playback recovery timeout'))
      }, 25000)
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
    // 临时音源已成功恢复播放：当前歌曲的地址已取到，立即切回用户音源，后续歌曲不再沿用临时音源
    const usedId = restoreUserApiSource()
    if (usedId) showTempApiNotice(usedId)
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
    // 放弃当前歌曲：作废仍在进行的取址，避免迟到的结果在切到下一首前（或之后）又把它播放出来
    cancelPendingUrlRequests()
    if (document.hidden) {
      console.warn('error skip to next')
      void playNext(true, () => isRecoveryCurrent(generation))
    } else {
      setAllStatus(t('player__error'))
      setTimeout(() => { addDelayNextTimeout(generation) })
    }
  }

  /** 所有恢复手段均已失败、停留在当前歌曲：切回用户音源并提示 */
  const stopRecoveryWithError = () => {
    // 恢复已放弃：作废仍在进行的取址，迟到的结果不能在提示「播放失败」之后自行开始播放
    cancelPendingUrlRequests()
    restoreUserApiSource()
    setAllStatus(t('player__error_stopped'))
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
      else stopRecoveryWithError()
      return
    }
    if (!recoveryPlan) {
      planActions = [...actions]
      const original = currentAttempt?.musicInfo ?? onlineMusicInfo
      const apiId = currentAttempt?.apiId ?? getActiveApiId()
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
        else stopRecoveryWithError()
        return
      }
      const combination = { ...next.value, ownerId: currentMusicInfo.id }
      const key = playbackAttemptKey(combination)
      if (failedCombinations.has(key) || failedApis.has(combination.apiId)) continue
      failedCombinations.add(key)
      if (combination.apiId != getActiveApiId()) {
        const api = userApi.list.find(api => api.id == combination.apiId)
        setAllStatus(t('player__switch_api_source', { name: api?.name ?? combination.apiId }))
        try {
          // 临时切换：不写回设置，恢复结束后由 restoreUserApiSource 切回；切回用户自己的音源不算临时切换
          tempApiId = combination.apiId == appSetting['common.apiSource'] ? null : combination.apiId
          const initialized = await waitForRecovery(async() => {
            await setUserApi(combination.apiId, { persist: false })
            if (!isRecoveryCurrent(generation)) return false
            return window.lx.apiInitPromise[0]
          }, () => { abandonApiSwitch(combination.apiId) })
          if (!isRecoveryCurrent(generation)) return
          if (!initialized || getActiveApiId() != combination.apiId) {
            failedApis.add(combination.apiId)
            continue
          }
        } catch (err) {
          console.warn('switch playback api failed', err)
          // 已被取消的旧恢复（切歌 / 暂停后）不能把失败记录写进新一轮恢复的状态
          if (!isRecoveryCurrent(generation)) return
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
      // 恢复组合需要精确请求该档位；实际降质是否算失败由「严格音质」设置决定
      setMusicUrl(currentMusicInfo, true, { sourceMusicInfo: combination.musicInfo, quality, strictQuality: true, rejectDowngrade: isStrictPlayQualityEnabled() })
      if (quality != currentAttempt?.quality) setAllStatus(t('player__lower_quality', { quality }))
      else if (combination.musicInfo.source != currentAttempt?.musicInfo.source) setAllStatus(t('toggle_source_try'))
      return
    }

    stopRecoveryWithError()
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
    // 切歌 / 停止 / 暂停 / 卸载：本轮恢复结束，临时音源不带到下一首
    restoreUserApiSource()
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
