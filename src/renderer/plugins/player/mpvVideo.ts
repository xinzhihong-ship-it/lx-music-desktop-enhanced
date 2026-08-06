import { ipcRenderer } from 'electron'
import { rendererInvoke } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

type Noop = () => void
type VideoEventKey =
  | 'mpv_video_started'
  | 'mpv_video_loaded'
  | 'mpv_video_playing'
  | 'mpv_video_pause_event'
  | 'mpv_video_stopped'
  | 'mpv_video_ended'
  | 'mpv_video_error'
  | 'mpv_video_timeUpdate'
  | 'mpv_video_duration'
  | 'mpv_video_seeked'
  | 'mpv_video_doubleClick'

let empty = true
let currentUrl = ''
let currentTime = 0
let duration = 0
let volume = 100
let muted = false

const invoke = async<T = void>(name: string, params?: unknown): Promise<T> => {
  return params === undefined
    ? rendererInvoke<T>(name)
    : rendererInvoke<unknown, T>(name, params)
}

const on = (eventKey: VideoEventKey, callback: (params?: any) => void) => {
  const name = WIN_MAIN_RENDERER_EVENT_NAME[eventKey]
  const listener = (_event: Electron.IpcRendererEvent, params?: any) => { callback(params) }
  ipcRenderer.on(name, listener)
  return () => { ipcRenderer.removeListener(name, listener) }
}

export const init = async() => { await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_init) }

export const setResource = async(videoUrl: string, audioUrl?: string) => {
  currentUrl = videoUrl
  currentTime = 0
  duration = 0
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_loadUrl, { videoUrl, audioUrl })
  empty = false
}

export const setPlay = async() => { await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_play) }
export const setPause = async() => { await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_pause) }

export const setStop = async() => {
  empty = true
  currentUrl = ''
  currentTime = 0
  duration = 0
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_stop)
}

export const setCurrentTime = (time: number) => {
  currentTime = time
  if (!empty) void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_seek, time).catch(err => { console.error('mpv video seek failed', err) })
}

export const setVolume = (value: number) => {
  volume = Math.trunc(value * 100)
  if (!muted) void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setVolume, volume).catch(err => { console.error('mpv video volume failed', err) })
}

export const setAudioDevice = async(device: string) => {
  if (empty) return
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setAudioDevice, device)
}

export const setMute = (isMute: boolean) => {
  muted = isMute
  void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setVolume, isMute ? 0 : volume).catch(err => { console.error('mpv video mute failed', err) })
}

export const getMute = () => muted

export const setBounds = async(bounds: Electron.Rectangle) => { await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setBounds, bounds) }
export const setVisible = async(visible: boolean) => { await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setVisible, visible) }
export const getCurrentUrl = () => currentUrl
export const getCurrentTime = () => currentTime
export const getDuration = () => duration
export const isEmpty = () => empty

export const onPlaying = (callback: Noop) => on('mpv_video_playing', callback)
export const onPause = (callback: Noop) => on('mpv_video_pause_event', callback)
export const onEnded = (callback: Noop) => on('mpv_video_ended', callback)
export const onError = (callback: (error?: any) => void) => on('mpv_video_error', callback)
export const onLoadeddata = (callback: Noop) => on('mpv_video_loaded', callback)
export const onLoadstart = (_callback: Noop) => () => {}
export const onCanplay = (callback: Noop) => on('mpv_video_loaded', callback)
export const onEmptied = (callback: Noop) => on('mpv_video_stopped', callback)
export const onWaiting = (_callback: Noop) => () => {}
export const onSeeked = (callback: Noop) => on('mpv_video_seeked', callback)
export const onTimeupdate = (callback: Noop) => on('mpv_video_timeUpdate', (time?: number) => {
  if (typeof time === 'number') currentTime = time
  callback()
})
export const onDuration = (callback: (value: number) => void) => on('mpv_video_duration', (value?: number) => {
  if (typeof value !== 'number') return
  duration = value
  callback(value)
})
export const onDoubleClick = (callback: Noop) => on('mpv_video_doubleClick', callback)

on('mpv_video_timeUpdate', value => {
  if (typeof value === 'number') currentTime = value
})
on('mpv_video_duration', value => {
  if (typeof value === 'number') duration = value
})
on('mpv_video_loaded', () => { empty = false })
on('mpv_video_stopped', () => {
  empty = true
  currentUrl = ''
  currentTime = 0
  duration = 0
})
