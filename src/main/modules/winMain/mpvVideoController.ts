import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { log } from '@common/utils'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { sendEvent, getBrowserWindow } from './main'
import { MpvController } from './mpvController'
import * as accountSessions from '@main/modules/account/sessions'

declare const __non_webpack_require__: (id: string) => unknown

interface NativeMpvVideo {
  create: (handle: Buffer, onDoubleClick: () => void) => void
  load: (params: { videoUrl: string, audioUrl?: string, headers: string[] }) => void
  command: (params: { name: string, seconds?: number }) => void
  setVolume: (volume: number) => void
  setAudioDevice: (device: string) => void
  getProperty: (name: string) => number | boolean
  setBounds: (bounds: Electron.Rectangle) => void
  setVisible: (visible: boolean) => void
  poll: () => Array<{ name: string, value?: number | boolean }>
  destroy: () => void
}

interface NativeMpvWindow {
  create: (parentHandle: Buffer, onDoubleClick: () => void) => string
  setBounds: (bounds: Electron.Rectangle) => void
  setVisible: (visible: boolean) => void
  destroy: () => void
}

type VideoEventName = 'started' | 'loaded' | 'playing' | 'pause' | 'stopped' | 'ended' | 'error' | 'timeUpdate' | 'duration' | 'seeked' | 'doubleClick'

const isBiliCdn = (url: string) => /^https?:\/\/[^/]*\.bilivideo\.(?:com|cn)(?::\d+)?\//i.test(url)
const normalizeAudioDevice = (device: string | undefined) => {
  const value = String(device ?? '').trim()
  return value && !['default', 'Default', 'communications'].includes(value) ? value : 'auto'
}
const getBiliCookie = () => {
  const session = accountSessions.getSessionBySource('bili')
  if (!session) return ''
  return Object.entries(session.cookies).map(([key, value]) => `${key}=${String(value)}`).join('; ')
}

let native: NativeMpvVideo | null = null
let nativeWindowHost: NativeMpvWindow | null = null
let initialized = false
let pollTimer: NodeJS.Timeout | null = null
let loading = false
let hasFileLoaded = false
let currentUrl = ''
let bounds: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 }
let processPlayer: MpvController | null = null
let videoHostWindow: BrowserWindow | null = null
let videoHostParent: BrowserWindow | null = null
let removeHostWindowListeners: (() => void) | null = null
let videoHostReady: Promise<void> | null = null
let externalVideoVisible = false
const useNativeMacVideo = process.platform === 'darwin'
const useNativeWindowsVideoHost = process.platform === 'win32'
const requireNative = <T>(modulePath: string): T => __non_webpack_require__(modulePath) as T

const getExternalWindowId = (handle: Buffer) => {
  if (handle.length < 4) throw new Error('未获取到视频宿主窗口句柄')
  return handle.readUInt32LE(0).toString()
}

