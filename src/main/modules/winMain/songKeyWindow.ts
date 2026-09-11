import { BrowserWindow, ipcMain } from 'electron'
import { getSongKeyViewerHtml } from './songKeyViewerHtml'

let songKeyWindow: BrowserWindow | null = null
let cachedData: any = null

export const createSongKeyWindow = (): BrowserWindow => {
  if (songKeyWindow && !songKeyWindow.isDestroyed()) {
    songKeyWindow.show()
    songKeyWindow.focus()
    return songKeyWindow
  }

  songKeyWindow = new BrowserWindow({
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

  void songKeyWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(getSongKeyViewerHtml())}`)

  songKeyWindow.webContents.on('did-finish-load', () => {
    if (cachedData && songKeyWindow && !songKeyWindow.isDestroyed()) {
      syncSongKeyDataToWindow(cachedData)
    }
  })

  songKeyWindow.on('closed', () => {
    songKeyWindow = null
  })

  return songKeyWindow
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
  songKeyWindow = null
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
