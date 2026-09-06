import { appSetting } from '@renderer/store/setting'
import * as mpvPlayer from './mpv'
import * as mpvVideoPlayer from './mpvVideo'
import * as audirvanaPlayer from './audirvana'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'
import { watch } from '@common/utils/vueTools'
import { createVst3Node, configureVst3Audio, closeVst3Audio, prepareVst3Audio, resetVst3Audio, vst3Runtime, cleanVst3Error } from './vst3'
import { applyOutputSink, createRoutingQueue } from './routingQueue'

let vst3Node: AudioWorkletNode | null = null
let vst3Change = Promise.resolve()
let playbackRevision = 0
let seekResume = false
const syncVst3 = async() => {
  vst3Change = vst3Change.catch(() => {}).then(async() => {
    await applyAudioRouting()
    const enabled = appSetting['player.vst3.enabled'] && appSetting['player.playEngine'] === 'electron' && !isBiliVideoActive()
    const playing = !!audio && !audio.paused
    if (vst3Node) resetVst3Audio(false)
    if (audio && (vst3Node != null || enabled)) audio.pause()
    if (vst3Node && !enabled) {
      gainNode.disconnect(vst3Node)
      vst3Node = null
      try { await closeVst3Audio() } finally { gainNode.connect(mediaStreamDest!) }
    }
    if (enabled) {
      initAdvancedAudioFeatures()
      try {
        if (vst3Node) await configureVst3Audio(audioContext)
        else {
          const next = await createVst3Node(audioContext, () => {
            audio?.pause()
            window.app_event.pause()
          })
          gainNode.disconnect(mediaStreamDest!)
          gainNode.connect(next)
          next.connect(mediaStreamDest!)
          // eslint-disable-next-line require-atomic-updates -- Connection changes are serialized by vst3Change.
          vst3Node = next
        }
      } catch (err) {
        // 一个坏插件不能卡死播放：丢弃插件链，回退直通输出并继续播放。
        vst3Runtime.error = cleanVst3Error(err)
        if (vst3Node) {
          try { gainNode.disconnect(vst3Node) } catch {}
          try { vst3Node.disconnect() } catch {}
          // eslint-disable-next-line require-atomic-updates -- Connection changes are serialized by vst3Change.
          vst3Node = null
        }
        try { await closeVst3Audio() } catch {}
        gainNode.connect(mediaStreamDest!)
      }
    }
    if (playing) {
      if (vst3Node && !await prepareVst3Audio()) return
      await audio?.play()
    }
  })
  return vst3Change
}

watch(() => [appSetting['player.vst3.enabled'], appSetting['player.vst3.chain'], appSetting['player.playEngine'], isBiliVideoActive()], () => {
  void syncVst3().catch((err: Error) => {
    // 切换失败不暂停播放，仅记录错误；音频保持直通输出。
    vst3Runtime.error = cleanVst3Error(err)
  })
}, { deep: true })

watch(() => appSetting['player.audioVisualization'], () => {
  void applyAudioRouting().catch((err: Error) => {
    console.error('audio visualization routing change failed:', err?.message ?? err)
  })
})

interface HTMLAudioElementChrome extends HTMLAudioElement {
  setSinkId: (id: string) => Promise<void>
}
let audio: HTMLAudioElementChrome | null = null
let audioContext: AudioContext
let mediaSource: MediaElementAudioSourceNode | null = null
// 当前 audio 元素是否已被 WebAudio 图捕获（capture 不可逆，切换模式只能重建元素）
let elementCaptured = false
const routingQueue = createRoutingQueue()
let routingChange = Promise.resolve()
// 注册在 audio 元素上的应用事件监听（重建元素时迁移到新元素）
const elementEventListeners: Array<{ event: string, listener: EventListener }> = []
// 效果处理后的音频经此隐藏元素输出：设备切换用元素级 setSinkId，
// 绕开 AudioContext.setSinkId 在携带媒体源的上下文上永不决议的问题。
let outputPipe: HTMLAudioElementChrome | null = null
// 图的最终输出接入流式目的地（不再走 AudioContext 默认硬件出口），
// 由 outputPipe 播放该流，输出设备完全由 outputPipe 的 sink 决定。
let mediaStreamDest: MediaStreamAudioDestinationNode | null = null
let unsubAudioMediaListChangeEvent: (() => void) | null = null

const normalizeOutputSinkId = (deviceId: string) => deviceId || 'default'
let desiredOutputSinkId = normalizeOutputSinkId(appSetting['player.mediaDeviceId'])
const getDesiredOutputSinkId = () => desiredOutputSinkId || normalizeOutputSinkId(appSetting['player.mediaDeviceId'])

const applyCurrentOutputSink = async(deviceId: string) => {
  await applyOutputSink({
    captured: elementCaptured,
    audio,
    outputPipe,
  }, normalizeOutputSinkId(deviceId))
}

const enqueueRoutingChange = async(task: () => Promise<void>) => {
  routingChange = routingQueue.enqueue(task)
  return routingChange
}

const enqueueLatestRoutingChange = async(key: string, task: () => Promise<void>) => {
  routingChange = routingQueue.enqueueLatest(key, task)
  return routingChange
}

