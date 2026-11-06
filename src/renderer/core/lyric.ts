import Lyric from '@common/utils/lyric-font-player'
import { getAnalyser, getCurrentTime as getPlayerCurrentTime } from '@renderer/plugins/player'
import { lyric, setLines, setOffset, setTempOffset, setText } from '@renderer/store/player/lyric'
import { isPlay, musicInfo } from '@renderer/store/player/state'
import { setStatusText } from '@renderer/store/player/action'
import { markRawList, watch } from '@common/utils/vueTools'
import { vst3Runtime } from '@renderer/plugins/player/vst3'
import { appSetting } from '@renderer/store/setting'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'
import { onNewDesktopLyricProcess } from '@renderer/utils/ipc'
import { createLyricDriftGuard } from './lyricDriftGuard'

/** 播放器当前时间（毫秒，已扣除 VST3 处理延迟） */
export const getCurrentTime = () => {
  const delay = vst3Runtime.active && appSetting['player.playEngine'] === 'electron' && !isBiliVideoActive()
    ? (vst3Runtime.latencyMs + vst3Runtime.bridgeMs) * appSetting['player.playbackRate'] : 0
  return Math.max(0, getPlayerCurrentTime() * 1000 - delay)
}

let lrc: Lyric

// 歌词时钟漂移防护：播放器卡住（MPV 不上报 waiting）时暂停歌词，恢复后按真实时间继续，偏差过大时重新对齐
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
  if (!lrc || !isPlay.value) {
    stopDriftCheck()
    return
  }
  const time = getCurrentTime()
  switch (driftGuard.check(time, performance.now())) {
    case 'stall':
      lrc.pause()
      sendDesktopLyricInfo({ action: 'set_pause' })
      break
    case 'resume':
    case 'resync':
      lrc.play(time)
      sendDesktopLyricInfo({ action: 'set_play', data: time })
      break
    default:
      break
  }
}
/** 从 time 开始播放歌词，并以此为基准检查漂移 */
const playLyricAt = (time: number) => {
  lrc.play(time)
  driftGuard.start(time, performance.now(), appSetting['player.playbackRate'])
  driftTimer ??= setInterval(checkDrift, DRIFT_CHECK_INTERVAL)
}
watch(() => [vst3Runtime.active, vst3Runtime.latencyMs, vst3Runtime.bridgeMs], () => {
  if (!lrc || !isPlay.value) return
  const time = getCurrentTime()
  playLyricAt(time)
  sendDesktopLyricInfo({ action: 'set_play', data: time })
})
let desktopLyricPort: Electron.IpcRendererEvent['ports'][0] | null = null
const analyserTools: {
  dataArray: Uint8Array
  bufferLength: number
  analyser: AnalyserNode | null
  sendDataArray: () => void
} = {
  dataArray: new Uint8Array(),
  bufferLength: 0,
  analyser: null,
  sendDataArray() {
    if (this.analyser == null) {
      this.analyser = getAnalyser()
      // console.log(this.analyser)
      if (!this.analyser) return
      this.bufferLength = this.analyser.frequencyBinCount
    }
    const dataArray = new Uint8Array(this.bufferLength)
    this.analyser.getByteFrequencyData(dataArray)
    sendDesktopLyricInfo({
      action: 'send_analyser_data_array',
      data: dataArray,
    }, [dataArray.buffer])
  },
}

