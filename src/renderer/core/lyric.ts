// 主窗口的歌词“行跟踪”与对外同步：
//   - 按新歌词数据（lyrics/engine 的 LyricDoc）跟踪当前行：更新状态栏歌词、播放器状态（托盘 / 开放 API 用）、
//     lyricLinePlay 事件。只在换行时刻唤醒一次（setTimeout 到下一行开始），不逐帧运行。
//   - 把歌词原文与播放 / 暂停 / 跳转时间同步给桌面歌词与顶部歌词岛（各自按收到的时间锚定时钟）。
//   - 播放器卡住却不上报暂停时（MPV 缓存耗尽等），漂移防护让客户端暂停，恢复后按真实时间继续。
// 播放详情页的歌词视图自己按帧读取位置（engine.readLyricPosition），不依赖这里。
import { findLineIndex } from '@common/utils/lyrics'
import { getAnalyser } from '@renderer/plugins/player'
import { lyric, setText } from '@renderer/store/player/lyric'
import { isPlay, musicInfo } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { setStatusText } from '@renderer/store/player/action'
import { watch } from '@common/utils/vueTools'
import { vst3Runtime } from '@renderer/plugins/player/vst3'
import { appSetting } from '@renderer/store/setting'
import { onNewDesktopLyricProcess } from '@renderer/utils/ipc'
import { lyricDoc, readLyricPosition } from './lyrics/engine'
import { getCurrentTime } from './lyrics/time'
import { createLyricDriftGuard } from './lyricDriftGuard'

export { getCurrentTime }

// ---- 当前行跟踪 ----
/** 跟踪器最长多久复查一次（跳转、倍速变化、时钟误差都在下一次复查时纠正） */
const MAX_TICK = 1000
let tickTimer: ReturnType<typeof setTimeout> | null = null
// 上次发出的当前行（行号 + 文本 + 翻译 / 罗马音）：内容没变就不重复通知
let lastKey = ''
const clearTick = () => {
  if (tickTimer) clearTimeout(tickTimer)
  tickTimer = null
}
const emitLine = (index: number) => {
  const line = lyricDoc.value.lines[index]
  const text = line?.text ?? ''
  const key = `${index}\u0000${text}\u0000${line?.translation ?? ''}\u0000${line?.roma ?? ''}`
  if (key == lastKey) return
  lastKey = key
  setText(text, Math.max(index, 0))
  setStatusText(text)
  window.app_event.lyricLinePlay(text, index)
}
const tick = () => {
  tickTimer = null
  const lines = lyricDoc.value.lines
  const pos = readLyricPosition()
  const index = findLineIndex(lines, pos)
  emitLine(index)
  if (!isPlay.value) return
  const next = lines[index + 1]
  const rate = appSetting['player.playbackRate'] || 1
  const delay = next ? Math.max(16, (next.start - pos) / rate) : MAX_TICK
  tickTimer = setTimeout(tick, Math.min(delay, MAX_TICK))
}
/** 立即按当前位置重新判断当前行，并在播放中继续跟踪 */
const retrack = () => {
  clearTick()
  tick()
}

// ---- 漂移防护：播放器卡住时让客户端暂停，恢复后从真实时间继续 ----
const driftGuard = createLyricDriftGuard()
const DRIFT_CHECK_INTERVAL = 500
let driftTimer: ReturnType<typeof setInterval> | null = null
const stopDriftCheck = () => {
  driftGuard.stop()
  if (driftTimer) {
    clearInterval(driftTimer)
    driftTimer = null
  }
}
const checkDrift = () => {
  if (!isPlay.value) {
    stopDriftCheck()
    return
  }
  const time = getCurrentTime()
  switch (driftGuard.check(time, performance.now())) {
    case 'stall':
      sendDesktopLyricInfo({ action: 'set_pause' })
      break
    case 'resume':
    case 'resync':
      sendDesktopLyricInfo({ action: 'set_play', data: time })
      retrack()
      break
    default:
      break
  }
}
/** 从 time 开始：通知客户端、重新跟踪当前行、以此为基准检查漂移 */
const playAt = (time: number) => {
  sendDesktopLyricInfo({ action: 'set_play', data: time })
  retrack()
  driftGuard.start(time, performance.now(), appSetting['player.playbackRate'])
  driftTimer ??= setInterval(checkDrift, DRIFT_CHECK_INTERVAL)
}
watch(() => [vst3Runtime.active, vst3Runtime.latencyMs, vst3Runtime.bridgeMs], () => {
  if (isPlay.value) playAt(getCurrentTime())
})
// 歌词内容变化（换歌词、翻译 / 罗马音 / 点亮方式开关）后重新判断当前行
watch(lyricDoc, () => { retrack() })