const scheduleCurrentOutputSink = async() => {
  await enqueueLatestRoutingChange('output-sink', async() => {
    await applyCurrentOutputSink(getDesiredOutputSinkId())
  }).catch((err: Error) => {
    console.error('apply output sink failed:', err?.message ?? err)
  })
}
let analyser: AnalyserNode
// https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext
// https://benzleung.gitbooks.io/web-audio-api-mini-guide/content/chapter5-1.html
export const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
type Freqs = (typeof freqs)[number]
let biquads: Map<`hz${Freqs}`, BiquadFilterNode>
export const freqsPreset = [
  { name: 'pop', hz31: 6, hz62: 5, hz125: -3, hz250: -2, hz500: 5, hz1000: 4, hz2000: -4, hz4000: -3, hz8000: 6, hz16000: 4 },
  { name: 'dance', hz31: 4, hz62: 3, hz125: -4, hz250: -6, hz500: 0, hz1000: 0, hz2000: 3, hz4000: 4, hz8000: 4, hz16000: 5 },
  { name: 'rock', hz31: 7, hz62: 6, hz125: 2, hz250: 1, hz500: -3, hz1000: -4, hz2000: 2, hz4000: 1, hz8000: 4, hz16000: 5 },
  { name: 'classical', hz31: 6, hz62: 7, hz125: 1, hz250: 2, hz500: -1, hz1000: 1, hz2000: -4, hz4000: -6, hz8000: -7, hz16000: -8 },
  { name: 'vocal', hz31: -5, hz62: -6, hz125: -4, hz250: -3, hz500: 3, hz1000: 4, hz2000: 5, hz4000: 4, hz8000: -3, hz16000: -3 },
  { name: 'slow', hz31: 5, hz62: 4, hz125: 2, hz250: 0, hz500: -2, hz1000: 0, hz2000: 3, hz4000: 6, hz8000: 7, hz16000: 8 },
  { name: 'electronic', hz31: 6, hz62: 5, hz125: 0, hz250: -5, hz500: -4, hz1000: 0, hz2000: 6, hz4000: 8, hz8000: 8, hz16000: 7 },
  { name: 'subwoofer', hz31: 8, hz62: 7, hz125: 5, hz250: 4, hz500: 0, hz1000: 0, hz2000: 0, hz4000: 0, hz8000: 0, hz16000: 0 },
  { name: 'soft', hz31: -5, hz62: -5, hz125: -4, hz250: -4, hz500: 3, hz1000: 2, hz2000: 4, hz4000: 4, hz8000: 0, hz16000: 0 },
] as const
export const convolutions = [
  { name: 'telephone', mainGain: 0.0, sendGain: 3.0, source: 'filter-telephone.wav' }, // 电话
  { name: 's2_r4_bd', mainGain: 1.8, sendGain: 0.9, source: 's2_r4_bd.wav' }, // 教堂
  { name: 'bright_hall', mainGain: 0.8, sendGain: 2.4, source: 'bright-hall.wav' },
  { name: 'cinema_diningroom', mainGain: 0.6, sendGain: 2.3, source: 'cinema-diningroom.wav' },
  { name: 'dining_living_true_stereo', mainGain: 0.6, sendGain: 1.8, source: 'dining-living-true-stereo.wav' },
  { name: 'living_bedroom_leveled', mainGain: 0.6, sendGain: 2.1, source: 'living-bedroom-leveled.wav' },
  { name: 'spreader50_65ms', mainGain: 1, sendGain: 2.5, source: 'spreader50-65ms.wav' },
  // { name: 'spreader25_125ms', mainGain: 1, sendGain: 2.5, source: 'spreader25-125ms.wav' },
  // { name: 'backslap', mainGain: 1.8, sendGain: 0.8, source: 'backslap1.wav' },
  { name: 's3_r1_bd', mainGain: 1.8, sendGain: 0.8, source: 's3_r1_bd.wav' },
  { name: 'matrix_1', mainGain: 1.5, sendGain: 0.9, source: 'matrix-reverb1.wav' },
  { name: 'matrix_2', mainGain: 1.3, sendGain: 1, source: 'matrix-reverb2.wav' },
  { name: 'cardiod_35_10_spread', mainGain: 1.8, sendGain: 0.6, source: 'cardiod-35-10-spread.wav' },
  { name: 'tim_omni_35_10_magnetic', mainGain: 1, sendGain: 0.2, source: 'tim-omni-35-10-magnetic.wav' },
  // { name: 'spatialized', mainGain: 1.8, sendGain: 0.8, source: 'spatialized8.wav' },
  // { name: 'zing_long_stereo', mainGain: 0.8, sendGain: 1.8, source: 'zing-long-stereo.wav' },
  { name: 'feedback_spring', mainGain: 1.8, sendGain: 0.8, source: 'feedback-spring.wav' },
  // { name: 'tim_omni_rear_blend', mainGain: 1.8, sendGain: 0.8, source: 'tim-omni-rear-blend.wav' },
] as const
// 半音
// export const semitones = [-1.5, -1, -0.5, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] as const

let convolver: ConvolverNode
let convolverSourceGainNode: GainNode
let convolverOutputGainNode: GainNode
let convolverDynamicsCompressor: DynamicsCompressorNode
let gainNode: GainNode
let panner: PannerNode
let pitchShifterNode: AudioWorkletNode
let pitchShifterNodePitchFactor: AudioParam
let pitchShifterNodeLoadStatus: 'none' | 'loading' | 'unconnect' | 'connected' = 'none'
let pitchShifterNodeTempValue = 1
let defaultChannelCount = 2
export const soundR = 0.5


const createAudioElement = (attachRegisteredListeners = true) => {
  const el = new window.Audio() as HTMLAudioElementChrome
  el.controls = false
  el.autoplay = true
  el.preload = 'auto'
  el.crossOrigin = 'anonymous'
  if (attachRegisteredListeners) {
    for (const { event, listener } of elementEventListeners) {
      el.addEventListener(event, listener)
    }
  }

  // https://developer.chrome.com/blog/autoplay
  el.addEventListener('playing', () => {
    if (vst3Node) resetVst3Audio(true)
    if (audioContext?.state == 'suspended') {
      void audioContext.resume().catch((err) => {
        console.error('Resume audio context failed:', err)
      })
    }
  })
  return el
}

export const createAudio = () => {
  if (isAudirvanaEngine()) return
  if (audio) return
  audio = createAudioElement()
}

const initAnalyser = () => {
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 256
}

const initBiquadFilter = () => {
  biquads = new Map()
  let i

  for (const item of freqs) {
    const filter = audioContext.createBiquadFilter()
    biquads.set(`hz${item}`, filter)
    filter.type = 'peaking'
    filter.frequency.value = item
    filter.Q.value = 1.4
    filter.gain.value = 0
  }

  for (i = 1; i < freqs.length; i++) {
    (biquads.get(`hz${freqs[i - 1]}`)!).connect(biquads.get(`hz${freqs[i]}`)!)
  }
}

