// 「Folia 对接」的渲染进程一侧：把播放状态推给主进程（main/modules/foliaLink，Folia 从那里读），
// 并执行主进程转来的请求（handlers.ts）。不管设置开没开都推状态：主进程关着对接时只是不对外。
import { onBeforeUnmount, toRaw, watch } from '@common/utils/vueTools'
import { onFoliaLinkRequest, sendFoliaLinkResponse, sendFoliaLinkState } from '@renderer/utils/ipc'
import { appSetting } from '@renderer/store/setting'
import { isPlay, playInfo, playMusicInfo, playQuality, playQualityActual, tempPlayList } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { isMute, volume } from '@renderer/store/player/volume'
import { playbackRate } from '@renderer/store/player/playbackRate'
import { handleFoliaLinkRequest, toMusicInfo } from './handlers'

/** 播放中位置的推送间隔：主进程按收到的时刻外推，Folia 那边再按自己的时钟走 */
const POSITION_PUSH_MS = 1000

/** 结构化克隆不了 Vue 的响应式代理：发出去之前换成普通数据 */
const plain = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(toRaw(value)))

const isExternalEngine = () => appSetting['player.playEngine'] === 'mpv' || appSetting['player.playEngine'] === 'audirvana'

export default () => {
  // 换歌、取地址、缓冲时为 true，真正出声（或暂停、出错、停止）时为 false
  let loading = false

  const positionPatch = () => ({
    isPlay: isPlay.value,
    loading,
    positionMs: Math.round(playProgress.nowPlayTime * 1000),
    durationMs: Math.round(playProgress.maxPlayTime * 1000),
  })

  const fullState = () => {
    const musicInfo = toMusicInfo(playMusicInfo.musicInfo)
    return {
      ...positionPatch(),
      musicId: musicInfo?.id ?? null,
      musicInfo: plain(musicInfo),
      listId: playInfo.playerListId,
      isTempPlay: playMusicInfo.isTempPlay,
      playLaterCount: tempPlayList.length,
      // MPV、Audirvana 引擎不应用倍速（usePlaybackRate）
      rate: isExternalEngine() ? 1 : playbackRate.value,
      volume: volume.value,
      mute: isMute.value,
      playMode: appSetting['player.togglePlayMethod'],
      quality: { wanted: appSetting['player.playQuality'], current: playQuality.value, actual: playQualityActual.value },
    }
  }

  let fullTimer: ReturnType<typeof setTimeout> | null = null
  const pushFull = () => {
    if (fullTimer) return
    fullTimer = setTimeout(() => {
      fullTimer = null
      sendFoliaLinkState(fullState())
    })
  }
  let lastPositionAt = 0
  const pushPosition = (force = false) => {
    const now = Date.now()
    if (!force && now - lastPositionAt < POSITION_PUSH_MS) return
    lastPositionAt = now
    sendFoliaLinkState(positionPatch())
  }

  const setLoading = (value: boolean) => {
    if (loading === value) return
    loading = value
    pushFull()
  }
  const handleLoadStart = () => { setLoading(true) }
  const handleLoaded = () => { setLoading(false) }
  const handleSeeked = () => { pushPosition(true) }

  watch(() => [
    playMusicInfo.musicInfo,
    playMusicInfo.isTempPlay,
    playInfo.playerListId,
    tempPlayList.length,
    isPlay.value,
    playbackRate.value,
    volume.value,
    isMute.value,
    appSetting['player.togglePlayMethod'],
    appSetting['player.playQuality'],
    appSetting['player.playEngine'],
    playQuality.value,
    playQualityActual.value,
    playProgress.maxPlayTime,
  ], pushFull)
  watch(() => playProgress.nowPlayTime, () => { pushPosition() })

  window.app_event.on('musicToggled', handleLoadStart)
  window.app_event.on('playerLoadstart', handleLoadStart)
  window.app_event.on('playerWaiting', handleLoadStart)
  window.app_event.on('play', handleLoaded)
  window.app_event.on('playerPlaying', handleLoaded)
  window.app_event.on('pause', handleLoaded)
  window.app_event.on('stop', handleLoaded)
  window.app_event.on('error', handleLoaded)
  window.app_event.on('playerEmptied', handleLoaded)
  window.app_event.on('playerSeeked', handleSeeked)

  const removeRequestListener = onFoliaLinkRequest(({ params: { requestKey, op, params } }) => {
    void Promise.resolve().then(async() => handleFoliaLinkRequest(op, params)).then(data => {
      sendFoliaLinkResponse({ requestKey, ok: true, data: plain(data ?? null) })
    }, (err: any) => {
      sendFoliaLinkResponse({ requestKey, ok: false, error: { code: typeof err?.code == 'string' ? err.code : 'failed', message: String(err?.message ?? err) } })
    })
  })

  onBeforeUnmount(() => {
    removeRequestListener()
    window.app_event.off('musicToggled', handleLoadStart)
    window.app_event.off('playerLoadstart', handleLoadStart)
    window.app_event.off('playerWaiting', handleLoadStart)
    window.app_event.off('play', handleLoaded)
    window.app_event.off('playerPlaying', handleLoaded)
    window.app_event.off('pause', handleLoaded)
    window.app_event.off('stop', handleLoaded)
    window.app_event.off('error', handleLoaded)
    window.app_event.off('playerEmptied', handleLoaded)
    window.app_event.off('playerSeeked', handleSeeked)
  })

  return () => {
    sendFoliaLinkState(fullState())
  }
}
