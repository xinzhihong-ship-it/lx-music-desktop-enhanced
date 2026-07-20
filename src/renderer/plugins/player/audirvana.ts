import { rendererInvoke } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { setAllStatus } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'

const invoke = async<T = void>(name: string, params?: unknown): Promise<T> => {
  return params === undefined
    ? rendererInvoke<T>(name)
    : rendererInvoke<unknown, T>(name, params)
}

type Noop = () => void

let empty = true
let currentTime = 0
let duration = 0
let muted = false
let isPlaying = false
let statePollTimer: NodeJS.Timeout | null = null
let isLoading = false
let stoppedCount = 0
let pendingSeekTime = -1
let lastPosition = 0
let positionStuckCount = 0

const listeners = {
  playing: [] as Noop[],
  pause: [] as Noop[],
  ended: [] as Noop[],
  error: [] as Noop[],
  loadeddata: [] as Noop[],
  loadstart: [] as Noop[],
  canplay: [] as Noop[],
  emptied: [] as Noop[],
  timeupdate: [] as Noop[],
  waiting: [] as Noop[],
  seeked: [] as Noop[],
}

const emit = (event: keyof typeof listeners) => {
  for (const cb of listeners[event]) cb()
}

const POLL_INTERVAL_MS = 1200

const startStatePoll = () => {
  if (statePollTimer) return
  stoppedCount = 0
  lastPosition = 0
  positionStuckCount = 0

  const tick = async() => {
    // 引擎已切走（如暂停状态下切到 MPV/内置引擎）时自动停止轮询：
    // 否则轮询会一直运行，主进程每次 getState 的 AppleScript 都会把已退出的 Audirvana 重新拉起。
    if (appSetting['player.playEngine'] !== 'audirvana') {
      stopStatePoll()
      return
    }
    try {
      const state = await invoke<'stopped' | 'playing' | 'paused'>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_get_state)
      const wasPlaying = isPlaying
      const wasStopped = !wasPlaying
      isPlaying = state === 'playing'

      // 从 Audirvana 同步真实进度与时长
      let position = lastPosition
      if (state === 'playing' || state === 'paused') {
        const pos = await invoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_get_position)
        position = pos
        // 时长在同一曲内不会变，只在切歌/重新获得时长时查一次，降低 AppleScript 压力
        if (duration <= 0 || wasStopped) {
          try {
            const dur = await invoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_get_duration)
            if (dur > 0 && duration !== dur) {
              duration = dur
              emit('loadeddata')
            }
          } catch (err) {
            console.warn('audirvana get duration failed', err)
          }
        }
        currentTime = position
      }

      // 检测假播放：状态显示 playing 但进度连续 3 秒没走，认为播放失败
      if (isPositionStuck(position, isPlaying)) {
        console.error('[Audirvana] fake playing detected, position stuck')
        isPlaying = false
        emit('error')
        emit('timeupdate')
        return
      }

      // 加载期间不传播状态变化，避免中途短暂 stopped 被误判为结束
      if (isLoading) {
        if (isPlaying) {
          isLoading = false
          stoppedCount = 0
          emit('playing')
        }
        emit('timeupdate')
        return
      }

      if (!wasPlaying && isPlaying) {
        stoppedCount = 0
        emit('playing')
      }
      if (wasPlaying && !isPlaying) {
        if (state === 'stopped') {
          // Audirvana 在曲目结束或加载失败时会返回 stopped，连续确认 3 次再触发 ended，避免误判
          stoppedCount++
          if (stoppedCount >= 3) {
            stoppedCount = 0
            emit('ended')
            emit('emptied')
          }
        } else {
          stoppedCount = 0
          emit('pause')
        }
      } else if (!isPlaying && state === 'stopped') {
        stoppedCount++
        if (stoppedCount >= 3) {
          stoppedCount = 0
          emit('ended')
          emit('emptied')
        }
      } else {
        stoppedCount = 0
      }

      emit('timeupdate')
    } catch (err) {
      console.error('audirvana state poll error', err)
    } finally {
      if (statePollTimer) {
        statePollTimer = setTimeout(tick, POLL_INTERVAL_MS)
      }
    }
  }

  statePollTimer = setTimeout(tick, 0)
}

const stopStatePoll = () => {
  if (statePollTimer) {
    clearTimeout(statePollTimer)
    statePollTimer = null
  }
  stoppedCount = 0
  lastPosition = 0
  positionStuckCount = 0
}

const isPositionStuck = (position: number, playing: boolean): boolean => {
  if (!playing) {
    positionStuckCount = 0
    lastPosition = position
    return false
  }

  if (Math.abs(position - lastPosition) < 0.05) {
    positionStuckCount++
    if (positionStuckCount >= 3) {
      positionStuckCount = 0
      return true
    }
  } else {
    positionStuckCount = 0
  }

  lastPosition = position
  return false
}

const waitForState = async(target: 'playing', maxWaitMs = 6000): Promise<boolean> => {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 400))
    const state = await invoke<'stopped' | 'playing' | 'paused'>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_get_state).catch(() => 'stopped')
    if (state === target) return true
  }
  return false
}