const initConvolver = () => {
  convolverSourceGainNode = audioContext.createGain()
  convolverOutputGainNode = audioContext.createGain()
  convolverDynamicsCompressor = audioContext.createDynamicsCompressor()
  convolver = audioContext.createConvolver()
  convolver.connect(convolverOutputGainNode)
  convolverSourceGainNode.connect(convolverDynamicsCompressor)
  convolverOutputGainNode.connect(convolverDynamicsCompressor)
}

const initPanner = () => {
  panner = audioContext.createPanner()
}

const initGain = () => {
  gainNode = audioContext.createGain()
}

const createOutputPipe = (stream: MediaStream, start = true) => {
  const pipe = new window.Audio() as HTMLAudioElementChrome
  pipe.controls = false
  pipe.autoplay = start
  pipe.preload = 'auto'
  pipe.srcObject = stream
  if (start) {
    void pipe.play().catch(err => {
      console.error('effect output pipe start failed:', err)
    })
  }
  return pipe
}

// `deferOutputPipe` is used while an audio element is being staged.  It keeps
// the old route authoritative until the new final output has accepted its sink.
const initAdvancedAudioFeatures = (sourceAudio: HTMLAudioElementChrome | null = audio, deferOutputPipe = false) => {
  if (audioContext) return
  if (!sourceAudio) {
    createAudio()
    sourceAudio = audio
  }
  if (!sourceAudio) return
  if (!deferOutputPipe) elementCaptured = true
  audioContext = new window.AudioContext({ latencyHint: 'playback' })
  defaultChannelCount = audioContext.destination.channelCount

  initAnalyser()
  initBiquadFilter()
  initConvolver()
  initPanner()
  initGain()
  updateConvolverCompressor()
  // source -> analyser -> biquadFilter -> pitchShifter -> [(convolver & convolverSource)->convolverDynamicsCompressor] -> panner -> gain
  mediaSource = audioContext.createMediaElementSource(sourceAudio)
  mediaSource.connect(analyser)
  // 最终输出接流式目的地（不走 AudioContext 默认硬件出口），由 outputPipe 播放
  mediaStreamDest = audioContext.createMediaStreamDestination()
  outputPipe = createOutputPipe(mediaStreamDest.stream, !deferOutputPipe)
  analyser.connect(biquads.get(`hz${freqs[0]}`)!)
  const lastBiquadFilter = (biquads.get(`hz${freqs.at(-1)!}`)!)
  lastBiquadFilter.connect(convolverSourceGainNode)
  lastBiquadFilter.connect(convolver)
  convolverDynamicsCompressor.connect(panner)
  panner.connect(gainNode)
  gainNode.connect(mediaStreamDest)

  // 初始化图时设备 watcher 可能尚未完成，立即把当前期望设备提交到最终出口。
  if (!deferOutputPipe) void scheduleCurrentOutputSink()

  // 音频输出设备改变时刷新 audio node 连接
  if (!unsubAudioMediaListChangeEvent) {
    window.app_event.on('playerDeviceChanged', handleMediaListChange)
    unsubAudioMediaListChangeEvent = () => {
      window.app_event.off('playerDeviceChanged', handleMediaListChange)
      unsubAudioMediaListChangeEvent = null
    }
  }

  // audio.addEventListener('playing', connectAudioNode)
  // audio.addEventListener('pause', disconnectAudioNode)
  // audio.addEventListener('waiting', disconnectAudioNode)
  // audio.addEventListener('emptied', disconnectAudioNode)
  // if (!audio.paused) connectAudioNode()
}

const handleMediaListChange = () => {
  if (!mediaSource || !analyser) return
  try { mediaSource.disconnect() } catch {}
  mediaSource.connect(analyser)
}

// let isConnected = true
// const connectAudioNode = () => {
//   if (isConnected) return
//   console.log('connect Node')
//   mediaSource.connect(analyser)
//   isConnected = true
//   if (pitchShifterNodeTempValue == 1 && pitchShifterNodeLoadStatus == 'connected') {
//     disconnectPitchShifterNode()
//   }
// }

// const disconnectAudioNode = () => {
//   if (!isConnected) return
//   console.log('disconnect Node')
//   mediaSource.disconnect()
//   isConnected = false
//   if (pitchShifterNodeTempValue == 1 && pitchShifterNodeLoadStatus == 'connected') {
//     disconnectPitchShifterNode()
//   }
// }

export const getAudioContext = () => {
  initAdvancedAudioFeatures()
  return audioContext
}

let unsubMediaListChangeEvent: (() => void) | null = null
export const setMaxOutputChannelCount = (enable: boolean) => {
  if (enable) {
    initAdvancedAudioFeatures()
    audioContext.destination.channelCountMode = 'max'
    audioContext.destination.channelCount = audioContext.destination.maxChannelCount
    // navigator.mediaDevices.addEventListener('devicechange', handleMediaListChange)
    if (!unsubMediaListChangeEvent) {
      let handleMediaListChange = () => {
        setMaxOutputChannelCount(true)
      }
      window.app_event.on('playerDeviceChanged', handleMediaListChange)
      unsubMediaListChangeEvent = () => {
        window.app_event.off('playerDeviceChanged', handleMediaListChange)
        unsubMediaListChangeEvent = null
      }
    }
  } else {
    unsubMediaListChangeEvent?.()
    if (audioContext && audioContext.destination.channelCountMode != 'explicit') {
      audioContext.destination.channelCount = defaultChannelCount
      // audioContext.destination.channelInterpretation
      audioContext.destination.channelCountMode = 'explicit'
    }
  }
}

export const getAnalyser = (): AnalyserNode | null => {
  initAdvancedAudioFeatures()
  return analyser
}

export const getBiquadFilter = () => {
  initAdvancedAudioFeatures()
  return biquads
}

