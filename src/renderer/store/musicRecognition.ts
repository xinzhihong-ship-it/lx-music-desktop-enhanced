import { reactive } from '@common/utils/vueTools'
import {
  clearMusicRecognitionHistory,
  getMusicRecognitionConfig,
  getMusicRecognitionSnapshot,
  onMusicRecognitionStatus,
  recognizeMusicFromMic,
  removeMusicRecognitionHistory,
  setMusicRecognitionConfig,
  startMusicRecognition,
  stopMusicRecognition,
} from '@renderer/utils/ipc'
import {
  MicCancelledError,
  MicPermissionError,
  startMicCapture,
  type MicCaptureHandle,
} from '@renderer/views/MusicRecognition/micCapture'
import { isMac, isWin } from '@common/utils'
import {
  SystemAudioCancelledError,
  SystemNoAudioError,
  startSystemAudioCapture,
  type SystemAudioCaptureHandle,
} from '@renderer/views/MusicRecognition/systemAudioCapture'

export const musicRecognition = reactive<LX.MusicRecognition.Snapshot>({
  status: 'idle',
  history: [],
})

const applySnapshot = (snapshot: LX.MusicRecognition.Snapshot) => {
  Object.assign(musicRecognition, snapshot)
}

export const acrcloudConfig = reactive<LX.MusicRecognition.AcrcloudConfig>({
  enabled: false,
  host: '',
  accessKey: '',
  accessSecret: '',
})

export const loadAcrcloudConfig = async() => {
  Object.assign(acrcloudConfig, await getMusicRecognitionConfig())
}

export const saveAcrcloudConfig = async(config: LX.MusicRecognition.AcrcloudConfig) => {
  Object.assign(acrcloudConfig, await setMusicRecognitionConfig(config))
}

const isBusyStatus = (status: LX.MusicRecognition.Status) => ['requestingPermission', 'capturing', 'recognizing'].includes(status)

let unsubscribeStatus: (() => void) | null = null
let micCaptureHandle: MicCaptureHandle | null = null
let systemCaptureHandle: SystemAudioCaptureHandle | null = null

export const initMusicRecognition = async() => {
  unsubscribeStatus ??= onMusicRecognitionStatus(applySnapshot)
  applySnapshot(await getMusicRecognitionSnapshot())
}

export const startRecognition = async() => {
  applySnapshot(await startMusicRecognition())
}

export const startMicRecognition = async() => {
  if (isBusyStatus(musicRecognition.status)) return
  Object.assign(musicRecognition, { status: 'requestingPermission', error: undefined, result: undefined, alternatives: undefined, captureProgress: 0 })
  const handle = startMicCapture(progress => {
    Object.assign(musicRecognition, { status: 'capturing', captureProgress: progress })
  })
  micCaptureHandle = handle
  try {
    const pcm = await handle.promise
    applySnapshot(await recognizeMusicFromMic(pcm))
  } catch (err) {
    if (err instanceof MicCancelledError) {
      Object.assign(musicRecognition, { status: 'idle', error: undefined, captureProgress: undefined })
      return
    }
    if (err instanceof MicPermissionError) {
      Object.assign(musicRecognition, {
        status: 'permissionDenied',
        error: '麦克风权限被拒绝，请在系统设置的“隐私与安全性 > 麦克风”中允许 LX Music',
        captureProgress: undefined,
      })
      return
    }
    Object.assign(musicRecognition, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      captureProgress: undefined,
    })
  }
}

// 系统音频识别按平台分流：macOS 走主进程 audiotee，Windows 走渲染进程 loopback，
// 其他平台（Linux）不支持系统音频采集，直接落到 unsupported 状态
export const startSystemRecognition = async() => {
  if (isMac) return startRecognition()
  if (!isWin) {
    Object.assign(musicRecognition, { status: 'unsupported' })
    return
  }
  if (isBusyStatus(musicRecognition.status)) return
  Object.assign(musicRecognition, { status: 'requestingPermission', error: undefined, result: undefined, alternatives: undefined, captureProgress: 0 })
  const handle = startSystemAudioCapture(progress => {
    Object.assign(musicRecognition, { status: 'capturing', captureProgress: progress })
  })
  systemCaptureHandle = handle
  try {
    const pcm = await handle.promise
    applySnapshot(await recognizeMusicFromMic(pcm))
  } catch (err) {
    if (err instanceof SystemAudioCancelledError) {
      Object.assign(musicRecognition, { status: 'idle', error: undefined, captureProgress: undefined })
      return
    }
    if (err instanceof SystemNoAudioError) {
      Object.assign(musicRecognition, { status: 'noAudio', error: err.message, captureProgress: undefined })
      return
    }
    Object.assign(musicRecognition, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      captureProgress: undefined,
    })
  } finally {
    systemCaptureHandle = null
  }
}

export const stopRecognition = async() => {
  micCaptureHandle?.stop()
  micCaptureHandle = null
  systemCaptureHandle?.stop()
  systemCaptureHandle = null
  await stopMusicRecognition()
}

export const clearRecognitionHistory = async() => {
  applySnapshot(await clearMusicRecognitionHistory())
}

export const removeRecognitionHistoryItem = async(id: string) => {
  applySnapshot(await removeMusicRecognitionHistory(id))
}