const syncExternalVideoBounds = () => {
  if (nativeWindowHost) {
    nativeWindowHost.setBounds(bounds)
    return
  }
  if (!videoHostWindow || videoHostWindow.isDestroyed() || !videoHostParent || videoHostParent.isDestroyed()) return
  const contentBounds = videoHostParent.getContentBounds()
  videoHostWindow.setBounds({
    x: Math.round(contentBounds.x + bounds.x),
    y: Math.round(contentBounds.y + bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }, false)
}

const setExternalVideoVisible = (visible: boolean) => {
  if (nativeWindowHost) {
    nativeWindowHost.setBounds(bounds)
    nativeWindowHost.setVisible(visible)
    return
  }
  if (!videoHostWindow || videoHostWindow.isDestroyed()) return
  syncExternalVideoBounds()
  if (visible) videoHostWindow.showInactive()
  else videoHostWindow.hide()
}

const ensureExternalVideoPlayer = () => {
  if (processPlayer) return processPlayer
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    throw new Error('Linux 视频嵌入需要 X11；当前 Wayland 会话暂不支持 MPV --wid')
  }
  const parent = getBrowserWindow()
  if (!parent) throw new Error('主窗口尚未创建')
  videoHostParent = parent

  let windowId: string
  if (useNativeWindowsVideoHost) {
    nativeWindowHost = getNativeWindowHost()
    windowId = nativeWindowHost.create(parent.getNativeWindowHandle(), () => { sendVideoEvent('doubleClick') })
    nativeWindowHost.setBounds(bounds)
    nativeWindowHost.setVisible(externalVideoVisible)
    log.info(`[MpvVideoController] using native Windows video host: ${windowId}`)
  } else {
    videoHostWindow = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      webPreferences: { sandbox: true },
    })
    videoHostWindow.setMenuBarVisibility(false)
    videoHostReady = videoHostWindow.loadURL('about:blank')
    windowId = getExternalWindowId(videoHostWindow.getNativeWindowHandle())
  }
  removeHostWindowListeners = () => {
    parent.off('move', syncExternalVideoBounds)
    parent.off('resize', syncExternalVideoBounds)
  }
  parent.on('move', syncExternalVideoBounds)
  parent.on('resize', syncExternalVideoBounds)

  processPlayer = new MpvController({
    video: true,
    windowId,
  })
  syncExternalVideoBounds()
  return processPlayer
}

const getNative = (): NativeMpvVideo => {
  if (native) return native
  if (!useNativeMacVideo) throw new Error('当前平台未启用 macOS 视频原生桥')
  const candidates = process.env.NODE_ENV === 'development'
    ? [
        path.join(process.cwd(), 'native/mpv-video/build/Release/lx_mpv_video.node'),
        path.join(process.cwd(), 'build/Release/lx_mpv_video.node'),
      ]
    : [
        path.join(__dirname, '../build/Release/lx_mpv_video.node'),
        path.join(process.resourcesPath, 'app.asar.unpacked/build/Release/lx_mpv_video.node'),
        path.join(process.resourcesPath, 'build/Release/lx_mpv_video.node'),
      ]
  const modulePath = candidates.find(filePath => fs.existsSync(filePath))
  if (!modulePath) throw new Error('未找到 MPV 视频原生桥，请重新构建应用')
  const nativeModule = requireNative<NativeMpvVideo>(modulePath)
  native = nativeModule
  return nativeModule
}

const getNativeWindowHost = (): NativeMpvWindow => {
  if (nativeWindowHost) return nativeWindowHost
  if (!useNativeWindowsVideoHost) throw new Error('当前平台未启用 Windows 视频宿主桥')
  const candidates = process.env.NODE_ENV === 'development'
    ? [
        path.join(process.cwd(), 'native/mpv-window/build/Release/lx_mpv_window.node'),
        path.join(process.cwd(), 'build/Release/lx_mpv_window.node'),
      ]
    : [
        path.join(__dirname, '../build/Release/lx_mpv_window.node'),
        path.join(process.resourcesPath, 'app.asar.unpacked/build/Release/lx_mpv_window.node'),
        path.join(process.resourcesPath, 'build/Release/lx_mpv_window.node'),
      ]
  const modulePath = candidates.find(filePath => fs.existsSync(filePath))
  if (!modulePath) throw new Error('未找到 Windows 视频宿主桥，请重新构建应用')
  const nativeModule = requireNative<NativeMpvWindow>(modulePath)
  nativeWindowHost = nativeModule
  return nativeModule
}

const sendVideoEvent = (name: VideoEventName, data?: unknown) => {
  const eventNames: Record<VideoEventName, string> = {
    started: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_started,
    loaded: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_loaded,
    playing: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_playing,
    pause: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_pause_event,
    stopped: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_stopped,
    ended: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_ended,
    error: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_error,
    timeUpdate: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_timeUpdate,
    duration: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_duration,
    seeked: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_seeked,
    doubleClick: WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_doubleClick,
  }
  sendEvent(eventNames[name], data)
}

