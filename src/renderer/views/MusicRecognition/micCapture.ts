// 麦克风采集：getUserMedia -> AudioContext -> 16kHz 单声道 Int16 PCM
// 采集到的 PCM 通过 IPC 交给主进程走与系统音频相同的 Shazam 识别流程

const TARGET_SECONDS = 12
const TARGET_SAMPLE_RATE = 16000

export class MicCancelledError extends Error {
  constructor() {
    super('mic capture cancelled')
    this.name = 'MicCancelledError'
  }
}

export class MicPermissionError extends Error {}
export class MicUnavailableError extends Error {}

export interface MicCaptureHandle {
  promise: Promise<Uint8Array>
  stop: () => void
}

export const resampleTo16kInt16 = (samples: Float32Array, sourceRate: number): Uint8Array => {
  const ratio = sourceRate / TARGET_SAMPLE_RATE
  const outLength = Math.max(Math.floor(samples.length / ratio), 1)
  const out = new Int16Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const fraction = position - index
    const current = samples[index] ?? 0
    const next = samples[index + 1] ?? current
    const value = current + (next - current) * fraction
    out[i] = Math.max(-32768, Math.min(32767, Math.round(value * 32768)))
  }
  return new Uint8Array(out.buffer)
}

export const startMicCapture = (onProgress: (progress: number) => void): MicCaptureHandle => {
  let cancel: (() => void) | null = null
  let stopRequested = false

  const promise = (async(): Promise<Uint8Array> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicUnavailableError('当前环境不支持麦克风采集')
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    } catch (err) {
      throw new MicPermissionError(err instanceof Error ? err.message : '无法访问麦克风')
    }
    if (stopRequested) {
      for (const track of stream.getTracks()) track.stop()
      throw new MicCancelledError()
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
      for (const track of stream.getTracks()) track.stop()
      void audioContext.close()
      resolveDone?.()
    }

    cancel = () => {
      cancelled = true
      finish()
    }

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
    if (cancelled) throw new MicCancelledError()

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (totalLength === 0) throw new MicCancelledError()
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return resampleTo16kInt16(merged, audioContext.sampleRate)
  })()

  return {
    promise,
    stop: () => {
      stopRequested = true
      cancel?.()
    },
  }
}
