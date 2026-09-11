import { rendererInvoke } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { NOTE_NAMES, type NoteName } from './ksAlgorithm'

/**
 * Antares Auto-Key 机架同步。
 *
 * 官方握手协议只认 KeyClass / KeyType 两个字段（逆向 Auto-Tune Pro 二进制确认）。
 * RetuneSpeed 不在协议内，因此按平台走不同策略：
 *
 *   macOS   —— 基调 + 实时转调全自动；RetuneSpeed 需在机架里设定一次后固定。
 *   Windows —— 在基调之外，额外通过机架通道同步 RetuneSpeed。
 */

/** 当前平台的能力，UI 据此如实提示。 */
export const isRetuneSpeedAutomationSupported = process.platform === 'win32'

/**
 * 映射音名到 Antares Auto-Key 标准规范：
 * KeyClass: 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B
 * KeyType: 0=Major (大调), 1=Minor (小调)
 */
export const getAutoKeyCodes = (
  key: NoteName | string,
  scale: LX.SongKey.Scale,
): { keyClass: number, keyType: number } => {
  const normalized = key.toUpperCase().replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#').replace('AB', 'G#').replace('BB', 'A#')
  const idx = NOTE_NAMES.indexOf(normalized as NoteName)
  const keyClass = idx >= 0 ? idx : 0
  const keyType = scale === 'minor' ? 1 : 0
  return { keyClass, keyType }
}

export interface PluginSyncParams {
  key: string
  scale: LX.SongKey.Scale
  label: string
  camelot?: string
  retuneSpeed?: number
  semitones?: number
}

let cachedMidiOutput: MIDIOutput | null = null
let midiAccessPromise: Promise<MIDIAccess | null> | null = null

export const getMidiOutput = async(): Promise<MIDIOutput | null> => {
  if (cachedMidiOutput) return cachedMidiOutput
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') return null

  midiAccessPromise ??= navigator.requestMIDIAccess({ sysex: true }).catch(() => null)
  const access = await midiAccessPromise
  if (!access) return null

  for (const out of access.outputs.values()) {
    if (/logic|虚拟|virtual|iac|autokey/i.test(out.name ?? '')) {
      cachedMidiOutput = out
      return out
    }
  }
  const first = access.outputs.values().next().value
  if (first) {
    // eslint-disable-next-line require-atomic-updates
    cachedMidiOutput = first
    return first
  }
  return null
}

/**
 * 发送电音速度 (Retune Speed, 0~100) 到宿主虚拟 MIDI 控制器总线。
 * MIDI Channel 1, CC 14（0~127）。宿主收到后可直接映射到插件旋钮。
 *
 * 仅在 Windows 上作为自动通道使用；macOS 上宿主不允许外部程序直接改插件参数，
 * 需要用户在宿主里手动完成一次 MIDI 映射后才生效。
 */
export const sendMidiRetuneSpeed = async(speed: number): Promise<boolean> => {
  try {
    const out = await getMidiOutput()
    if (!out) return false
    const clamped = Math.max(0, Math.min(100, Math.round(speed || 0)))
    const midiVal = Math.max(0, Math.min(127, Math.round(clamped * 127 / 100)))
    out.send([0xB0, 14, midiVal])
    return true
  } catch {
    return false
  }
}

/**
 * 同步当前基调到宿主（写入官方 Auto-Key 协议文件 + 广播机架事件）。
 * RetuneSpeed 仅在 Windows 上附带推送。
 */
export const syncKeyToPlugin = async(params: PluginSyncParams): Promise<boolean> => {
  if (!params?.key) return false
  const { keyClass, keyType } = getAutoKeyCodes(params.key, params.scale)
  const speed = Math.max(0, Math.min(100, Math.round(params.retuneSpeed ?? 20)))

  if (isRetuneSpeedAutomationSupported) {
    void sendMidiRetuneSpeed(speed)
  }

  // 只发送协议真正支持的字段；多余字段 Auto-Tune 不会读取。
  const payload = {
    key: params.key,
    scale: params.scale,
    label: params.label,
    keyClass,
    keyType,
    retuneSpeed: speed,
    semitones: params.semitones ?? 0,
  }
  return await rendererInvoke<typeof payload, boolean>(
    WIN_MAIN_RENDERER_EVENT_NAME.song_key_sync_plugin,
    payload,
  ).catch(() => false)
}
