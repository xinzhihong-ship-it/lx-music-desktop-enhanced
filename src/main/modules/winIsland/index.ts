// 顶部歌词岛：屏幕顶部中央的透明窗口，复用桌面歌词的渲染包（lyric.html?mode=island）
// 与主窗口通道（每种客户端一个端口）。窗口默认鼠标穿透（forward 让渲染进程仍能收到移动事件），
// 只有鼠标落在胶囊上时渲染进程才请求接收鼠标。
// 多显示器：跟随鼠标所在的屏幕。macOS 上区分带刘海的内建屏（贴着刘海）与普通屏（放在菜单栏下方，不挡菜单）。
// 拖动：按住胶囊可拖到任意位置（保存在 island.x / island.y，不再跟随鼠标换屏）；拖回屏幕顶部中央松手即恢复停靠。
import path from 'node:path'
import { BrowserWindow, MessageChannelMain, screen, type Display } from 'electron'
import { getPlatform, isLinux, isMac } from '@common/utils'
import { encodePath } from '@common/utils/electron'
import { mainOn, mainSend } from '@common/mainIpc'
import { WIN_LYRIC_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { sendNewDesktopLyricClient } from '@main/modules/winMain'
import { buildLyricConfig, watchConfigKeys } from '@main/modules/winLyric/utils'

/** 窗口大小按展开后的迷你播放器留足；透明部分不拦截鼠标 */
export const ISLAND_WIDTH = 560
export const ISLAND_HEIGHT = 260
const FOLLOW_INTERVAL = 500
// 带刘海的屏幕菜单栏约 32~38pt，普通屏约 24pt
const NOTCH_MENU_BAR_MIN = 30

let browserWindow: BrowserWindow | null = null
let currentDisplayId: number | null = null
let followTimer: NodeJS.Timeout | null = null
let dragOrigin: { x: number, y: number } | null = null
// 松手时窗口顶边离屏幕顶边、胶囊中心离屏幕中线都在这个范围内，就吸附回顶部停靠
const DOCK_SNAP_Y = 48
const DOCK_SNAP_X = 160

/** 鼠标所在的屏幕 */
const pickDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

/** 用户拖动后保存的位置；位置已不在任何屏幕上（拔掉了显示器等）时视为停靠 */
const getFloatingPosition = () => {
  const x = global.lx.appSetting['island.x']
  const y = global.lx.appSetting['island.y']
  if (x == null || y == null) return null
  const display = screen.getDisplayNearestPoint({ x: x + ISLAND_WIDTH / 2, y })
  const { bounds } = display
  const inside = x + ISLAND_WIDTH / 2 >= bounds.x && x + ISLAND_WIDTH / 2 <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  return inside ? { x, y, display } : null
}

export const getDisplayInfo = (display: Display, floating = false): LX.DesktopLyric.IslandDisplayInfo => {
  if (!isMac) return { notch: false, menuBar: 0, floating }
  // 菜单栏自动隐藏时 workArea 不含菜单栏，按普通屏处理
  const menuBar = Math.max(0, display.workArea.y - display.bounds.y)
  return { notch: display.internal && menuBar >= NOTCH_MENU_BAR_MIN, menuBar: menuBar || 24, floating }
}

const getIslandBounds = (display: Display) => {
  // 用整个屏幕（含菜单栏）的顶边：macOS 上贴着刘海 / 菜单栏，Windows 上贴着屏幕顶边
  const { x, y, width } = display.bounds
  return { x: Math.round(x + (width - ISLAND_WIDTH) / 2), y, width: ISLAND_WIDTH, height: ISLAND_HEIGHT }
}

const placeWindow = (force = true) => {
  if (!browserWindow || dragOrigin) return
  const floating = getFloatingPosition()
  if (floating) {
    // 拖到了固定位置：不跟随鼠标换屏
    if (!force) return
    currentDisplayId = floating.display.id
    browserWindow.setBounds({ x: floating.x, y: floating.y, width: ISLAND_WIDTH, height: ISLAND_HEIGHT })
    mainSend(browserWindow, WIN_LYRIC_RENDERER_EVENT_NAME.island_display_info, getDisplayInfo(floating.display, true))
    return
  }
  const display = pickDisplay()
  if (!force && display.id == currentDisplayId) return
  currentDisplayId = display.id
  browserWindow.setBounds(getIslandBounds(display))
  mainSend(browserWindow, WIN_LYRIC_RENDERER_EVENT_NAME.island_display_info, getDisplayInfo(display))
}

/** 拖动：start 记下窗口位置；move 按指针位移移动窗口；end 判断吸附回顶部还是保存位置 */
const handleDrag = ({ phase, dx, dy }: LX.DesktopLyric.IslandDrag) => {
  if (!browserWindow) return
  if (phase == 'start') {
    const [x, y] = browserWindow.getPosition()
    dragOrigin = { x, y }
    // 立刻切到悬浮样式（四角圆角、不贴顶）
    const display = screen.getDisplayNearestPoint({ x: x + ISLAND_WIDTH / 2, y })
    mainSend(browserWindow, WIN_LYRIC_RENDERER_EVENT_NAME.island_display_info, getDisplayInfo(display, true))
    return
  }
  if (!dragOrigin) return
  const x = Math.round(dragOrigin.x + dx)
  const y = Math.round(dragOrigin.y + dy)
  browserWindow.setPosition(x, y)
  if (phase == 'move') return
  dragOrigin = null
  const display = screen.getDisplayNearestPoint({ x: x + ISLAND_WIDTH / 2, y })
  const { bounds } = display
  const snap = Math.abs(y - bounds.y) <= DOCK_SNAP_Y && Math.abs(x + ISLAND_WIDTH / 2 - (bounds.x + bounds.width / 2)) <= DOCK_SNAP_X
  // 保存后 updated_config 会再定位一次（停靠时回到顶部中央）
  global.lx.event_app.update_config(snap ? { 'island.x': null, 'island.y': null } : { 'island.x': x, 'island.y': Math.max(bounds.y, y) })
  if (snap && global.lx.appSetting['island.x'] == null) placeWindow()
}

const stopFollow = () => {
  if (followTimer) clearInterval(followTimer)
  followTimer = null
}
/** 多显示器时跟着鼠标换屏（只比较屏幕 id，开销很小） */
const startFollow = () => {
  stopFollow()
  followTimer = setInterval(() => {
    if (!dragOrigin && screen.getAllDisplays().length > 1) placeWindow(false)
  }, FOLLOW_INTERVAL)
}

const setInteractive = (interactive: boolean) => {
  if (!browserWindow) return
  // Linux 不支持 forward，只能整窗接收或整窗穿透：保持接收，避免歌词岛完全无法操作
  if (isLinux) return
  browserWindow.setIgnoreMouseEvents(!interactive, { forward: true })
}

export const isExistWindow = () => !!browserWindow

export const closeWindow = () => {
  if (!browserWindow) return
  browserWindow.close()
}

export const createWindow = () => {
  closeWindow()
  const { shouldUseDarkColors, theme } = global.lx.theme
  const floating = getFloatingPosition()
  const display = floating?.display ?? pickDisplay()
  currentDisplayId = display.id
  const bounds = floating ? { x: floating.x, y: floating.y, width: ISLAND_WIDTH, height: ISLAND_HEIGHT } : getIslandBounds(display)
  const displayInfo = getDisplayInfo(display, !!floating)
  browserWindow = new BrowserWindow({
    ...bounds,
    // macOS：非激活面板，悬停 / 点击不会抢走当前应用的焦点
    ...(isMac ? { type: 'panel' } : {}),
    useContentSize: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: false,
    show: false,
    webPreferences: {
      contextIsolation: false,
      webSecurity: false,
      sandbox: false,
      nodeIntegration: true,
      enableWebSQL: false,
      webgl: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  // 层级高于菜单栏与全屏应用，所有桌面空间可见
  browserWindow.setAlwaysOnTop(true, 'screen-saver')
  // skipTransformProcessType：否则 Electron 会把整个应用改成后台 UI 元素（UIElement），程序坞图标随之消失。
  // 歌词岛本身是非激活面板，不改进程类型也能显示在全屏应用之上
  if (isMac) browserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  setInteractive(false)

  browserWindow.on('closed', () => {
    browserWindow = null
    currentDisplayId = null
    dragOrigin = null
    stopFollow()
  })
  browserWindow.once('ready-to-show', () => {
    if (!browserWindow) return
    browserWindow.showInactive()
    // macOS 会把新窗口挪到菜单栏下方：显示后再定位一次
    placeWindow()
    startFollow()
  })

  const winURL = process.env.NODE_ENV === 'development' ? 'http://localhost:9081/lyric.html' : `file://${path.join(encodePath(__dirname), 'lyric.html')}`
  void browserWindow.loadURL(winURL + `?os=${getPlatform()}&mode=island&notch=${displayInfo.notch}&menuBar=${displayInfo.menuBar}&floating=${displayInfo.floating}&dark=${shouldUseDarkColors}&theme=${encodeURIComponent(JSON.stringify(theme))}`)
}

const getMainFrame = () => browserWindow?.webContents.mainFrame

const islandConfigKeys = [...watchConfigKeys, 'island.alwaysShow'] as Array<keyof LX.AppSetting>

export default () => {
  // 与桌面歌词共用请求通道的事件名：按发送方窗口区分，这里只处理歌词岛
  mainOn(WIN_LYRIC_RENDERER_EVENT_NAME.request_main_window_channel, ({ event }) => {
    if (!browserWindow || event.senderFrame !== getMainFrame()) return
    const { port1, port2 } = new MessageChannelMain()
    sendNewDesktopLyricClient(port1, 'island')
    event.senderFrame?.postMessage(WIN_LYRIC_RENDERER_EVENT_NAME.provide_main_window_channel, null, [port2])
  })
  mainOn<boolean>(WIN_LYRIC_RENDERER_EVENT_NAME.island_set_interactive, ({ event, params: interactive }) => {
    if (!browserWindow || event.senderFrame !== getMainFrame()) return
    setInteractive(interactive)
  })

  mainOn<LX.DesktopLyric.IslandDrag>(WIN_LYRIC_RENDERER_EVENT_NAME.island_drag, ({ event, params }) => {
    if (!browserWindow || event.senderFrame !== getMainFrame()) return
    handleDrag(params)
  })

  global.lx.event_app.on('main_window_inited', () => {
    if (!global.lx.appSetting['island.enable']) return
    if (browserWindow) mainSend(browserWindow, WIN_LYRIC_RENDERER_EVENT_NAME.main_window_inited)
    else createWindow()
  })
  global.lx.event_app.on('updated_config', (keys, setting) => {
    if (keys.includes('island.enable')) {
      if (global.lx.appSetting['island.enable']) {
        if (!browserWindow) createWindow()
      } else closeWindow()
    }
    if (browserWindow && (keys.includes('island.x') || keys.includes('island.y'))) placeWindow()
    if (browserWindow && islandConfigKeys.some(key => keys.includes(key))) {
      mainSend(browserWindow, WIN_LYRIC_RENDERER_EVENT_NAME.on_config_change, buildLyricConfig(setting))
    }
  })
  global.lx.event_app.on('main_window_close', () => {
    closeWindow()
  })
  const replace = () => { placeWindow() }
  screen.on('display-metrics-changed', replace)
  screen.on('display-added', replace)
  screen.on('display-removed', replace)
}
