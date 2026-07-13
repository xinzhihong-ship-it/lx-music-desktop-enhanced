import { captureSystemAudio, CaptureCancelledError, CaptureNoAudioError, CapturePermissionError, isMusicRecognitionSupported, stopCapture } from './capture'
import { recognizePcm, RecognitionNetworkError } from './recognizer'
import { recognizeAcrcloud } from './acrcloud'
import { getAcrcloudConfig, setAcrcloudConfig } from './configStore'
import { addHistory, clearHistory, getHistory, removeHistory } from './historyStore'

const MAX_ALTERNATIVES = 5

// 跨引擎去重：同一首歌可能被两个引擎同时识别出来
const dedupeKey = (result: LX.MusicRecognition.Result): string => {
  return `${result.title.trim().toLowerCase()}|${result.artist.trim().toLowerCase()}`
}

let recognitionController: AbortController | null = null
let snapshot: LX.MusicRecognition.Snapshot = {
  status: isMusicRecognitionSupported() ? 'idle' : 'unsupported',
  history: [],
}

const updateSnapshot = (
  patch: Partial<LX.MusicRecognition.Snapshot>,
  onStatus?: (snapshot: LX.MusicRecognition.Snapshot) => void,
) => {
  snapshot = { ...snapshot, ...patch, history: getHistory() }
  onStatus?.(snapshot)
  return snapshot
}

export const getSnapshot = (): LX.MusicRecognition.Snapshot => {
  return updateSnapshot({})
}

const releaseController = (controller: AbortController) => {
  if (recognitionController === controller) recognitionController = null
}

const handleRecognitionError = (
  err: unknown,
  controller: AbortController,
  onStatus: (snapshot: LX.MusicRecognition.Snapshot) => void,
) => {
  if (err instanceof CaptureCancelledError || controller.signal.aborted) {
    return updateSnapshot({ status: 'idle', error: undefined, captureProgress: undefined }, onStatus)
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof CapturePermissionError) return updateSnapshot({ status: 'permissionDenied', error: message, captureProgress: undefined }, onStatus)
  if (err instanceof CaptureNoAudioError) return updateSnapshot({ status: 'noAudio', error: message, captureProgress: undefined }, onStatus)
  if (err instanceof RecognitionNetworkError) return updateSnapshot({ status: 'networkError', error: message, captureProgress: undefined }, onStatus)
  return updateSnapshot({ status: 'error', error: message, captureProgress: undefined }, onStatus)
}

const runRecognition = async(
  pcm: Buffer,
  controller: AbortController,
  onStatus: (snapshot: LX.MusicRecognition.Snapshot) => void,
) => {
  updateSnapshot({ status: 'recognizing', captureProgress: 1, alternatives: undefined }, onStatus)
  const [shazamOutput, acrcloudResults] = await Promise.all([
    recognizePcm(pcm, controller.signal),
    recognizeAcrcloud(pcm, getAcrcloudConfig(), controller.signal),
  ])
  const match = shazamOutput.match ?? acrcloudResults[0] ?? null
  if (!match) return updateSnapshot({ status: 'notMatched', result: undefined, alternatives: undefined }, onStatus)

  // 候选合并：Shazam 命中时把 ACRCloud 的独立结果排在前面（更有参考价值），按曲目去重
  const candidates = shazamOutput.match
    ? [...acrcloudResults, ...shazamOutput.alternatives]
    : acrcloudResults.slice(1)
  const seen = new Set([match.providerTrackId, dedupeKey(match)])
  const alternatives: LX.MusicRecognition.Result[] = []
  for (const item of candidates) {
    if (seen.has(item.providerTrackId) || seen.has(dedupeKey(item))) continue
    seen.add(item.providerTrackId)
    seen.add(dedupeKey(item))
    alternatives.push(item)
    if (alternatives.length >= MAX_ALTERNATIVES) break
  }

  addHistory(match)
  return updateSnapshot({ status: 'matched', result: match, alternatives }, onStatus)
}

export const startRecognition = async(
  onStatus: (snapshot: LX.MusicRecognition.Snapshot) => void,
): Promise<LX.MusicRecognition.Snapshot> => {
  if (!isMusicRecognitionSupported()) return updateSnapshot({ status: 'unsupported' }, onStatus)
  if (recognitionController) throw new Error('已有听歌识曲任务正在运行')
  const controller = new AbortController()
  recognitionController = controller
  updateSnapshot({ status: 'requestingPermission', error: undefined, result: undefined, alternatives: undefined, captureProgress: 0 }, onStatus)

  try {
    const pcm = await captureSystemAudio(progress => {
      updateSnapshot({ status: 'capturing', captureProgress: progress }, onStatus)
    })
    return await runRecognition(pcm, controller, onStatus)
  } catch (err) {
    return handleRecognitionError(err, controller, onStatus)
  } finally {
    releaseController(controller)
  }
}

export const recognizeMicPcm = async(
  pcm: Buffer,
  onStatus: (snapshot: LX.MusicRecognition.Snapshot) => void,
): Promise<LX.MusicRecognition.Snapshot> => {
  if (recognitionController) throw new Error('已有听歌识曲任务正在运行')
  const controller = new AbortController()
  recognitionController = controller

  try {
    return await runRecognition(pcm, controller, onStatus)
  } catch (err) {
    return handleRecognitionError(err, controller, onStatus)
  } finally {
    releaseController(controller)
  }
}

export const stopRecognition = () => {
  stopCapture()
  recognitionController?.abort()
}

export const clearRecognitionHistory = (): LX.MusicRecognition.Snapshot => {
  clearHistory()
  return updateSnapshot({ result: undefined })
}

export const removeRecognitionHistoryItem = (id: string): LX.MusicRecognition.Snapshot => {
  removeHistory(id)
  return updateSnapshot({})
}

export const getRecognitionConfig = (): LX.MusicRecognition.AcrcloudConfig => {
  return getAcrcloudConfig()
}

export const setRecognitionConfig = (config: LX.MusicRecognition.AcrcloudConfig): LX.MusicRecognition.AcrcloudConfig => {
  return setAcrcloudConfig(config)
}
