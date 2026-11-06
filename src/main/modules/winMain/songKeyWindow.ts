import { BrowserWindow, ipcMain } from 'electron'
import { getSongKeyViewerHtml } from './songKeyViewerHtml'

let songKeyWindow: BrowserWindow | null = null
let cachedData: any = null

export const createSongKeyWindow = (onClosed: () => void): BrowserWindow => {
  if (songKeyWindow && !songKeyWindow.isDestroyed()) {
    songKeyWindow.show()
    songKeyWindow.focus()
    return songKeyWindow
  }

  const window = new BrowserWindow({
    width: 440,
    height: 740,
    minWidth: 380,
    minHeight: 540,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#f4f7f9',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  songKeyWindow = window
  void window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(getSongKeyViewerHtml())}`)

  window.webContents.on('did-finish-load', () => {
    if (cachedData && songKeyWindow === window && !window.isDestroyed()) {
      syncSongKeyDataToWindow(cachedData)
    }
  })

  window.once('closed', () => {
    if (songKeyWindow !== window) return
    songKeyWindow = null
    onClosed()
  })

  return window
}

export const syncSongKeyDataToWindow = (data: any): boolean => {
  cachedData = data
  if (!songKeyWindow || songKeyWindow.isDestroyed()) return false
  try {
    const escaped = JSON.stringify(data ?? null)
    void songKeyWindow.webContents.executeJavaScript(`window.syncSongKeyData(${escaped})`).catch(() => {})
    return true
  } catch {
    return false
  }
}

export const closeSongKeyWindow = (): void => {
  if (songKeyWindow && !songKeyWindow.isDestroyed()) {
    songKeyWindow.close()
  }
}

export const isSongKeyWindowActive = (): boolean => {
  return !!songKeyWindow && !songKeyWindow.isDestroyed()
}

// 注册独立窗口专用的 IPC 事件
ipcMain.on('song_key_window_pin_action', (_event, isPinned: boolean) => {
  if (songKeyWindow && !songKeyWindow.isDestroyed()) {
    songKeyWindow.setAlwaysOnTop(Boolean(isPinned))
  }
})

ipcMain.on('winMain_close_song_key_window', () => {
  closeSongKeyWindow()
})
