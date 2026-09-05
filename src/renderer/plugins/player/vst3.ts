import { ipcRenderer } from 'electron'
import { shallowReactive } from '@common/utils/vueTools'
import { WIN_MAIN_RENDERER_EVENT_NAME as IPC } from '@common/ipcNames'

export const vst3Runtime = shallowReactive({
  latencyMs: 0,
  bridgeMs: 0,
  error: '',
  // 宿主忙于插件界面（如加载预设）时链路临时直通；true 表示正处于直通状态。
  notice: false,
  active: false,
  slots: [] as Array<{ id: string, latencyMs: number }>,
})

const applyStatus = (status: { sampleRate: number, slots?: Array<{ id: string, enabled: boolean, latency: number }> } | null) => {
  if (!status) {
    vst3Runtime.slots = []
    return
  }
  vst3Runtime.slots = (status.slots ?? []).map(slot => ({
    id: slot.id,
    latencyMs: slot.enabled && status.sampleRate ? slot.latency / status.sampleRate * 1000 : 0,
  }))
}

// 插件链未变化时按需刷新各插槽延迟（编辑器调参可能改变插件延迟）。
export const refreshVst3Status = async() => {
  try { applyStatus(await ipcRenderer.invoke(IPC.vst3_status)) } catch {}
}

// Electron 的 invoke 会把主进程错误包上一层 "Error invoking remote method ..." 前缀，展示前去掉。
export const cleanVst3Error = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

// IPC 的结构化克隆无法序列化 Vue 响应式 Proxy，插件链设置必须先转成纯对象。
export const plainVst3Chain = (chain: LX.AppSetting['player.vst3.chain']): LX.AppSetting['player.vst3.chain'] =>
  JSON.parse(JSON.stringify(chain))
let node: AudioWorkletNode | null = null
let epoch = 0
let inFlight = 0
let bypassSince = 0

export const resetVst3Audio = (active: boolean) => {
  epoch++
  node?.port.postMessage({ action: 'reset', epoch, active })
}

export const prepareVst3Audio = async() => {
  resetVst3Audio(false)
  const preparingEpoch = epoch
  await ipcRenderer.invoke(IPC.vst3_reset)
  if (preparingEpoch !== epoch) return false
  vst3Runtime.error = ''
  resetVst3Audio(true)
  return true
}

export const configureVst3Audio = async(audioContext: AudioContext) => {
  resetVst3Audio(false)
  const status = await ipcRenderer.invoke(IPC.vst3_configure, audioContext.sampleRate)
  applyStatus(status)
  vst3Runtime.latencyMs = status.latencySamples / audioContext.sampleRate * 1000
  vst3Runtime.bridgeMs = 4096 / audioContext.sampleRate * 1000
  vst3Runtime.error = ''
}

export const createVst3Node = async(audioContext: AudioContext, onFault: () => void) => {
  await configureVst3Audio(audioContext)
  await audioContext.audioWorklet.addModule(new URL('./vst3-worklet.js', import.meta.url))
  node = new AudioWorkletNode(audioContext, 'lx-vst3', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
  const current = node
  const fail = (message: string) => {
    if (node !== current || vst3Runtime.error) return
    vst3Runtime.error = message
    resetVst3Audio(false)
    onFault()
  }
  current.onprocessorerror = () => { fail('VST3 audio processor failed') }
  current.port.onmessage = ({ data }) => {
    if (data.epoch !== epoch || current !== node) return
    if (data.action === 'fault') { fail('VST3 processing missed the audio deadline; playback paused'); return }
    if (data.action !== 'process') return
    // Backstop only: the chain answers dry passthrough once its queue backs up (48), so
    // this cap must stay above that depth or the dry answers never reach the worklet.
    if (inFlight >= 96) return
    inFlight++
    // Requests must not be serialized here: the chain queue serializes them and its dry
    // passthrough only engages once enough requests actually reach it. Every reply carries
    // its sequence tag, so out-of-order or stale replies are dropped by the worklet anyway.
    // Audio uses direct IPC to avoid the general renderer helper's payload logging.
    void ipcRenderer.invoke(IPC.vst3_process, data.inputs.map((channel: Float32Array) => Array.from(channel))).then((result) => {
      if (data.epoch !== epoch || current !== node) return
      vst3Runtime.latencyMs = result.latencySamples / audioContext.sampleRate * 1000
      // 直通持续超过 4 秒才提示：冷启动突发、打开插件界面/加载预设的瞬时直通不打扰用户
      if (result.bypassed === true) {
        if (!bypassSince) bypassSince = Date.now()
        vst3Runtime.notice = Date.now() - bypassSince >= 4000
      } else if (bypassSince) {
        bypassSince = 0
        vst3Runtime.notice = false
      }
      current.port.postMessage({ ...result, epoch: data.epoch, sequence: data.sequence })
    }).catch((error: Error) => {
      // A torn-down chain rejects in-flight requests; that must not pause playback.
      if (current === node && data.epoch === epoch) fail(error.message)
    }).finally(() => { inFlight-- })
  }
  vst3Runtime.active = true
  resetVst3Audio(false)
  return current
}

export const closeVst3Audio = async() => {
  resetVst3Audio(false)
  const current = node
  node = null
  current?.disconnect()
  current?.port.close()
  try { await ipcRenderer.invoke(IPC.vst3_close) } finally {
    vst3Runtime.active = false
    vst3Runtime.latencyMs = 0
    vst3Runtime.bridgeMs = 0
    vst3Runtime.notice = false
    vst3Runtime.slots = []
  }
}