// let isConvolverConnected = false
// 压缩器仅为卷积混响的干湿混合而设；无卷积时完全透明，避免无谓的动态压平
const updateConvolverCompressor = () => {
  if (!convolverDynamicsCompressor) return
  const active = !!appSetting['player.soundEffect.convolution.fileName']
  convolverDynamicsCompressor.threshold.value = active ? -24 : 0
  convolverDynamicsCompressor.ratio.value = active ? 12 : 1
}

export const setConvolver = (buffer: AudioBuffer | null, mainGain: number, sendGain: number) => {
  initAdvancedAudioFeatures()
  convolver.buffer = buffer
  // console.log(mainGain, sendGain)
  if (buffer) {
    convolverSourceGainNode.gain.value = mainGain
    convolverOutputGainNode.gain.value = sendGain
  } else {
    convolverSourceGainNode.gain.value = 1
    convolverOutputGainNode.gain.value = 0
  }
}

export const setConvolverMainGain = (gain: number) => {
  if (convolverSourceGainNode.gain.value == gain) return
  // console.log(gain)
  convolverSourceGainNode.gain.value = gain
}

export const setConvolverSendGain = (gain: number) => {
  if (convolverOutputGainNode.gain.value == gain) return
  // console.log(gain)
  convolverOutputGainNode.gain.value = gain
}

let pannerInfo = {
  x: 0,
  y: 0,
  z: 0,
  soundR: 0.5,
  rad: 0,
  speed: 1,
  intv: null as NodeJS.Timeout | null,
}
const setPannerXYZ = (nx: number, ny: number, nz: number) => {
  pannerInfo.x = nx
  pannerInfo.y = ny
  pannerInfo.z = nz
  // console.log(pannerInfo)
  panner.positionX.value = nx * pannerInfo.soundR
  panner.positionY.value = ny * pannerInfo.soundR
  panner.positionZ.value = nz * pannerInfo.soundR
}
export const setPannerSoundR = (r: number) => {
  pannerInfo.soundR = r
}

export const setPannerSpeed = (speed: number) => {
  pannerInfo.speed = speed
  if (pannerInfo.intv) startPanner()
}
export const stopPanner = () => {
  if (pannerInfo.intv) {
    clearInterval(pannerInfo.intv)
    pannerInfo.intv = null
    pannerInfo.rad = 0
  }
  panner.positionX.value = 0
  panner.positionY.value = 0
  panner.positionZ.value = 0
}

export const startPanner = () => {
  initAdvancedAudioFeatures()
  if (pannerInfo.intv) {
    clearInterval(pannerInfo.intv)
    pannerInfo.intv = null
    pannerInfo.rad = 0
  }
  pannerInfo.intv = setInterval(() => {
    pannerInfo.rad += 1
    if (pannerInfo.rad > 360) pannerInfo.rad -= 360
    setPannerXYZ(Math.sin(pannerInfo.rad * Math.PI / 180), Math.cos(pannerInfo.rad * Math.PI / 180), Math.cos(pannerInfo.rad * Math.PI / 180))
  }, pannerInfo.speed * 10)
}

let isConnected = true
const connectNode = () => {
  if (isConnected) return
  console.log('connect Node')
  analyser?.connect(biquads.get(`hz${freqs[0]}`)!)
  isConnected = true
  if (pitchShifterNodeTempValue == 1 && pitchShifterNodeLoadStatus == 'connected') {
    disconnectPitchShifterNode()
  }
}
const disconnectNode = () => {
  if (!isConnected) return
  console.log('disconnect Node')
  analyser?.disconnect()
  isConnected = false
  if (pitchShifterNodeTempValue == 1 && pitchShifterNodeLoadStatus == 'connected') {
    disconnectPitchShifterNode()
  }
}
const connectPitchShifterNode = () => {
  console.log('connect Pitch Shifter Node')
  audio!.addEventListener('playing', connectNode)
  audio!.addEventListener('pause', disconnectNode)
  audio!.addEventListener('waiting', disconnectNode)
  audio!.addEventListener('emptied', disconnectNode)
  if (audio!.paused) disconnectNode()

  const lastBiquadFilter = (biquads.get(`hz${freqs.at(-1)!}`)!)
  lastBiquadFilter.disconnect()
  lastBiquadFilter.connect(pitchShifterNode)

  pitchShifterNode.connect(convolver)
  pitchShifterNode.connect(convolverSourceGainNode)
  // convolverDynamicsCompressor.disconnect(panner)
  // convolverDynamicsCompressor.connect(pitchShifterNode)
  // pitchShifterNode.connect(panner)
  pitchShifterNodeLoadStatus = 'connected'
  pitchShifterNodePitchFactor.value = pitchShifterNodeTempValue
}
const disconnectPitchShifterNode = () => {
  console.log('disconnect Pitch Shifter Node')
  const lastBiquadFilter = (biquads.get(`hz${freqs.at(-1)!}`)!)
  lastBiquadFilter.disconnect()
  lastBiquadFilter.connect(convolver)
  lastBiquadFilter.connect(convolverSourceGainNode)
  pitchShifterNodeLoadStatus = 'unconnect'

  audio!.removeEventListener('playing', connectNode)
  audio!.removeEventListener('pause', disconnectNode)
  audio!.removeEventListener('waiting', disconnectNode)
  audio!.removeEventListener('emptied', disconnectNode)
  connectNode()
}
const loadPitchShifterNode = () => {
  pitchShifterNodeLoadStatus = 'loading'
  initAdvancedAudioFeatures()
  // source -> analyser -> biquadFilter -> audioWorklet(pitch shifter) -> [(convolver & convolverSource)->convolverDynamicsCompressor] -> panner -> gain
  void audioContext.audioWorklet.addModule(new URL(
    /* webpackChunkName: 'pitch_shifter.audioWorklet' */
    './pitch-shifter/phase-vocoder.js',
    import.meta.url,
  )).then(() => {
    console.log('pitch shifter audio worklet loaded')
    // https://github.com/olvb/phaze/issues/26#issuecomment-1574629971
    pitchShifterNode = new AudioWorkletNode(audioContext, 'phase-vocoder-processor', { outputChannelCount: [2] })
    let pitchFactorParam = pitchShifterNode.parameters.get('pitchFactor')
    if (!pitchFactorParam) return
    pitchShifterNodePitchFactor = pitchFactorParam
    pitchShifterNodeLoadStatus = 'unconnect'
    if (pitchShifterNodeTempValue == 1) return

    connectPitchShifterNode()
  })
}

