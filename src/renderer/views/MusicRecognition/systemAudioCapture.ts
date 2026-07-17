// Windows 系统音频采集：getDisplayMedia(loopback) -> AudioContext -> 16kHz 单声道 Int16 PCM
// 产出的 PCM 与麦克风采集同格式，经 IPC 交给主进程走相同的 Shazam/ACRCloud 识别流程。
// 依赖主进程在 win32 下注册的 setDisplayMediaRequestHandler（audio: 'loopback'）。

import { resampleTo16kInt16 } from './micCapture'

const TARGET_SECONDS = 12
// 与主进程 capture.ts 的 hasAudibleSignal 阈值一致
const RMS_THRESHOLD = 32

export class SystemAudioCancelledError extends Error {
  constructor() {
    super('system audio capture cancelled')
    this.name = 'SystemAudioCancelledError'
  }
}

export class SystemAudioUnavailableError extends Error {}
export class SystemNoAudioError extends Error {}

export interface SystemAudioCaptureHandle {
  promise: Promise<Uint8Array>
  stop: () => void
}

const hasAudibleSignal = (pcm: Uint8Array): boolean => {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  let energy = 0
  for (const sample of samples) energy += sample * sample
  return Math.sqrt(energy / Math.max(samples.length, 1)) >= RMS_THRESHOLD
}

export const startSystemAudioCapture = (onProgress: (progress: number) => void): SystemAudioCaptureHandle => {
  let cancel: (() => void) | null = null
  let stopRequested = false

  const promise = (async(): Promise<Uint8Array> => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new SystemAudioUnavailableError('当前环境不支持系统音频采集')
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    } catch (err) {
      throw new SystemAudioUnavailableError(err instanceof Error ? err.message : '无法采集系统音频')
    }

    const stopAllTracks = () => {
      for (const track of stream.getTracks()) track.stop()
    }

    if (stopRequested) {
      stopAllTracks()
      throw new SystemAudioCancelledError()
    }

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      stopAllTracks()
      throw new SystemAudioUnavailableError('无法采集系统音频（未检测到系统播放设备）')
    }
    // 只留音轨：视频轨立即停掉并移除
    for (const track of stream.getVideoTracks()) {
      track.stop()
      stream.removeTrack(track)
    }

    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    const targetSamples = TARGET_SECONDS * audioContext.sampleRate
    let totalSamples = 0
    let finished = false
    let cancelled = false
    let resolveDone: (() => void) | null = null
    const done = new Promise<void>(resolve => {
      resolveDone = resolve
    })

    const finish = () => {
      if (finished) return
      finished = true
      processor.onaudioprocess = null
      processor.disconnect()
      source.disconnect()
      stopAllTracks()
      void audioContext.close()
      resolveDone?.()
    }

    cancel = () => {
      cancelled = true
      finish()
    }

    // 系统停止播放或共享中断时音轨会 ended，提前收尾而不是干等
    audioTracks[0].addEventListener('ended', finish)

    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(input))
      totalSamples += input.length
      onProgress(Math.min(totalSamples / targetSamples, 1))
      if (totalSamples >= targetSamples) finish()
    }

    source.connect(processor)
    // ScriptProcessorNode 需要接入输出才会持续触发 onaudioprocess
    processor.connect(audioContext.destination)

    await done
    if (cancelled) throw new SystemAudioCancelledError()

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (totalLength === 0) throw new SystemAudioCancelledError()
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    const pcm = resampleTo16kInt16(merged, audioContext.sampleRate)
    if (!hasAudibleSignal(pcm)) {
      throw new SystemNoAudioError('未采集到系统声音，请确认正在播放歌曲')
    }
    return pcm
  })()

  return {
    promise,
    stop: () => {
      stopRequested = true
      cancel?.()
    },
  }
}
