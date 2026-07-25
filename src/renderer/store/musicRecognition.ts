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
import { searchRecognitionPlatformMatches } from '@renderer/core/music/recognitionSearch'
import { isPlay, playMusicInfo } from '@renderer/store/player/state'

export const musicRecognition = reactive<LX.MusicRecognition.Snapshot>({
  status: 'idle',
  history: [],
})

let recognitionGeneration = 0
let enrichmentKey: string | null = null
const enrichmentPromises = new Map<string, Promise<void>>()
const completedEnrichments = new Map<string, LX.MusicRecognition.Result[]>()

const resultKey = (result: LX.MusicRecognition.Result) => `${result.id}:${result.recognizedAt}`
const candidateKey = (result: LX.MusicRecognition.Result) => `${result.provider}:${result.providerTrackId}`

const mergeCandidates = (
  result: LX.MusicRecognition.Result,
  ...candidateGroups: Array<LX.MusicRecognition.Result[] | undefined>
) => {
  const seen = new Set([candidateKey(result)])
  return candidateGroups.flatMap(candidates => candidates ?? []).filter(candidate => {
    const key = candidateKey(candidate)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const beginRecognitionAttempt = () => {
  recognitionGeneration++
  enrichmentKey = null
  enrichmentPromises.clear()
  completedEnrichments.clear()
  return recognitionGeneration
}

const applySnapshot = (snapshot: LX.MusicRecognition.Snapshot) => {
  const result = snapshot.status === 'matched' ? snapshot.result : undefined
  if (!result) {
    enrichmentKey = null
    Object.assign(musicRecognition, snapshot)
    return
  }

  const key = resultKey(result)
  const currentKey = musicRecognition.status === 'matched' && musicRecognition.result
    ? resultKey(musicRecognition.result)
    : null
  const alternatives = mergeCandidates(
    result,
    snapshot.alternatives,
    currentKey === key ? musicRecognition.alternatives : undefined,
    completedEnrichments.get(key),
  )
  Object.assign(musicRecognition, snapshot, { alternatives })
  enrichmentKey = key

  if (enrichmentPromises.has(key)) return

  const generation = recognitionGeneration
  const resultId = result.id
  const promise = searchRecognitionPlatformMatches(result)
    .then(platformMatches => {
      if (
        recognitionGeneration !== generation ||
        enrichmentKey !== key ||
        musicRecognition.status !== 'matched' ||
        musicRecognition.result?.id !== resultId ||
        resultKey(musicRecognition.result) !== key
      ) return

      const mergedAlternatives = mergeCandidates(result, musicRecognition.alternatives, platformMatches)
      completedEnrichments.set(key, mergedAlternatives)
      musicRecognition.alternatives = mergedAlternatives
    })
    .catch(error => {
      console.warn('[music recognition] platform match enrichment unavailable:', error)
    })
  enrichmentPromises.set(key, promise)
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

const getCurrentPlayingHint = (): LX.MusicRecognition.RecognitionHint | undefined => {
  if (!isPlay.value || !playMusicInfo.musicInfo) return
  const current = playMusicInfo.musicInfo
  const info = 'metadata' in current ? current.metadata.musicInfo : current
  const title = info.name.trim()
  const artist = info.singer.trim()
  if (!title || !artist) return

  let provider: LX.MusicRecognition.RecognitionHint['provider']
  switch (info.source) {
    case 'kg':
    case 'wy':
    case 'tx':
      provider = info.source
      break
  }

  return {
    title,
    artist,
    album: info.meta.albumName || undefined,
    coverUrl: info.meta.picUrl || undefined,
    provider,
    providerTrackId: provider ? `${provider}:${String(info.meta.songId)}` : undefined,
  }
}

let unsubscribeStatus: (() => void) | null = null
let micCaptureHandle: MicCaptureHandle | null = null
let systemCaptureHandle: SystemAudioCaptureHandle | null = null

export const initMusicRecognition = async() => {
  unsubscribeStatus ??= onMusicRecognitionStatus(applySnapshot)
  applySnapshot(await getMusicRecognitionSnapshot())
}

export const startRecognition = async() => {
  const generation = beginRecognitionAttempt()
  const snapshot = await startMusicRecognition(getCurrentPlayingHint())
  if (recognitionGeneration === generation) applySnapshot(snapshot)
}

export const startMicRecognition = async() => {
  if (isBusyStatus(musicRecognition.status)) return
  const generation = beginRecognitionAttempt()
  Object.assign(musicRecognition, { status: 'requestingPermission', error: undefined, result: undefined, alternatives: undefined, captureProgress: 0 })
  const handle = startMicCapture(progress => {
    if (recognitionGeneration === generation) {
      Object.assign(musicRecognition, { status: 'capturing', captureProgress: progress })
    }
  })
  micCaptureHandle = handle
  try {
    const pcm = await handle.promise
    const snapshot = await recognizeMusicFromMic(pcm)
    if (recognitionGeneration === generation) applySnapshot(snapshot)
  } catch (err) {
    if (recognitionGeneration !== generation) return
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
    beginRecognitionAttempt()
    Object.assign(musicRecognition, { status: 'unsupported' })
    return
  }
  if (isBusyStatus(musicRecognition.status)) return
  const generation = beginRecognitionAttempt()
  const hint = getCurrentPlayingHint()
  Object.assign(musicRecognition, { status: 'requestingPermission', error: undefined, result: undefined, alternatives: undefined, captureProgress: 0 })
  const handle = startSystemAudioCapture(progress => {
    if (recognitionGeneration === generation) {
      Object.assign(musicRecognition, { status: 'capturing', captureProgress: progress })
    }
  })
  systemCaptureHandle = handle
  try {
    const pcm = await handle.promise
    const snapshot = await recognizeMusicFromMic(pcm, hint)
    if (recognitionGeneration === generation) applySnapshot(snapshot)
  } catch (err) {
    if (recognitionGeneration !== generation) return
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
    if (systemCaptureHandle === handle) systemCaptureHandle = null
  }
}

export const stopRecognition = async() => {
  beginRecognitionAttempt()
  micCaptureHandle?.stop()
  micCaptureHandle = null
  systemCaptureHandle?.stop()
  systemCaptureHandle = null
  await stopMusicRecognition()
}

export const clearRecognitionHistory = async() => {
  const generation = beginRecognitionAttempt()
  const snapshot = await clearMusicRecognitionHistory()
  if (recognitionGeneration === generation) applySnapshot(snapshot)
}

export const removeRecognitionHistoryItem = async(id: string) => {
  applySnapshot(await removeMusicRecognitionHistory(id))
}