export const setPitchShifter = (val: number) => {
  // console.log('setPitchShifter', val)
  pitchShifterNodeTempValue = val
  switch (pitchShifterNodeLoadStatus) {
    case 'loading':
      break
    case 'none':
      loadPitchShifterNode()
      break
    case 'connected':
      // a: 1 = 半音
      // value = 2 ** (a / 12)
      pitchShifterNodePitchFactor.value = val
      break
    case 'unconnect':
      connectPitchShifterNode()
      break
  }
}

export const hasInitedAdvancedAudioFeatures = (): boolean => audioContext != null

const isMpvEngine = () => appSetting['player.playEngine'] == 'mpv'
const isAudirvanaEngine = () => appSetting['player.playEngine'] == 'audirvana'
const isMpvUnavailableError = (message: string) => /未找到 mpv|ENOENT|mpv IPC connect timeout|mpv IPC is not connected|mpv exited before IPC became ready/i.test(message)
const handleMpvError = (action: string, err: any) => {
  const message = err?.message ?? String(err)
  console.error(`mpv ${action} failed:`, message)
  if (!isMpvUnavailableError(message)) return
  window.alert(`mpv ${action}失败：${message}\n\n请确认：\n1. mpv 已安装（brew install mpv）\n2. 或切换到内置引擎（设置 → 播放引擎 → 内置引擎）`)
  window.app_event.stop()
}

const stopSelectedAudioEngine = async() => {
  if (isMpvEngine()) {
    await mpvPlayer.setStop().catch(err => { console.error('mpv stop before video failed', err) })
  } else if (isAudirvanaEngine()) {
    await audirvanaPlayer.setStop().catch(err => { console.error('audirvana stop before video failed', err) })
  } else if (audio) {
    if (vst3Node) resetVst3Audio(false)
    audio.pause()
    audio.src = ''
    audio.removeAttribute('src')
  }
}

export const setResource = async(src: string, musicInfo?: LX.Music.MusicInfo, filePath?: string, videoAudioUrl?: string): Promise<void> => {
  const revision = ++playbackRevision
  seekResume = false
  if (vst3Node) resetVst3Audio(false)
  if (isBiliVideoActive()) {
    if (!src) return
    await stopSelectedAudioEngine()
    window.app_event?.playerLoadstart()
    try {
      await mpvVideoPlayer.setResource(src, videoAudioUrl)
    } catch (err) {
      handleMpvError('加载视频', err)
      throw err
    }
    return
  }
  if (!mpvVideoPlayer.isEmpty()) await mpvVideoPlayer.setStop().catch(err => { console.error('mpv video stop before audio failed', err) })
  if (isMpvEngine()) {
    if (!src) {
      console.warn('mpv setResource skipped: empty src')
      return
    }
    // MPV 的 loadstart 需要手动触发，与 audio.loadstart 语义对齐。
    window.app_event?.playerLoadstart()
    try {
      await mpvPlayer.setResource(src)
    } catch (err) {
      handleMpvError('加载', err)
      throw err
    }
    return
  }
  if (isAudirvanaEngine()) {
    if (!src) {
      console.warn('audirvana setResource skipped: empty src')
      return
    }
    await audirvanaPlayer.setResource(src, musicInfo, filePath)
    return
  }
  await vst3Change
  if (revision !== playbackRevision) return
  if (appSetting['player.vst3.enabled'] && !vst3Node) await syncVst3()
  if (vst3Node && !await prepareVst3Audio()) return
  if (revision !== playbackRevision) return
  if (audio) audio.src = src
}

export const setPlay = () => {
  const revision = ++playbackRevision
  if (isBiliVideoActive()) {
    void mpvVideoPlayer.setPlay().catch(err => { handleMpvError('播放视频', err) })
    return
  }
  if (isMpvEngine()) {
    void mpvPlayer.setPlay().catch(err => { handleMpvError('播放', err) })
    return
  }
  if (isAudirvanaEngine()) {
    void audirvanaPlayer.setPlay().catch(err => {
      console.error('audirvana play failed:', err?.message ?? err)
    })
    return
  }
  void (async() => {
    await vst3Change
    if (revision !== playbackRevision) return
    if (audio && !audio.paused) return
    if (vst3Node && !await prepareVst3Audio()) return
    if (revision !== playbackRevision) return
    if (elementCaptured && outputPipe?.paused) {
      void outputPipe.play().catch(err => {
        console.error('effect output pipe resume failed:', err)
      })
    }
    await audio?.play()
  })().catch(() => {
    window.app_event.pause()
  })
}

export const setPause = () => {
  playbackRevision++
  seekResume = false
  if (vst3Node) resetVst3Audio(false)
  if (isBiliVideoActive()) {
    void mpvVideoPlayer.setPause().catch(err => { console.error('mpv video pause failed', err) })
    return
  }
  if (isMpvEngine()) {
    void mpvPlayer.setPause().catch(err => {
      console.error('mpv pause failed', err)
    })
    return
  }
  if (isAudirvanaEngine()) {
    void audirvanaPlayer.setPause().catch(err => {
      console.error('audirvana pause failed', err)
    })
    return
  }
  const playing = !!audio && !audio.paused
  audio?.pause()
  if (vst3Node && audio && playing) {
    audio.currentTime = Math.max(0, audio.currentTime - (vst3Runtime.latencyMs + vst3Runtime.bridgeMs) / 1000 * audio.playbackRate)
  }
}