const poll = () => {
  if (!native || !initialized) return
  try {
    for (const event of native.poll()) {
      switch (event.name) {
        case 'start':
          sendVideoEvent('started')
          break
        case 'loaded':
          loading = false
          hasFileLoaded = true
          sendVideoEvent('loaded')
          try {
            sendVideoEvent('duration', native.getProperty('duration'))
          } catch (error) {
            log.debug('[MpvVideoController] duration property unavailable', error)
          }
          try {
            if (native.getProperty('pause') === false) sendVideoEvent('playing')
          } catch (error) {
            log.debug('[MpvVideoController] pause property unavailable', error)
          }
          break
        case 'time':
          if (typeof event.value === 'number') sendVideoEvent('timeUpdate', event.value)
          break
        case 'duration':
          if (typeof event.value === 'number') sendVideoEvent('duration', event.value)
          break
        case 'pause':
          if (loading) break
          if (event.value === true) sendVideoEvent('pause')
          else if (event.value === false) sendVideoEvent('playing')
          break
        case 'ended':
          if (loading) break
          hasFileLoaded = false
          sendVideoEvent('ended')
          break
        case 'stopped':
          if (loading) break
          hasFileLoaded = false
          sendVideoEvent('stopped')
          break
        case 'error':
          hasFileLoaded = false
          sendVideoEvent('error', { code: event.value })
          break
      }
    }
  } catch (error) {
    log.error('[MpvVideoController] poll failed', error)
  }
}

const ensureNativeInitialized = () => {
  const player = getNative()
  if (!initialized) {
    const window = getBrowserWindow()
    if (!window) throw new Error('主窗口尚未创建')
    player.create(window.getNativeWindowHandle(), () => { sendVideoEvent('doubleClick') })
    initialized = true
    player.setBounds(bounds)
    if (!pollTimer) pollTimer = setInterval(poll, 100)
  }
  return player
}

export const init = async() => {
  if (!useNativeMacVideo) {
    ensureExternalVideoPlayer()
    if (videoHostReady) await videoHostReady
    return
  }
  ensureNativeInitialized()
}

export const loadUrl = async(videoUrl: string, audioUrl?: string) => {
  if (!useNativeMacVideo) {
    loading = true
    hasFileLoaded = false
    currentUrl = videoUrl
    try {
      const player = ensureExternalVideoPlayer()
      if (videoHostReady) await videoHostReady
      if (!nativeWindowHost && (!videoHostWindow || videoHostWindow.isDestroyed())) throw new Error('视频宿主窗口已关闭')
      if (nativeWindowHost) log.info(`[MpvVideoController] showing native Windows video host bounds=${JSON.stringify(bounds)}`)
      setExternalVideoVisible(externalVideoVisible)
      await player.loadUrl(videoUrl, { audioUrl })
    } catch (error) {
      loading = false
      sendVideoEvent('error', { message: error instanceof Error ? error.message : String(error) })
      log.error('[MpvVideoController] external video load failed', error)
      throw error
    }
    return
  }
  const player = ensureNativeInitialized()
  loading = true
  hasFileLoaded = false
  currentUrl = videoUrl
  try {
    player.setAudioDevice(normalizeAudioDevice(global.lx.appSetting['player.mediaDeviceId']))
  } catch (error) {
    log.warn('[MpvVideoController] set audio device failed', error)
  }
  const cookie = isBiliCdn(videoUrl) ? getBiliCookie() : ''
  player.load({
    videoUrl,
    audioUrl,
    headers: isBiliCdn(videoUrl)
      ? [
          'Referer: https://www.bilibili.com/',
          'Origin: https://www.bilibili.com',
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
          ...(cookie ? [`Cookie: ${cookie}`] : []),
        ]
      : [],
  })
}

