import { captureSystemAudio, CaptureCancelledError, CaptureNoAudioError, CapturePermissionError, isMusicRecognitionSupported, stopCapture } from './capture'
import { recognizePcm, RecognitionNetworkError, type RecognitionOutput } from './recognizer'
import { recognizeAcrcloud } from './acrcloud'
import { recognizeKugou } from './kgRecognizer'
import { recognizeNetease } from './wyRecognizer'
import { getAcrcloudConfig, setAcrcloudConfig } from './configStore'
import { addHistory, clearHistory, getHistory, removeHistory, replaceHistory } from './historyStore'
import { throwIfAborted } from './abort'
import { isAmbiguousRecognition, promoteRecognitionCandidate, selectAlternativeCandidates } from './decision'

const MAX_ALTERNATIVES = 8

const resultKey = (result: LX.MusicRecognition.Result): string => {
  return `${result.provider}:${result.providerTrackId}`
}

const normalizeTitle = (value: string): string => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[（(【[].*?[）)】\]]/g, '')
  .replace(/[^\p{L}\p{N}]/gu, '')

const artistTokens = (value: string): string[] => value
  .normalize('NFKC')
  .toLowerCase()
  .split(/[、,&/，·]|\b(?:feat|ft)\.?\b/u)
  .map(name => name.replace(/[^\p{L}\p{N}]/gu, ''))
  .filter(Boolean)

const isSameTrack = (seed: LX.MusicRecognition.Result, candidate: LX.MusicRecognition.Result): boolean => {
  if (normalizeTitle(seed.title) !== normalizeTitle(candidate.title)) return false
  const seedArtists = artistTokens(seed.artist)
  const candidateArtists = new Set(artistTokens(candidate.artist))
  return seedArtists.length === 0 || candidateArtists.size === 0 || seedArtists.some(artist => candidateArtists.has(artist))
}

const hasSameArtist = (left: string, right: string): boolean => {
  const leftArtists = artistTokens(left)
  const rightArtists = new Set(artistTokens(right))
  return leftArtists.length > 0 && rightArtists.size > 0 && leftArtists.some(artist => rightArtists.has(artist))
}

const createHintResult = (hint: LX.MusicRecognition.RecognitionHint): LX.MusicRecognition.Result | null => {
  if (!hint.provider || !hint.providerTrackId) return null
  const recognizedAt = Date.now()
  return {
    id: `${hint.provider}_${hint.providerTrackId}:${recognizedAt}`,
    title: hint.title,
    artist: hint.artist,
    album: hint.album,
    coverUrl: hint.coverUrl,
    provider: hint.provider,
    providerTrackId: hint.providerTrackId,
    recognizedAt,
  }
}

const selectMatch = (
  defaultMatch: LX.MusicRecognition.Result,
  candidates: LX.MusicRecognition.Result[],
  hint?: LX.MusicRecognition.RecognitionHint,
): LX.MusicRecognition.Result => {
  if (!hint) return defaultMatch

  const exactProviderTrack = hint.providerTrackId
    ? candidates.find(candidate => candidate.providerTrackId === hint.providerTrackId && (!hint.provider || candidate.provider === hint.provider))
    : undefined
  if (exactProviderTrack) return exactProviderTrack

  const titleMatches = candidates.filter(candidate => normalizeTitle(candidate.title) === normalizeTitle(hint.title))
  const metadataMatch = titleMatches.find(candidate => hasSameArtist(candidate.artist, hint.artist))
  if (metadataMatch) return metadataMatch

  // 音频已确认歌曲标题但无法区分翻唱或 Live 版本时，使用播放器持有的平台曲目 ID 消歧。
  return titleMatches.length ? (createHintResult(hint) ?? defaultMatch) : defaultMatch
}

const toOutput = (results: LX.MusicRecognition.Result[]): RecognitionOutput => ({
  match: results[0] ?? null,
  alternatives: results.slice(1),
})