export const setStop = async(): Promise<void> => {
  playbackRevision++
  seekResume = false
  if (vst3Node) resetVst3Audio(false)
  if (isBiliVideoActive()) {
    return mpvVideoPlayer.setStop().catch(err => { console.error('mpv video stop failed', err) })
  }
  if (!mpvVideoPlayer.isEmpty()) await mpvVideoPlayer.setStop().catch(err => { console.error('mpv video stop failed', err) })
  if (isMpvEngine()) {
    return mpvPlayer.setStop().catch(err => {
      console.error('mpv stop failed', err)
    })
  }
  if (isAudirvanaEngine()) {
    return audirvanaPlayer.setStop().catch(err => {
      console.error('audirvana stop failed', err)
    })
  }
  if (audio) {
    audio.src = ''
    audio.removeAttribute('src')
  }
  return Promise.resolve()
}

export const isEmpty = (): boolean => {
  if (isBiliVideoActive()) return mpvVideoPlayer.isEmpty()
  if (isMpvEngine()) return mpvPlayer.isEmpty()
  if (isAudirvanaEngine()) return audirvanaPlayer.isEmpty()
  return !audio?.src
}

export const setLoopPlay = (isLoop: boolean) => {
  if (isBiliVideoActive()) return
  if (isAudirvanaEngine()) {
    audirvanaPlayer.setLoopPlay(isLoop)
    return
  }
  if (audio) audio.loop = isLoop
}

export const getPlaybackRate = (): number => {
  if (isBiliVideoActive()) return 1
  if (isAudirvanaEngine()) return audirvanaPlayer.getPlaybackRate()
  return audio?.defaultPlaybackRate ?? 1
}

export const setPlaybackRate = (rate: number) => {
  if (isBiliVideoActive()) return
  if (isMpvEngine()) return
  if (isAudirvanaEngine()) {
    audirvanaPlayer.setPlaybackRate(rate)
    return
  }
  if (!audio) return
  audio.defaultPlaybackRate = rate
  audio.playbackRate = rate
}

export const setPreservesPitch = (preservesPitch: boolean) => {
  if (isBiliVideoActive()) return
  if (isAudirvanaEngine()) {
    audirvanaPlayer.setPreservesPitch(preservesPitch)
    return
  }
  if (!audio) return
  audio.preservesPitch = preservesPitch
}

export const getMute = (): boolean => {
  if (isBiliVideoActive()) return mpvVideoPlayer.getMute()
  if (isAudirvanaEngine()) return audirvanaPlayer.getMute()
  return audio?.muted ?? false
}

export const setMute = (isMute: boolean) => {
  if (isBiliVideoActive()) {
    mpvVideoPlayer.setMute(isMute)
    return
  }
  if (isMpvEngine()) {
    mpvPlayer.setMute(isMute)
    return
  }
  if (isAudirvanaEngine()) {
    audirvanaPlayer.setMute(isMute)
    return
  }
  if (audio) audio.muted = isMute
}

export const getCurrentTime = () => {
  if (isBiliVideoActive()) return mpvVideoPlayer.getCurrentTime()
  if (isMpvEngine()) return mpvPlayer.getCurrentTime()
  if (isAudirvanaEngine()) return audirvanaPlayer.getCurrentTime()
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return audio?.currentTime || 0
}

export const setCurrentTime = (time: number) => {
  if (isBiliVideoActive()) {
    mpvVideoPlayer.setCurrentTime(time)
    return
  }
  if (isMpvEngine()) {
    mpvPlayer.setCurrentTime(time)
    return
  }
  if (isAudirvanaEngine()) {
    audirvanaPlayer.setCurrentTime(time)
    return
  }
  if (audio && vst3Node) {
    const revision = ++playbackRevision
    seekResume = seekResume || !audio.paused
    audio.pause()
    audio.currentTime = time
    void prepareVst3Audio().then(async(ready) => {
      if (!ready || revision !== playbackRevision) return
      const playing = seekResume
      seekResume = false
      if (playing) await audio?.play()
      else resetVst3Audio(false)
    }).catch((err: Error) => { vst3Runtime.error = err.message })
  } else if (audio) audio.currentTime = time
}

// 是否有音频效果处于启用状态（决定音频走效果链还是透明直出）。
// 外部播放引擎和 B 站视频不使用 renderer 的 AudioContext，必须回到透明出口。
const hasActiveAudioEffect = () => {
  if (appSetting['player.playEngine'] !== 'electron' || isBiliVideoActive()) return false
  return freqs.some(v => appSetting[`player.soundEffect.biquadFilter.hz${v}`] != 0) ||
    !!appSetting['player.soundEffect.convolution.fileName'] ||
    appSetting['player.soundEffect.pitchShifter.playbackRate'] != 1 ||
    appSetting['player.soundEffect.panner.enable'] ||
    appSetting['player.audioVisualization'] ||
    appSetting['player.vst3.enabled']
}

