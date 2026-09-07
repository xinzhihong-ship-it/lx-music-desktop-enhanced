export interface AudioSinkTarget {
  setSinkId: (id: string) => Promise<void>
}

export const normalizeSinkId = (deviceId: string) => deviceId || 'default'

export interface AudioRoutingState {
  captured: boolean
  audio: AudioSinkTarget | null
  outputPipe: AudioSinkTarget | null
}

export const createRoutingQueue = () => {
  let pending = Promise.resolve()
  const latestGenerations = new Map<string, number>()

  const enqueue = async(task: () => Promise<void>) => {
    pending = pending.catch(() => {}).then(task)
    return pending
  }

  const enqueueLatest = async(key: string, task: () => Promise<void>) => {
    const generation = (latestGenerations.get(key) ?? 0) + 1
    latestGenerations.set(key, generation)
    return enqueue(async() => {
      if (latestGenerations.get(key) !== generation) return
      await task()
    })
  }

  return { enqueue, enqueueLatest }
}

export const applyOutputSink = async(state: AudioRoutingState, deviceId: string) => {
  const sinkId = normalizeSinkId(deviceId)
  const target = state.captured ? state.outputPipe : state.audio
  if (state.captured && !target) throw new Error('Audio output pipe is not ready')
  if (!target) return
  if (typeof target.setSinkId !== 'function') {
    throw new Error('Selected output device is not supported by this Electron version')
  }
  try {
    await target.setSinkId(sinkId)
  } catch (err) {
    const error = err as Error
    if (error?.name === 'NotFoundError' || /Requested device not found/i.test(error?.message ?? '')) {
      throw new Error('所选音频输出设备不可用，请在「设置 → 播放 → 音频输出设备」中重新选择当前设备。为避免意外外放，未自动切换到其他设备。')
    }
    throw err
  }
}
