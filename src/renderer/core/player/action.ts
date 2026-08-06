import { isEmpty, setPause, setPlay, setResource, setStop, getCurrentTime, setCurrentTime } from '@renderer/plugins/player'
import { isPlay, playedList, playInfo, playMusicInfo, tempPlayList, musicInfo as _musicInfo } from '@renderer/store/player/state'
import {
  getList,
  clearPlayedList,
  clearTempPlayeList,
  setPlayMusicInfo,
  setPlay as setPlayerPlaying,
  addPlayedList,
  setMusicInfo,
  setAllStatus,
  removeTempPlayList,
  setPlayListId,
  removePlayedList,
  setPlayQuality,
} from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getMusicUrl, getPicPath, getLyricInfo } from '../music/index'
import { getLowerPlayQuality, getPlayQuality } from '../music/utils'
import { filterList } from './utils'
import { requestMsg } from '@renderer/utils/message'
import { getRandom } from '@renderer/utils/index'
import { addListMusics, removeListMusics } from '@renderer/store/list/action'
import { loveList } from '@renderer/store/list/state'
import { addDislikeInfo } from '@renderer/core/dislikeList'
import { qualityList } from '@renderer/store'
import { buildSavePath } from '@renderer/store/download/utils'
import { createDownloadInfo } from '@renderer/worker/download/utils'
import { joinPath } from '@common/utils/nodejs'
import { shouldLowerQualityOnError, shouldSkipOnError, shouldToggleSourceOnError } from './errorStrategy'
import { getVideoUrl } from '@renderer/utils/musicSdk/bili/api'
import { biliPlaybackMode, biliVideoQuality, isBiliVideoActive } from '@renderer/store/player/biliVideo'
import { toOldMusicInfo } from '@renderer/utils'
// import { checkMusicFileAvailable } from '@renderer/utils/music'

let gettingUrlId = ''
let activeUrlRequest = 0
let shouldPlayAfterLoad = false

const getOnlineMusicInfo = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem): LX.Music.MusicInfoOnline | null => {
  if ('progress' in musicInfo) return musicInfo.metadata.musicInfo
  if (musicInfo.source === 'local') return null
  return musicInfo
}

const buildAudirvanaFilePath = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem): string | null => {
  if (appSetting['player.playEngine'] !== 'audirvana') return null
  const onlineInfo = getOnlineMusicInfo(musicInfo)
  if (!onlineInfo) return null
  const downloadInfo = createDownloadInfo(onlineInfo, appSetting['player.playQuality'], appSetting['download.fileName'], qualityList.value, playMusicInfo.listId ?? undefined)
  return joinPath(buildSavePath(downloadInfo), downloadInfo.metadata.fileName)
}