export const setResource = async(src: string, musicInfo?: LX.Music.MusicInfo, filePath?: string) => {
  currentTime = 0
  duration = 0
  empty = false
  isLoading = true
  stopStatePoll()
  emit('loadstart')
  try {
    setAllStatus(window.i18n.t('player__audirvana_downloading'))
    const params = filePath && musicInfo
      ? { url: src, musicInfo, filePath }
      : src
    const result = await invoke<string>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_set_track, params)
    emit('loadeddata')
    emit('canplay')
    // 主进程 setTrack 已经等待 Audirvana 真正开始播放，这里直接启动轮询即可
    console.log('[Audirvana] renderer: setTrack returned', result)
    isLoading = false
    isPlaying = true
    startStatePoll()
    console.log('[Audirvana] renderer: emitting playing event, current status before clear:', window.lxData?.appSetting?.['player.playEngine'])
    emit('playing')
    console.log('[Audirvana] renderer: clearing status (setAllStatus empty)')
    setAllStatus('') // 直接清除加载状态，避免事件系统未就绪时状态残留
    // 如果有待处理的 seek（恢复播放位置），在确认播放后执行
    if (pendingSeekTime >= 0) {
      const seekTime = pendingSeekTime
      pendingSeekTime = -1
      setCurrentTime(seekTime)
    }
    console.log('[Audirvana] renderer: playback started')
  } catch (err: any) {
    console.error('audirvana setResource failed:', err?.message ?? err)
    setAllStatus(window.i18n.t('player__audirvana_error') + ': ' + (err?.message ?? 'unknown'))
    isLoading = false
    empty = true
    emit('error')
    throw err
  }
}

export const setPlay = async() => {
  try {
    await invoke(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_play)
    isPlaying = true
    startStatePoll()
    // 等待 Audirvana 真正进入 playing 再触发 playing 事件，避免界面闪烁
    if (await waitForState('playing', 4000)) {
      emit('playing')
    }
  } catch (err) {
    console.error('audirvana play failed', err)
  }
}

export const setPause = async() => {
  try {
    await invoke(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_pause)
    isPlaying = false
  } catch (err) {
    console.error('audirvana pause failed', err)
  }
}

export const setStop = async() => {
  try {
    await invoke(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_stop)
  } catch (err) {
    console.error('audirvana stop failed', err)
  }
  empty = true
  currentTime = 0
  duration = 0
  isPlaying = false
  isLoading = false
  pendingSeekTime = -1
  stopStatePoll()
  emit('emptied')
}

export const isEmpty = () => empty

export const setLoopPlay = (_isLoop: boolean) => {
  // Audirvana 播放单首，循环逻辑由 LX Music 控制切歌实现
}

export const getPlaybackRate = () => 1

export const setPlaybackRate = (_rate: number) => {
  // Audirvana 不支持变速
}

export const setPreservesPitch = (_preservesPitch: boolean) => {
  // 不适用
}

export const getMute = () => muted

export const setMute = (isMute: boolean) => {
  muted = isMute
  if (muted) {
    void setPause()
  } else if (isPlaying) {
    void setPlay()
  }
}

export const getCurrentTime = () => currentTime

export const setCurrentTime = (time: number) => {
  if (time < 0) time = 0
  currentTime = time
  // 立即触发 timeupdate，让歌词/进度条立刻跳到新位置
  emit('timeupdate')
  if (isLoading || !isPlaying) {
    // 尚未确认播放时先记住，等播放后再 seek
    pendingSeekTime = time
    return
  }
  // 通知主进程真正改变 Audirvana 播放位置
  void invoke(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_set_position, time).catch((err) => {
    console.error('audirvana set position failed', err)
  })
}

export const setMediaDeviceId = async(_mediaDeviceId: string): Promise<void> => {
  // Audirvana 自己管理输出设备
}

export const setVolume = (_value: number) => {
  // Audirvana 建议通过其界面或系统音量控制
}

export const getDuration = () => duration

const subscribe = (event: keyof typeof listeners, callback: Noop) => {
  listeners[event].push(callback)
  return () => {
    listeners[event] = listeners[event].filter(cb => cb !== callback)
  }
}

export const onPlaying = (callback: Noop) => subscribe('playing', callback)
export const onPause = (callback: Noop) => subscribe('pause', callback)
export const onEnded = (callback: Noop) => subscribe('ended', callback)
export const onError = (callback: Noop) => subscribe('error', callback)
export const onLoadeddata = (callback: Noop) => subscribe('loadeddata', callback)
export const onLoadstart = (callback: Noop) => subscribe('loadstart', callback)
export const onCanplay = (callback: Noop) => subscribe('canplay', callback)
export const onEmptied = (callback: Noop) => subscribe('emptied', callback)
export const onTimeupdate = (callback: Noop) => subscribe('timeupdate', callback)
export const onWaiting = (callback: Noop) => subscribe('waiting', callback)
export const onSeeked = (callback: Noop) => subscribe('seeked', callback)

export const onVisibilityChange = (callback: Noop) => {
  const handler = () => {
    callback()
  }
  document.addEventListener('visibilitychange', handler)
  return () => {
    document.removeEventListener('visibilitychange', handler)
  }
}

export const getErrorCode = () => 0