export const sendDesktopLyricInfo = (info: LX.DesktopLyric.LyricActions, transferList?: Transferable[]) => {
  if (desktopLyricPort == null) return
  if (transferList) desktopLyricPort.postMessage(info, transferList)
  else desktopLyricPort.postMessage(info)
}
const handleDesktopLyricMessage = (action: LX.DesktopLyric.WinMainActions) => {
  switch (action) {
    case 'get_info':
      sendDesktopLyricInfo({
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
          // pic: musicInfo.pic,
          isPlay: isPlay.value,
          line: lyric.line,
          played_time: getCurrentTime(),
        },
      })
      break
    case 'get_status':
      sendDesktopLyricInfo({
        action: 'set_status',
        data: {
          isPlay: isPlay.value,
          line: lyric.line,
          played_time: getCurrentTime(),
        },
      })
      break
    case 'get_analyser_data_array':
      analyserTools.sendDataArray()
      break
    default:
      break
  }
}
export const init = () => {
  lrc = new Lyric({
    shadowContent: false,
    onPlay(line, text) {
      setText(text, Math.max(line, 0))
      setStatusText(text)
      window.app_event.lyricLinePlay(text, line)
      // console.log(line, text)
    },
    onSetLyric(lines, offset) { // listening lyrics seting event
      // console.log(lines) // lines is array of all lyric text
      setLines(markRawList([...lines]))
      setText(lines[0] ?? '', 0)
      setOffset(offset) // 歌词延迟
      setTempOffset(0) // 重置临时延迟
    },
    onUpdateLyric(lines) {
      setLines(markRawList([...lines]))
      setText(lines[0] ?? '', 0)
    },
    rate: appSetting['player.playbackRate'],
    // offset: 80,
  })

  onNewDesktopLyricProcess(({ event }) => {
    console.log('onNewDesktopLyricProcess')
    const [port] = event.ports
    desktopLyricPort = port

    port.onmessage = ({ data }) => {
      handleDesktopLyricMessage(data.action)
      // The event data can be any serializable object (and the event could even
      // carry other MessagePorts with it!)
      // const result = doWork(event.data)
      // port.postMessage(result)
    }

    port.onmessageerror = (event) => {
      console.log('onmessageerror', event)
    }
  })
}

export const setLyricOffset = (offset: number) => {
  const tempOffset = offset - lyric.offset
  setTempOffset(tempOffset)
  lrc.setOffset(tempOffset)
  sendDesktopLyricInfo({
    action: 'set_offset',
    data: tempOffset,
  })

  if (isPlay.value) {
    setTimeout(() => {
      const time = getCurrentTime()
      sendDesktopLyricInfo({
        action: 'set_play',
        data: time,
      })
      playLyricAt(time)
    })
  }
}

export const setPlaybackRate = (rate: number) => {
  lrc.setPlaybackRate(rate)

  if (isPlay.value) {
    setTimeout(() => {
      const time = getCurrentTime()
      playLyricAt(time)
    })
  }
}

export const setLyric = () => {
  if (!musicInfo.id) return
  if (musicInfo.lrc) {
    const extendedLyrics = []
    if (appSetting['player.isShowLyricRoma'] && musicInfo.rlrc) extendedLyrics.push(musicInfo.rlrc)
    if (appSetting['player.isShowLyricTranslation'] && musicInfo.tlrc) extendedLyrics.push(musicInfo.tlrc)
    if (appSetting['player.isSwapLyricTranslationAndRoma']) extendedLyrics.reverse()

    lrc.setLyric(
      appSetting['player.isPlayLxlrc'] && musicInfo.lxlrc ? musicInfo.lxlrc : musicInfo.lrc,
      extendedLyrics,
    )
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

  if (isPlay.value) {
    setTimeout(() => {
      const time = getCurrentTime()
      sendDesktopLyricInfo({ action: 'set_play', data: time })
      playLyricAt(time)
    })
  }
}

export const setDisabledAutoPause = (disabledAutoPause: boolean) => {
  lrc.setDisabledAutoPause(disabledAutoPause)
}

let sources = new Map<string, boolean>()
let prevDisabled = false
export const setDisableAutoPauseBySource = (disabled: boolean, source: string) => {
  sources.set(source, disabled)
  const currentDisabled = Array.from(sources.values()).some(e => e)
  if (prevDisabled == currentDisabled) return
  prevDisabled = currentDisabled
  setDisabledAutoPause(currentDisabled)
}


export const play = () => {
  // if (!musicInfo.lrc) return
  const currentTime = getCurrentTime()
  playLyricAt(currentTime)
  sendDesktopLyricInfo({ action: 'set_play', data: currentTime })
}

export const pause = () => {
  stopDriftCheck()
  lrc.pause()
  sendDesktopLyricInfo({ action: 'set_pause' })
}

export const stop = () => {
  stopDriftCheck()
  lrc.setLyric('')
  sendDesktopLyricInfo({ action: 'set_stop' })
  // setLines([])
  setText('', 0)
}

export const sendInfo = () => {
  sendDesktopLyricInfo({
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
      // pic: musicInfo.pic,
      isPlay: isPlay.value,
      line: lyric.line,
      played_time: getCurrentTime(),
    },
  })
}
