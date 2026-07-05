import { ipcRenderer } from 'electron'
import { rendererInvoke } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

interface MpvPathInfo {
  path: string
  source: 'custom' | 'bundled' | 'dev-bundled' | 'system' | 'common-path'
}

type Noop = () => void

type MpvEventKey =
  | 'mpv_started'
  | 'mpv_loaded'
  | 'mpv_playing'
  | 'mpv_pause_event'
  | 'mpv_stopped'
  | 'mpv_ended'
  | 'mpv_error'
  | 'mpv_timeUpdate'
  | 'mpv_duration'
  | 'mpv_seeked'

let empty = true
let currentUrl = ''
let currentTime = 0
let duration = 0
let volume = 100
let muted = false
let pendingSeekTime: number | null = null

const setPendingSeekTime = (time: number | null) => {
  pendingSeekTime = time
}
const clearPendingSeekTime = () => {
  pendingSeekTime = null
}

const applyPendingSeek = () => {
  if (pendingSeekTime == null) return
  const time = pendingSeekTime
  clearPendingSeekTime()
  void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_seek, time).catch(err => {
    console.error('mpv seek failed', err)
  })
}

const invoke = async<T = void>(name: string, params?: unknown): Promise<T> => {
  return params === undefined
    ? rendererInvoke<T>(name)
    : rendererInvoke<unknown, T>(name, params)
}

const on = (eventKey: MpvEventKey, callback: (params?: any) => void) => {
  const name = WIN_MAIN_RENDERER_EVENT_NAME[eventKey]
  const listener = (_event: Electron.IpcRendererEvent, params?: any) => {
    callback(params)
  }
  ipcRenderer.on(name, listener)
  return () => {
    ipcRenderer.removeListener(name, listener)
  }
}

export const init = async() => {
  return invoke<MpvPathInfo>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_init)
}

export const setResource = async(src: string): Promise<void> => {
  currentUrl = src
  currentTime = 0
  duration = 0
  // 启动恢复或加载前可能已经有待执行的 seek，保留到加载完成后再应用
  const seekTime = pendingSeekTime
  clearPendingSeekTime()
  try {
    await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_loadUrl, src)
    empty = false
    if (seekTime != null) {
      setPendingSeekTime(seekTime)
      applyPendingSeek()
    }
    // 正常切歌时不再这里主动 seek 0：主进程 loadUrl 已经把文件暂停在 0:00，
    // 且 play() 会在真正恢复前再 seek 一次目标位置，避免 play 和 seek 竞争导致先播后跳。
  } catch (err: any) {
    console.error('mpv load url failed:', err?.message ?? err)
    empty = true
    clearPendingSeekTime()
    throw err
  }
}

export const setPlay = async() => {
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_play)
}

export const setPause = async() => {
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_pause)
}

export const setStop = async() => {
  empty = true
  currentUrl = ''
  currentTime = 0
  duration = 0
  pendingSeekTime = null
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_stop)
}

export const listAudioDevices = async(): Promise<Array<{ id: string, name: string }>> => {
  return invoke<Array<{ id: string, name: string }>>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_listAudioDevices)
}

export const destroy = async() => {
  empty = true
  currentUrl = ''
  currentTime = 0
  duration = 0
  pendingSeekTime = null
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_destroy)
}

export const restart = async(playing = false) => {
  console.log('[mpv.ts restart] currentUrl=', currentUrl, 'currentTime=', currentTime, 'playing=', playing)
  // currentUrl 可能因 HMR 等原因丢失，main process 会用旧控制器记录的 URL 作为 fallback
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_restart, {
    url: currentUrl,
    time: currentTime,
    playing,
  })
  console.log('[mpv.ts restart] ipc returned')
}

export const getCurrentUrl = () => currentUrl

export const isEmpty = () => empty

export const getCurrentTime = () => currentTime

export const setCurrentTime = (time: number) => {
  currentTime = time
  if (empty) {
    pendingSeekTime = time
    return
  }
  void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_seek, time).catch(err => {
    console.error('mpv seek failed', err)
  })
}

export const clearPendingSeek = () => {
  pendingSeekTime = null
}

export const getDuration = () => duration

export const setVolume = (value: number) => {
  volume = Math.trunc(value * 100)
  if (!muted) {
    void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_setVolume, volume).catch(err => {
      console.error('mpv set volume failed', err)
    })
  }
}

export const setMute = (isMute: boolean) => {
  muted = isMute
  void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_setVolume, isMute ? 0 : volume).catch(err => {
    console.error('mpv set mute failed', err)
  })
}

export const onPlaying = (callback: Noop) => on('mpv_playing', callback)
export const onPause = (callback: Noop) => on('mpv_pause_event', callback)
export const onEnded = (callback: Noop) => on('mpv_ended', callback)
export const onError = (callback: (error?: any) => void) => on('mpv_error', callback)
export const onLoadeddata = (callback: Noop) => on('mpv_loaded', callback)
// MPV 进程启动（mpv_started）并不等于开始加载文件；
// loadstart 由 setResource 显式触发，避免空载/启动恢复时误报“音乐加载中...”。
export const onLoadstart = (_callback: Noop) => () => {}
export const onCanplay = (callback: Noop) => on('mpv_loaded', callback)
export const onEmptied = (callback: Noop) => on('mpv_stopped', callback)
export const onWaiting = (_callback: Noop) => () => {}
export const onSeeked = (callback: Noop) => on('mpv_seeked', callback)
export const onTimeupdate = (callback: Noop) => on('mpv_timeUpdate', (time?: number) => {
  if (typeof time == 'number') currentTime = time
  callback()
})
export const onDuration = (callback: (dur: number) => void) => on('mpv_duration', (time?: number) => {
  if (typeof time == 'number') {
    duration = time
    callback(time)
  }
})

on('mpv_timeUpdate', time => {
  if (typeof time == 'number') currentTime = time
})
on('mpv_duration', time => {
  if (typeof time == 'number') duration = time
})
on('mpv_loaded', () => {
  empty = false
})
on('mpv_stopped', () => {
  empty = true
  currentUrl = ''
  currentTime = 0
  duration = 0
  pendingSeekTime = null
})