// ---- 桌面歌词 / 歌词岛 ----
type ClientPort = Electron.IpcRendererEvent['ports'][0]
// 连接主窗口的客户端（桌面歌词、顶部歌词岛），每种一个端口；窗口重开时新端口替换旧端口
const clientPorts = new Map<LX.DesktopLyric.ClientKind, ClientPort>()
const analyserTools: {
  bufferLength: number
  analyser: AnalyserNode | null
  sendDataArray: (port: ClientPort) => void
} = {
  bufferLength: 0,
  analyser: null,
  sendDataArray(port) {
    if (this.analyser == null) {
      this.analyser = getAnalyser()
      if (!this.analyser) return
      this.bufferLength = this.analyser.frequencyBinCount
    }
    const dataArray = new Uint8Array(this.bufferLength)
    this.analyser.getByteFrequencyData(dataArray)
    // 频谱数据转移所有权，只发给请求方
    port.postMessage({ action: 'send_analyser_data_array', data: dataArray }, [dataArray.buffer])
  },
}

/** 发给所有已连接的客户端 */
export const sendDesktopLyricInfo = (info: LX.DesktopLyric.LyricActions) => {
  for (const port of clientPorts.values()) port.postMessage(info)
}
const buildInfo = (): LX.DesktopLyric.LyricActions => ({
  action: 'set_info',
  data: {
    id: musicInfo.id,
    singer: musicInfo.singer,
    name: musicInfo.name,
    album: musicInfo.album,
    lrc: musicInfo.lrc,
    tlrc: musicInfo.tlrc,
    rlrc: musicInfo.rlrc,
    lxlrc: musicInfo.lxlrc,
    pic: musicInfo.pic,
    duration: playProgress.maxPlayTime,
    isPlay: isPlay.value,
    line: lyric.line,
    played_time: getCurrentTime(),
  },
})
const handleDesktopLyricMessage = (action: LX.DesktopLyric.WinMainActions, port: ClientPort, data?: unknown) => {
  switch (action) {
    case 'get_info':
      port.postMessage(buildInfo())
      break
    case 'get_status':
      port.postMessage({
        action: 'set_status',
        data: {
          isPlay: isPlay.value,
          line: lyric.line,
          played_time: getCurrentTime(),
        },
      } satisfies LX.DesktopLyric.LyricActions)
      break
    case 'get_analyser_data_array':
      analyserTools.sendDataArray(port)
      break
    // 歌词岛的播放控制（按需加载播放器操作，避免模块循环依赖）
    case 'play_toggle':
      void import('@renderer/core/player/action').then(({ togglePlay }) => { togglePlay() })
      break
    case 'play_prev':
      void import('@renderer/core/player/action').then(({ playPrev }) => playPrev())
      break
    // 歌词岛拖动进度条：data 为目标位置（秒）
    case 'seek':
      if (typeof data == 'number' && Number.isFinite(data) && data >= 0) window.app_event.setProgress(data)
      break
    case 'play_next':
      void import('@renderer/core/player/action').then(({ playNext }) => playNext())
      break
    default:
      break
  }
}
export const init = () => {
  onNewDesktopLyricProcess(({ event, params }) => {
    const kind: LX.DesktopLyric.ClientKind = params == 'island' ? 'island' : 'lyric'
    const [port] = event.ports
    clientPorts.get(kind)?.close()
    clientPorts.set(kind, port)

    port.onmessage = ({ data }) => {
      handleDesktopLyricMessage(data.action, port, data.data)
    }

    port.onmessageerror = (event) => {
      console.log('onmessageerror', event)
    }
  })
}

/**
 * 歌词偏移已写进歌词原文的 [offset:] 标签（播放详情页菜单负责改写）：
 * 主窗口的歌词数据随之更新，这里把新原文发给客户端并重新同步位置。
 */
export const setLyricOffset = (_offset?: number) => {
  setLyric()
}

export const setPlaybackRate = (_rate: number) => {
  if (isPlay.value) setTimeout(() => { playAt(getCurrentTime()) })
}

export const setLyric = () => {
  if (!musicInfo.id) return
  if (musicInfo.lrc) {
    sendDesktopLyricInfo({
      action: 'set_lyric',
      data: {
        lrc: musicInfo.lrc,
        tlrc: musicInfo.tlrc,
        rlrc: musicInfo.rlrc,
        lxlrc: musicInfo.lxlrc,
      },
    })
  }
  // 播放器状态（托盘 / 开放 API）在 lyricUpdated 时会清空当前行文本：
  // 等所有 lyricUpdated 处理完再重新发出当前行（清掉去重记录，即使行没变也要发）
  setTimeout(() => {
    lastKey = ''
    if (isPlay.value) playAt(getCurrentTime())
    else retrack()
  })
}

export const play = () => {
  playAt(getCurrentTime())
}

export const pause = () => {
  stopDriftCheck()
  clearTick()
  sendDesktopLyricInfo({ action: 'set_pause' })
  // 暂停时按停下的位置更新一次当前行（跳转后暂停也能显示正确的行）
  tick()
}

export const stop = () => {
  stopDriftCheck()
  clearTick()
  lastKey = ''
  sendDesktopLyricInfo({ action: 'set_stop' })
  setText('', 0)
  setStatusText('')
}

export const sendInfo = () => {
  sendDesktopLyricInfo(buildInfo())
}