// 重建 audio 元素：capture 不可逆，透明直出与效果链之间切换只能换元素
const rebuildAudioElement = async(capture: boolean) => {
  if (!audio) {
    createAudio()
    if (!audio) return
    if (capture) initAdvancedAudioFeatures(audio)
    await applyCurrentOutputSink(getDesiredOutputSinkId())
    return
  }

  const oldAudio = audio
  const oldMediaSource = mediaSource
  const oldOutputPipe = outputPipe
  const oldCaptured = elementCaptured
  const wasPlaying = !oldAudio.paused
  const state = {
    src: oldAudio.src,
    time: oldAudio.currentTime,
    volume: oldAudio.volume,
    muted: oldAudio.muted,
    rate: oldAudio.playbackRate,
    defaultRate: oldAudio.defaultPlaybackRate,
    preserves: oldAudio.preservesPitch,
    loop: oldAudio.loop,
  }

  // Stage the replacement without publishing it through the module-level `audio`.
  // The old element remains the only active source until the final sink accepts.
  const nextAudio = createAudioElement(false)
  nextAudio.autoplay = false
  let nextMediaSource: MediaElementAudioSourceNode | null = null
  let nextOutputPipe: HTMLAudioElementChrome | null = null
  try {
    if (capture) {
      if (!audioContext) {
        // The first graph must also be initialized against the staged element;
        // otherwise createMediaElementSource would capture the old direct output.
        initAdvancedAudioFeatures(nextAudio, true)
        nextMediaSource = mediaSource
        nextOutputPipe = outputPipe
      } else {
        nextMediaSource = audioContext.createMediaElementSource(nextAudio)
        nextMediaSource.connect(analyser)
        nextOutputPipe = oldOutputPipe
        if (!nextOutputPipe) {
          if (!mediaStreamDest) throw new Error('Audio output pipe is not ready')
          nextOutputPipe = createOutputPipe(mediaStreamDest.stream, false)
        }
      }
    }

    nextAudio.volume = state.volume
    nextAudio.muted = state.muted
    nextAudio.defaultPlaybackRate = state.defaultRate
    nextAudio.playbackRate = state.rate
    nextAudio.loop = state.loop
    if ('preservesPitch' in nextAudio) nextAudio.preservesPitch = state.preserves
    if (state.src) {
      nextAudio.src = state.src
      nextAudio.load()
      try { nextAudio.currentTime = state.time } catch {}
    }

    // Bind the final output while the replacement is still staged. A rejected
    // setSinkId therefore cannot strand playback on a new empty element.
    await applyOutputSink({
      captured: capture,
      audio: nextAudio,
      outputPipe: nextOutputPipe,
    }, getDesiredOutputSinkId())
  } catch (err) {
    console.error('audio routing rebuild failed, keeping previous route:', err)
    try {
      nextAudio.pause()
      nextAudio.removeAttribute('src')
      nextAudio.load()
    } catch {}
    if (nextMediaSource && nextMediaSource !== oldMediaSource) {
      try { nextMediaSource.disconnect() } catch {}
    }
    if (nextOutputPipe && nextOutputPipe !== oldOutputPipe) {
      try {
        nextOutputPipe.pause()
        nextOutputPipe.srcObject = null
      } catch {}
    }
    // A cold-start graph may have populated these globals while it was staged.
    // Restore the route references; keep the initialized context for a retry.
    // eslint-disable-next-line require-atomic-updates -- rollback runs inside the serialized routing transaction.
    mediaSource = oldMediaSource
    // eslint-disable-next-line require-atomic-updates -- rollback runs inside the serialized routing transaction.
    outputPipe = oldOutputPipe
    // eslint-disable-next-line require-atomic-updates -- rollback runs inside the serialized routing transaction.
    elementCaptured = oldCaptured
    throw err
  }

  // Keep the old element available until the replacement has also proved that
  // it can resume playback. This covers autoplay/load failures after setSinkId.
  for (const { event, listener } of elementEventListeners) {
    oldAudio.removeEventListener(event, listener)
  }
  oldAudio.pause()
  nextAudio.autoplay = true
  try {
    if (capture && nextOutputPipe && nextOutputPipe !== oldOutputPipe) {
      try {
        await nextOutputPipe.play()
      } catch (err) {
        console.error('effect output pipe start failed:', err)
        if (wasPlaying) throw err
      }
    }
    if (wasPlaying) await nextAudio.play()
  } catch (err) {
    console.error('audio routing replacement could not resume, restoring previous route:', err)
    try {
      nextAudio.pause()
      nextAudio.removeAttribute('src')
      nextAudio.load()
    } catch {}
    if (nextMediaSource && nextMediaSource !== oldMediaSource) {
      try { nextMediaSource.disconnect() } catch {}
    }
    if (nextOutputPipe && nextOutputPipe !== oldOutputPipe) {
      try {
        nextOutputPipe.pause()
        nextOutputPipe.srcObject = null
      } catch {}
    }
    // eslint-disable-next-line require-atomic-updates -- rollback runs inside the serialized routing transaction.
    mediaSource = oldMediaSource
    // eslint-disable-next-line require-atomic-updates -- rollback runs inside the serialized routing transaction.
    outputPipe = oldOutputPipe
    // eslint-disable-next-line require-atomic-updates -- rollback runs inside the serialized routing transaction.
    elementCaptured = oldCaptured
    for (const { event, listener } of elementEventListeners) {
      oldAudio.addEventListener(event, listener)
    }
    if (wasPlaying) {
      await oldAudio.play().catch(playErr => {
        console.error('audio rollback failed:', playErr?.message ?? playErr)
      })
    }
    throw err
  }

  // Commit only after the final output accepted the desired device and the new
  // media element is ready to continue playback.
  // eslint-disable-next-line require-atomic-updates -- commit is serialized by routingQueue.
  audio = nextAudio
  // eslint-disable-next-line require-atomic-updates -- commit is serialized by routingQueue.
  elementCaptured = capture
  // eslint-disable-next-line require-atomic-updates -- commit is serialized by routingQueue.
  mediaSource = capture ? nextMediaSource : null
  // eslint-disable-next-line require-atomic-updates -- commit is serialized by routingQueue.
  outputPipe = capture ? nextOutputPipe : null
  for (const { event, listener } of elementEventListeners) {
    nextAudio.addEventListener(event, listener)
  }

  if (oldMediaSource && oldMediaSource !== nextMediaSource) {
    try { oldMediaSource.disconnect() } catch {}
  }
  oldAudio.removeAttribute('src')
  oldAudio.load()
  if (oldOutputPipe && oldOutputPipe !== nextOutputPipe) {
    oldOutputPipe.pause()
    oldOutputPipe.srcObject = null
  }
}

// 按当前效果状态切换音频路由（串行化避免并发重建）
const applyAudioRouting = async() => {
  return enqueueRoutingChange(async() => {
    if (!audio && !mediaSource) return
    const wantEffects = hasActiveAudioEffect()
    if (wantEffects === elementCaptured) {
      await applyCurrentOutputSink(getDesiredOutputSinkId())
      return
    }
    console.error('[device-debug] routing ->', wantEffects ? 'effects' : 'transparent')
    await rebuildAudioElement(wantEffects)
  })
}

export const applyAudioRoutingNow = async() => applyAudioRouting()