const getMusicQualityLabel = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, quality?: string): string => {
  if ('progress' in musicInfo) return '下载'
  if (musicInfo.source == 'local') return '本地'
  return quality ?? getPlayQuality(appSetting['player.playQuality'], musicInfo)
}
export const setShouldPlayAfterLoad = (val: boolean) => { shouldPlayAfterLoad = val }
export const getShouldPlayAfterLoad = () => shouldPlayAfterLoad
export const clearShouldPlayAfterLoad = () => { shouldPlayAfterLoad = false }
// 内置引擎拖动进度条后，若拖动前正在播放，则应在 canplay 时恢复播放，
// 避免 audio seek 期间 isPlay 被临时置为 false 导致 handleCanplay 误暂停。
let shouldPlayAfterSeek = false
export const setShouldPlayAfterSeek = (val: boolean) => { shouldPlayAfterSeek = val }
export const getShouldPlayAfterSeek = () => shouldPlayAfterSeek
export const clearShouldPlayAfterSeek = () => { shouldPlayAfterSeek = false }
// renderer 端也记录暂停位置，作为 MPV 主进程 pausedAt 失效时的兜底。
let rendererPausedAt = 0
const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}
const createDelayNextTimeout = (delay: number) => {
  let timeout: NodeJS.Timeout | null
  const clearDelayNextTimeout = () => {
    // console.log(this.timeout)
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    timeout = setTimeout(() => {
      timeout = null
      if (window.lx.isPlayedStop) return
      console.warn('delay next timeout timeout', delay)
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { addDelayNextTimeout, clearDelayNextTimeout } = createDelayNextTimeout(5000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(100000)
const isMpvLoadError = (message: string) => /winMain_mpv_loadUrl|mpv playback error|mpv file-load timeout|mpv IPC request timeout/i.test(message)

/**
 * 检查音乐信息是否已更改
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  // return curMusicInfo !== playMusicInfo.musicInfo || isPlay.value
  return gettingUrlId != createGettingUrlId(curMusicInfo) || curMusicInfo.id != playMusicInfo.musicInfo?.id || isPlay.value
}

let cancelDelayRetry: (() => void) | null = null
interface MusicUrlResult { url: string, quality: string, audioUrl?: string, isVideo?: boolean }
interface SourceRequestResult { url: string, type?: string, audioUrl?: string }
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, quality?: LX.Quality, hasLoweredQuality = false, forceToggleSource = false): Promise<MusicUrlResult | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<MusicUrlResult | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setAllStatus(window.i18n.t('player__getting_url_delay_retry', { time }))
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true, quality, hasLoweredQuality, forceToggleSource).then((result) => {
        cancelDelayRetry = null
        resolve(result)
      }).catch(async(err: any) => {
        cancelDelayRetry = null
        reject(err)
      })
    }, time * 1000)
    cancelDelayRetry = () => {
      clearTimeout(tiemout)
      cancelDelayRetry = null
      resolve(null)
    }
  })
}
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false, quality?: LX.Quality, hasLoweredQuality = false, forceToggleSource = false): Promise<MusicUrlResult | null> => {
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  setAllStatus(window.i18n.t('player__getting_url'))
  if (shouldSkipOnError()) addLoadTimeout()

  const onlineMusicInfo = getOnlineMusicInfo(musicInfo)
  const targetQuality = quality
  let resolvedQuality = targetQuality
  let toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo

  const isVideo = biliPlaybackMode.value === 'video' && onlineMusicInfo?.source === 'bili'
  const sourceRequest: Promise<SourceRequestResult> = isVideo
    ? getVideoUrl(toOldMusicInfo(onlineMusicInfo), biliVideoQuality.value, { isRefresh }).promise as Promise<SourceRequestResult>
    : (!forceToggleSource && toggleMusicInfo ? getMusicUrl({
        musicInfo: toggleMusicInfo,
        quality: targetQuality,
        isRefresh,
        allowToggleSource: false,
        onResolvedQuality: quality => { resolvedQuality = quality },
      }) : Promise.reject(new Error('not found'))).catch(async() => {
        return getMusicUrl({
          musicInfo,
          quality: targetQuality,
          isRefresh,
          allowToggleSource: shouldToggleSourceOnError(),
          forceToggleSource,
          onResolvedQuality: quality => { resolvedQuality = quality },
          onToggleSource(mInfo) {
            if (diffCurrentMusicInfo(musicInfo)) return
            setAllStatus(window.i18n.t('toggle_source_try'))
          },
        })
      }).then(url => ({ url }))
  return sourceRequest.then(result => {
    if (window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return null

    const quality = result.type ?? (onlineMusicInfo
      ? (resolvedQuality ?? getPlayQuality(appSetting['player.playQuality'], onlineMusicInfo))
      : appSetting['player.playQuality'])
    return { url: result.url, quality, audioUrl: result.audioUrl, isVideo }
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch(err => {
    // console.log('err', err.message)
    if (window.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo) ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh, quality, hasLoweredQuality, forceToggleSource)

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true, quality, hasLoweredQuality, forceToggleSource)

    if (!hasLoweredQuality && onlineMusicInfo && shouldLowerQualityOnError()) {
      const currentQuality = targetQuality ?? getPlayQuality(appSetting['player.playQuality'], onlineMusicInfo)
      const lowerQuality = getLowerPlayQuality(currentQuality, onlineMusicInfo)
      if (lowerQuality) {
        setAllStatus(window.i18n.t('player__lower_quality', { quality: lowerQuality }))
        return getMusicPlayUrl(musicInfo, true, true, lowerQuality, true)
      }
    }

    throw err
  })
}

interface SetMusicUrlOptions {
  quality?: LX.Quality
  hasLoweredQuality?: boolean
  forceToggleSource?: boolean
}

export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean, options: SetMusicUrlOptions = {}) => {
  // if (appSetting['player.autoSkipOnError']) addLoadTimeout()
  if (!isRefresh && !diffCurrentMusicInfo(musicInfo)) return
  if (cancelDelayRetry) cancelDelayRetry()
  const requestId = ++activeUrlRequest
  gettingUrlId = createGettingUrlId(musicInfo)
  void getMusicPlayUrl(musicInfo, isRefresh, false, options.quality, options.hasLoweredQuality, options.forceToggleSource).then(async(result) => {
    if (requestId !== activeUrlRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    if (!result) {
      // 没有获取到 URL 时，如果是用户主动播放/自动播放则按错误处理；
      // 否则（如启动预加载）清空加载状态，避免一直显示“音乐加载中...”。
      if (shouldPlayAfterLoad) {
        setAllStatus(window.i18n.t(shouldSkipOnError() ? 'player__error' : 'player__error_stopped'))
        window.app_event.error()
      } else {
        setAllStatus('')
        window.app_event.playerEmptied()
      }
      return
    }
    const { url, quality, audioUrl, isVideo } = result
    if (requestId !== activeUrlRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    // 记录当前播放音质，用于在主界面显示。
    if (musicInfo.id == playMusicInfo.musicInfo?.id) {
      setPlayQuality(getMusicQualityLabel(musicInfo, quality))
    }
    if (isVideo) {
      await setResource(url, undefined, undefined, audioUrl)
      return
    }
    if (appSetting['player.playEngine'] === 'audirvana') {
      const audirvanaFilePath = buildAudirvanaFilePath(musicInfo)
      try {
        await setResource(url, audirvanaFilePath ? (musicInfo as LX.Music.MusicInfo) : undefined, audirvanaFilePath ?? undefined)
        return
      } catch (err: any) {
        console.error('setResource failed', err)
        // Audirvana 需要先下载到本地再播放，部分音源链接有效期极短，
        // 若提示链接过期/无权限/不存在，先刷新 URL 重试一次
        const msg = err.message ?? ''
        const isUrlExpired = msg.includes('已过期') || msg.includes('无权限') || msg.includes('不存在')
        if (isUrlExpired) {
          console.log('[Audirvana] URL expired, refreshing and retrying...')
          setAllStatus(window.i18n.t('player__refresh_url'))
          const refreshed = await getMusicPlayUrl(musicInfo, true)
          if (refreshed && refreshed.url !== url) {
            try {
              await setResource(refreshed.url, audirvanaFilePath ? (musicInfo as LX.Music.MusicInfo) : undefined, audirvanaFilePath ?? undefined)
              return
            } catch (err2: any) {
              console.error('[Audirvana] setResource retry failed', err2)
              throw err2
            }
          }
        }
        throw err
      }
    }
    await setResource(url)
  }).catch((err: any) => {
    if (requestId !== activeUrlRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    console.log(err)
    const message = err?.message ?? String(err)
    if (isMpvLoadError(message)) {
      // loadUrl 失败时主进程会直接拒绝 IPC，不一定能走 mpv_error 事件；
      // 转成统一播放器错误，交给 usePlayEvent 刷新 URL/切换备用源。
      window.app_event.playerError()
      return
    }
    setAllStatus(message)
    window.app_event.error()
    if (shouldSkipOnError()) addDelayNextTimeout()
  }).finally(() => {
    if (musicInfo === playMusicInfo.musicInfo && requestId === activeUrlRequest) {
      gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

// 恢复上次播放的状态
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playMusicInfo.musicInfo
  if (!musicInfo) return

  const autoPlay = appSetting['player.startupAutoPlay']

  // MPV / Audirvana 引擎在启动时不会保留播放状态，需要重新加载 URL；
  // 内置引擎则保持原有行为，由用户手动触发或 startupAutoPlay 控制。
  if (appSetting['player.playEngine'] == 'mpv' || appSetting['player.playEngine'] == 'audirvana') {
    shouldPlayAfterLoad = autoPlay
    setMusicUrl(musicInfo)
  }

  setImmediate(() => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    window.app_event.setProgress(appSetting['player.isSavePlayTime'] ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)
    if (!autoPlay) window.app_event.pause()
  })


  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setAllStatus(window.i18n.t('lyric__load_error'))
  })

  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...playMusicInfo as LX.Player.PlayMusicInfo })
}


// 处理音乐播放
const handlePlay = () => {
  window.lx.isPlayedStop &&= false
  rendererPausedAt = 0

  resetRandomNextMusicInfo()
  if (window.lx.restorePlayInfo) {
    void handleRestorePlay(window.lx.restorePlayInfo)
    window.lx.restorePlayInfo = null
    return
  }
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return

  setStop()
  window.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()


  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...(playMusicInfo as LX.Player.PlayMusicInfo) })

  shouldPlayAfterLoad = true
  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setAllStatus(window.i18n.t('lyric__load_error'))
  })
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param id 歌曲id
 */
export const playListById = (listId: string, id: string) => {
  const prevListId = playInfo.playerListId
  setPlayListId(listId)
  // pause()
  const musicInfo = getList(listId).find(m => m.id == id)
  if (!musicInfo) return
  setPlayMusicInfo(listId, musicInfo)
  if (appSetting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  handlePlay()
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param index 播放的歌曲位置
 */
export const playList = (listId: string, index: number) => {
  const prevListId = playInfo.playerListId
  setPlayListId(listId)
  // pause()
  setPlayMusicInfo(listId, getList(listId)[index])
  if (appSetting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  handlePlay()
}

const handleToggleStop = () => {
  stop()
  setTimeout(() => {
    setPlayMusicInfo(null, null)
  })
}

const randomNextMusicInfo = {
  info: null as LX.Player.PlayMusicInfo | null,
  // index: -1,
}
export const resetRandomNextMusicInfo = () => {
  if (randomNextMusicInfo.info) {
    randomNextMusicInfo.info = null
    // randomNextMusicInfo.index = -1
  }
}

export const getNextPlayMusicInfo = async(): Promise<LX.Player.PlayMusicInfo | null> => {
  if (tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = tempPlayList[0]
    return playMusicInfo
  }

  if (playMusicInfo.musicInfo == null) return null

  if (randomNextMusicInfo.info) return randomNextMusicInfo.info

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return null
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return null
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      return null
  }
  if (nextIndex < 0) return null

  const nextPlayMusicInfo = {
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  }

  if (togglePlayMethod == 'random') {
    randomNextMusicInfo.info = nextPlayMusicInfo
    // randomNextMusicInfo.index = nextIndex
  }
  return nextPlayMusicInfo
}

const handlePlayNext = (playMusicInfo: LX.Player.PlayMusicInfo) => {
  // pause()
  setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  handlePlay()
}
/**
 * 下一曲
 * @param isAutoToggle 是否自动切换
 * @returns
 */
export const playNext = async(isAutoToggle = false): Promise<void> => {
  console.log('skip next', isAutoToggle)
  if (tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = tempPlayList[0]
    removeTempPlayList(0)
    handlePlayNext(playMusicInfo)
    console.log('play temp list')
    return
  }

  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    console.log('musicInfo empty')
    return
  }

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    console.log('currentListId empty')
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) {
      handlePlayNext(playedList[index])
      console.log('play played list')
      return
    }
  }
  if (randomNextMusicInfo.info) {
    handlePlayNext(randomNextMusicInfo.info)
    return
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) {
    handleToggleStop()
    console.log('filtered list empty')
    return
  }
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
        togglePlayMethod = 'listLoop'
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      nextIndex = -1
      console.log('stop toggle play', togglePlayMethod, isAutoToggle)
      return
  }
  if (nextIndex < 0) {
    console.log('next index empty')
    return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 上一曲
 */
export const playPrev = async(isAutoToggle = false): Promise<void> => {
  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    return
  }

  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) - 1; index > -1; index--) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index > -1) {
      handlePlayNext(playedList[index])
      return
    }
  }

  // const isCheckFile = findNum > 2
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: false,
  })
  if (!filteredList.length) {
    handleToggleStop()
    return
  }

  // let currentIndex = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex
  if (!playMusicInfo.isTempPlay) {
    let togglePlayMethod = appSetting['player.togglePlayMethod']
    if (!isAutoToggle) {
      switch (togglePlayMethod) {
        case 'list':
        case 'singleLoop':
        case 'none':
          togglePlayMethod = 'listLoop'
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
        nextIndex = playerIndex === 0 ? filteredList.length - 1 : playerIndex - 1
        break
      case 'singleLoop':
        break
      default:
        nextIndex = -1
        return
    }
    if (nextIndex < 0) return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 恢复播放
 */
export const play = () => {
  window.lx.isPlayedStop &&= false
  if (playMusicInfo.musicInfo == null) return
  if (isEmpty()) {
    if (createGettingUrlId(playMusicInfo.musicInfo) != gettingUrlId) {
      shouldPlayAfterLoad = true
      setMusicUrl(playMusicInfo.musicInfo)
    }
    return
  }
  clearShouldPlayAfterLoad()
  if (isBiliVideoActive()) setPlayerPlaying(true)
  // renderer 端兜底：如果主进程没有正确恢复暂停位置，先把进度 seek 回去再播放。
  if (rendererPausedAt > 0) {
    const resumeTime = rendererPausedAt
    rendererPausedAt = 0
    setCurrentTime(resumeTime)
  }
  setPlay()
}

/**
 * 暂停播放
 */
export const pause = () => {
  clearShouldPlayAfterLoad()
  rendererPausedAt = getCurrentTime()
  if (isBiliVideoActive()) setPlayerPlaying(false)
  setPause()
}

/**
 * 停止播放
 */
export const stop = () => {
  clearShouldPlayAfterLoad()
  setPlayQuality('')
  setStop()
  setTimeout(() => {
    window.app_event.stop()
  })
}

/**
 * 播放、暂停播放切换
 */
export const togglePlay = () => {
  window.lx.isPlayedStop &&= false
  if (isPlay.value) {
    pause()
  } else {
    play()
  }
}

/**
 * 收藏当前播放的歌曲
 */
export const collectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  void addListMusics(loveList.id, ['progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo])
}

/**
 * 取消收藏当前播放的歌曲
 */
export const uncollectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  void removeListMusics({ listId: loveList.id, ids: ['progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo.id : playMusicInfo.musicInfo.id] })
}

/**
 * 不喜欢当前播放的歌曲
 */
export const dislikeMusic = async() => {
  if (!playMusicInfo.musicInfo) return
  const minfo = 'progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  await playNext(true)
}