export const setAudioDevice = (device: string) => {
  const normalizedDevice = normalizeAudioDevice(device)
  if (!useNativeMacVideo) {
    void ensureExternalVideoPlayer().setAudioDevice(normalizedDevice).catch(error => {
      log.warn('[MpvVideoController] external video audio device failed', error)
    })
    return
  }
  if (!native || !initialized) return
  native.setAudioDevice(normalizedDevice)
}

export const play = () => {
  if (!useNativeMacVideo) {
    void ensureExternalVideoPlayer().play().catch(error => { log.error('[MpvVideoController] external video play failed', error) })
    return
  }
  ensureNativeInitialized().command({ name: 'play' })
}

export const pause = () => {
  if (!useNativeMacVideo) {
    void ensureExternalVideoPlayer().pause().catch(error => { log.error('[MpvVideoController] external video pause failed', error) })
    return
  }
  ensureNativeInitialized().command({ name: 'pause' })
}

export const stop = () => {
  if (!useNativeMacVideo) {
    if (!processPlayer) return
    void processPlayer.stop().catch(error => { log.error('[MpvVideoController] external video stop failed', error) })
    loading = false
    hasFileLoaded = false
    return
  }
  if (!native || !initialized) return
  loading = false
  hasFileLoaded = false
  native.command({ name: 'stop' })
  sendVideoEvent('stopped')
}

export const seek = (seconds: number) => {
  if (!useNativeMacVideo) {
    void ensureExternalVideoPlayer().seek(seconds).catch(error => { log.error('[MpvVideoController] external video seek failed', error) })
    return
  }
  ensureNativeInitialized().command({ name: 'seek', seconds })
  sendVideoEvent('seeked')
}

export const setVolume = (volume: number) => {
  if (!useNativeMacVideo) {
    void ensureExternalVideoPlayer().setVolume(volume).catch(error => { log.error('[MpvVideoController] external video volume failed', error) })
    return
  }
  ensureNativeInitialized().setVolume(volume)
}

export const getPosition = async() => {
  if (!useNativeMacVideo) return processPlayer?.getPosition() ?? 0
  if (!native || !initialized) return 0
  return Number(native.getProperty('time-pos')) || 0
}

export const getDuration = async() => {
  if (!useNativeMacVideo) return processPlayer?.getDuration() ?? 0
  if (!native || !initialized) return 0
  return Number(native.getProperty('duration')) || 0
}

export const getPaused = async() => {
  if (!useNativeMacVideo) return processPlayer?.getPaused() ?? true
  if (!native || !initialized) return true
  return native.getProperty('pause') === true
}

export const setBounds = (nextBounds: Electron.Rectangle) => {
  bounds = nextBounds
  if (!useNativeMacVideo) {
    syncExternalVideoBounds()
    return
  }
  if (native && initialized) native.setBounds(bounds)
}

export const setVisible = (visible: boolean) => {
  if (!useNativeMacVideo) {
    externalVideoVisible = visible
    setExternalVideoVisible(visible)
    return
  }
  if (native && initialized) native.setVisible(visible)
}

export const destroy = async() => {
  const nativeToDestroy = native
  const nativeWasInitialized = initialized
  const nativeWindowHostToDestroy = nativeWindowHost
  const processPlayerToDestroy = processPlayer
  native = null
  nativeWindowHost = null
  initialized = false
  processPlayer = null
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (nativeToDestroy && nativeWasInitialized) nativeToDestroy.destroy()
  await processPlayerToDestroy?.destroy()
  nativeWindowHostToDestroy?.destroy()
  removeHostWindowListeners?.()
  removeHostWindowListeners = null
  if (videoHostWindow && !videoHostWindow.isDestroyed()) videoHostWindow.destroy()
  videoHostWindow = null
  videoHostParent = null
  videoHostReady = null
  externalVideoVisible = false
  loading = false
  hasFileLoaded = false
  currentUrl = ''
}

export const getState = () => ({ loading, hasFileLoaded, currentUrl })

app.on('before-quit', () => { void destroy() })

log.debug('[MpvVideoController] native video controller loaded')
