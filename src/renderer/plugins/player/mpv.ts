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

let empty = true
let currentTime = 0
let duration = 0
let volume = 100
let muted = false

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

export const setResource = async(src: string) => {
  empty = false
  currentTime = 0
  duration = 0
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_loadUrl, src)
}

export const setPlay = async() => {
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_play)
}

export const setPause = async() => {
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_pause)
}

export const setStop = async() => {
  empty = true
  currentTime = 0
  duration = 0
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_stop)
}

export const listAudioDevices = async(): Promise<Array<{ id: string, name: string }>> => {
  return invoke<Array<{ id: string, name: string }>>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_listAudioDevices)
}

export const destroy = async() => {
  empty = true
  currentTime = 0
  duration = 0
  await invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_destroy)
}

export const isEmpty = () => empty

export const getCurrentTime = () => currentTime

export const setCurrentTime = (time: number) => {
  currentTime = time
  void invoke(WIN_MAIN_RENDERER_EVENT_NAME.mpv_seek, time).catch(err => {
    console.error('mpv seek failed', err)
  })
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
export const onLoadstart = (callback: Noop) => on('mpv_started', callback)
export const onCanplay = (callback: Noop) => on('mpv_loaded', callback)
export const onEmptied = (callback: Noop) => on('mpv_stopped', callback)
export const onWaiting = (_callback: Noop) => () => {}
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
on('mpv_stopped', () => {
  empty = true
  currentTime = 0
  duration = 0
})