let recognitionController: AbortController | null = null
// 「识曲功能是否可用」（决定 UI 初始状态）：macOS 14.2+ 走 audiotee，Windows 走渲染进程 loopback。
// 注意与 isMusicRecognitionSupported 区分：后者是「主进程能否采集」，仅作 audiotee 路径的门。
const canUseMusicRecognition = (): boolean => isMusicRecognitionSupported() || process.platform === 'win32'
let snapshot: LX.MusicRecognition.Snapshot = {
  status: canUseMusicRecognition() ? 'idle' : 'unsupported',
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
  hint?: LX.MusicRecognition.RecognitionHint,
) => {
  updateSnapshot({ status: 'recognizing', captureProgress: 1, result: undefined, alternatives: undefined, error: undefined, engineReports: undefined }, onStatus)
  const acrcloudConfig = getAcrcloudConfig()
  const engines: Array<{ name: LX.MusicRecognition.Engine, run: () => Promise<RecognitionOutput> }> = [
    {
      name: 'shazam',
      run: async() => await recognizePcm(pcm, controller.signal),
    },
  ]
  if (acrcloudConfig.enabled && acrcloudConfig.host && acrcloudConfig.accessKey && acrcloudConfig.accessSecret) {
    engines.push({
      name: 'acrcloud',
      run: async() => {
        const results = await recognizeAcrcloud(pcm, acrcloudConfig, controller.signal)
        return {
          match: results[0] ?? null,
          alternatives: results.slice(1),
        }
      },
    })
  }
  engines.push(
    {
      name: 'kg',
      run: async() => toOutput(await recognizeKugou(pcm, controller.signal)),
    },
    {
      name: 'wy',
      run: async() => toOutput(await recognizeNetease(pcm, controller.signal)),
    },
  )

  const settled = await Promise.allSettled(engines.map(async({ run }) => await run()))
  throwIfAborted(controller.signal)

  const fulfilled: Array<{ name: LX.MusicRecognition.Engine, output: RecognitionOutput }> = []
  const errors: unknown[] = []
  const engineReports: LX.MusicRecognition.EngineReport[] = []
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      fulfilled.push({ name: engines[index].name, output: result.value })
      engineReports.push({
        engine: engines[index].name,
        status: result.value.match ? 'matched' : 'notMatched',
      })
    } else {
      console.warn(`[music recognition] ${engines[index].name} failed:`, result.reason)
      errors.push(result.reason)
      engineReports.push({
        engine: engines[index].name,
        status: 'error',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  // Shazam 已通过独立片段复验，可信度高于原生平台返回的同名翻唱候选。
  // fulfilled 保持 engines 顺序：Shazam -> ACRCloud（可选）-> 酷狗 -> 网易云。
  const defaultMatch = fulfilled.find(({ output }) => output.match)?.output.match ?? null
  if (!defaultMatch) {
    if (fulfilled.length) {
      return updateSnapshot({ status: 'notMatched', result: undefined, alternatives: undefined, engineReports }, onStatus)
    }
    if (errors.every(error => error instanceof RecognitionNetworkError)) {
      throw new RecognitionNetworkError(errors[0].message)
    }
    const firstNonNetworkError = errors.find((error): error is Error => error instanceof Error && !(error instanceof RecognitionNetworkError))
    if (firstNonNetworkError) throw firstNonNetworkError
    const firstNonNetworkRejection = errors.find(error => !(error instanceof RecognitionNetworkError))
    throw new Error(String(firstNonNetworkRejection))
  }

  // 各平台对同一首歌的命中也保留，便于确认原生识别来源并直接使用平台曲目 ID。
  const candidates = fulfilled.flatMap(({ output }) => [
    ...(output.match ? [output.match] : []),
    ...output.alternatives,
  ])
  const match = selectMatch(defaultMatch, candidates, hint)
  const hintSupportsMatch = !!hint &&
    normalizeTitle(match.title) === normalizeTitle(hint.title) &&
    hasSameArtist(match.artist, hint.artist)
  const matchedEngines = fulfilled
    .filter(({ output }) => output.match)
    .map(({ name }) => name)
  const ambiguous = isAmbiguousRecognition(matchedEngines, hintSupportsMatch)
  if (match !== defaultMatch) {
    console.info('[music recognition] current LX track metadata resolved ambiguous audio match:', {
      audio: `${defaultMatch.artist} - ${defaultMatch.title}`,
      selected: `${match.artist} - ${match.title}`,
      providerTrackId: match.providerTrackId,
    })
  }
  const alternatives = selectAlternativeCandidates(
    match,
    candidates,
    resultKey,
    (selected, candidate) => {
      if (isSameTrack(selected, candidate)) return 0
      if (normalizeTitle(selected.title) === normalizeTitle(candidate.title)) return 1
      return 2
    },
    MAX_ALTERNATIVES,
  )

  const result = ambiguous ? { ...match, confidence: 'possible' as const } : match
  const resolvedAlternatives = alternatives.map(item => ({ ...item, confidence: 'possible' as const }))
  addHistory(result)
  return updateSnapshot({
    status: ambiguous ? 'ambiguous' : 'matched',
    result,
    alternatives: resolvedAlternatives,
    engineReports,
  }, onStatus)
}

export const startRecognition = async(
  onStatus: (snapshot: LX.MusicRecognition.Snapshot) => void,
  hint?: LX.MusicRecognition.RecognitionHint,
): Promise<LX.MusicRecognition.Snapshot> => {
  if (!isMusicRecognitionSupported()) return updateSnapshot({ status: 'unsupported' }, onStatus)
  if (recognitionController) throw new Error('已有听歌识曲任务正在运行')
  const controller = new AbortController()
  recognitionController = controller
  updateSnapshot({ status: 'requestingPermission', error: undefined, result: undefined, alternatives: undefined, captureProgress: 0, engineReports: undefined }, onStatus)

  try {
    const pcm = await captureSystemAudio(progress => {
      updateSnapshot({ status: 'capturing', captureProgress: progress }, onStatus)
    })
    return await runRecognition(pcm, controller, onStatus, hint)
  } catch (err) {
    return handleRecognitionError(err, controller, onStatus)
  } finally {
    releaseController(controller)
  }
}

export const recognizeMicPcm = async(
  pcm: Buffer,
  onStatus: (snapshot: LX.MusicRecognition.Snapshot) => void,
  hint?: LX.MusicRecognition.RecognitionHint,
): Promise<LX.MusicRecognition.Snapshot> => {
  if (recognitionController) throw new Error('已有听歌识曲任务正在运行')
  const controller = new AbortController()
  recognitionController = controller

  try {
    return await runRecognition(pcm, controller, onStatus, hint)
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
  if (snapshot.status !== 'matched' && snapshot.status !== 'ambiguous') return updateSnapshot({})
  return updateSnapshot({
    status: 'idle',
    error: undefined,
    result: undefined,
    alternatives: undefined,
    captureProgress: undefined,
    engineReports: undefined,
  })
}

export const removeRecognitionHistoryItem = (id: string): LX.MusicRecognition.Snapshot => {
  removeHistory(id)
  return updateSnapshot({})
}

export const confirmRecognitionResult = (
  request: LX.MusicRecognition.ConfirmResultRequest,
): LX.MusicRecognition.Snapshot => {
  const current = snapshot.result
  if (!current || current.id !== request.originalId) throw new Error('当前识别结果已发生变化')

  const result = promoteRecognitionCandidate(current, request.result)
  const alternatives = selectAlternativeCandidates(
    result,
    [current, ...(snapshot.alternatives ?? [])],
    resultKey,
    () => 0,
    MAX_ALTERNATIVES,
  ).map(item => ({ ...item, confidence: 'possible' as const }))

  replaceHistory(current.id, result)
  return updateSnapshot({ status: 'matched', result, alternatives, error: undefined })
}

export const getRecognitionConfig = (): LX.MusicRecognition.AcrcloudConfig => {
  return getAcrcloudConfig()
}

export const setRecognitionConfig = (config: LX.MusicRecognition.AcrcloudConfig): LX.MusicRecognition.AcrcloudConfig => {
  return setAcrcloudConfig(config)
}