// TEMP DEBUG（验证完成后移除）
if (typeof window !== 'undefined') {
  (window as any).__lxAudioDebug = () => ({
    hasAudio: !!audio,
    audioPaused: audio ? audio.paused : null,
    audioSinkId: audio ? (audio as any).sinkId : null,
    hasCtx: !!audioContext,
    ctxState: audioContext ? audioContext.state : null,
    hasPipe: !!outputPipe,
    pipePaused: outputPipe ? outputPipe.paused : null,
    pipeSinkId: outputPipe ? (outputPipe as any).sinkId : null,
    captured: elementCaptured,
    vst3Node: !!vst3Node,
  })
}

let outputSinkRequestVersion = 0

export const setMediaDeviceId = async(mediaDeviceId: string): Promise<void> => {
  if (isBiliVideoActive()) return
  if (isAudirvanaEngine()) return audirvanaPlayer.setMediaDeviceId(mediaDeviceId)
  desiredOutputSinkId = normalizeOutputSinkId(mediaDeviceId)
  const requestVersion = ++outputSinkRequestVersion
  const requestedSinkId = desiredOutputSinkId
  await enqueueLatestRoutingChange('output-sink', async() => {
    // 设备变更必须等待正在进行的元素重建，再绑定到最终硬件出口。
    // 已被更新请求取代的任务不再触碰旧设备，避免 A→B 时短暂回到 A。
    if (requestVersion !== outputSinkRequestVersion) return
    await applyCurrentOutputSink(requestedSinkId)
  })
}

export const setVolume = (volume: number) => {
  if (isBiliVideoActive()) {
    mpvVideoPlayer.setVolume(volume)
    return
  }
  if (isMpvEngine()) {
    mpvPlayer.setVolume(volume)
    return
  }
  if (isAudirvanaEngine()) {
    audirvanaPlayer.setVolume(volume)
    return
  }
  if (audio) audio.volume = volume
}

export const getDuration = () => {
  if (isBiliVideoActive()) return mpvVideoPlayer.getDuration()
  if (isMpvEngine()) return mpvPlayer.getDuration()
  if (isAudirvanaEngine()) return audirvanaPlayer.getDuration()
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return audio?.duration || 0
}

// export const getPlaybackRate = () => {
//   return audio?.playbackRate ?? 1
// }

type Noop = () => void
type PlayerSub = (callback: (...args: any[]) => void) => () => void

// 三套后端都订阅，回调根据当前播放模式过滤，保证切到 B 站视频时不用重启播放器。
const registerEvent = (event: string, mpvSub: PlayerSub, videoSub: PlayerSub, audirvanaSub: PlayerSub, callback: Noop): (() => void) => {
  const unsubs: Array<() => void> = []
  if (audio) {
    const audioCallback: EventListener = () => {
      if (!isBiliVideoActive() && appSetting['player.playEngine'] === 'electron') callback()
    }
    elementEventListeners.push({ event, listener: audioCallback })
    audio.addEventListener(event, audioCallback)
    unsubs.push(() => {
      audio?.removeEventListener(event, audioCallback)
      const index = elementEventListeners.findIndex(item => item.event === event && item.listener === audioCallback)
      if (index > -1) elementEventListeners.splice(index, 1)
    })
  }
  unsubs.push(mpvSub(() => {
    if (!isBiliVideoActive() && isMpvEngine()) callback()
  }))
  unsubs.push(videoSub(() => {
    if (isBiliVideoActive()) callback()
  }))
  unsubs.push(audirvanaSub(() => {
    if (isBiliVideoActive() === false && isAudirvanaEngine()) callback()
  }))
  return () => {
    unsubs.forEach(fn => { fn() })
  }
}

export const onPlaying = (callback: Noop) => registerEvent('playing', mpvPlayer.onPlaying, mpvVideoPlayer.onPlaying, audirvanaPlayer.onPlaying, callback)
export const onPause = (callback: Noop) => registerEvent('pause', mpvPlayer.onPause, mpvVideoPlayer.onPause, audirvanaPlayer.onPause, callback)
export const onEnded = (callback: Noop) => registerEvent('ended', mpvPlayer.onEnded, mpvVideoPlayer.onEnded, audirvanaPlayer.onEnded, callback)
export const onError = (callback: Noop) => registerEvent('error', mpvPlayer.onError, mpvVideoPlayer.onError, audirvanaPlayer.onError, callback)
export const onLoadeddata = (callback: Noop) => registerEvent('loadeddata', mpvPlayer.onLoadeddata, mpvVideoPlayer.onLoadeddata, audirvanaPlayer.onLoadeddata, callback)
export const onLoadstart = (callback: Noop) => registerEvent('loadstart', mpvPlayer.onLoadstart, mpvVideoPlayer.onLoadstart, audirvanaPlayer.onLoadstart, callback)
export const onCanplay = (callback: Noop) => registerEvent('canplay', mpvPlayer.onCanplay, mpvVideoPlayer.onCanplay, audirvanaPlayer.onCanplay, callback)
export const onEmptied = (callback: Noop) => registerEvent('emptied', mpvPlayer.onEmptied, mpvVideoPlayer.onEmptied, audirvanaPlayer.onEmptied, callback)
export const onTimeupdate = (callback: Noop) => registerEvent('timeupdate', mpvPlayer.onTimeupdate, mpvVideoPlayer.onTimeupdate, audirvanaPlayer.onTimeupdate, callback)
export const onWaiting = (callback: Noop) => registerEvent('waiting', mpvPlayer.onWaiting, mpvVideoPlayer.onWaiting, audirvanaPlayer.onWaiting, callback)
export const onSeeked = (callback: Noop) => registerEvent('seeked', mpvPlayer.onSeeked, mpvVideoPlayer.onSeeked, audirvanaPlayer.onSeeked, callback)

// 可见性改变
export const onVisibilityChange = (callback: Noop) => {
  if (isAudirvanaEngine()) return audirvanaPlayer.onVisibilityChange(callback)
  document.addEventListener('visibilitychange', callback)
  return () => {
    document.removeEventListener('visibilitychange', callback)
  }
}


export const getErrorCode = () => {
  if (isBiliVideoActive()) return 0
  if (isAudirvanaEngine()) return audirvanaPlayer.getErrorCode()
  return audio?.error?.code
}
