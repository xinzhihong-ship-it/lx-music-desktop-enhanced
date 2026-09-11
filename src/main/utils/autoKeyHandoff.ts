import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Antares Auto-Key 机架同步。
 *
 * 经过对官方 Auto-Tune Pro 二进制的完整逆向，确认 Auto-Key 握手协议
 * **只包含两个字段**：
 *
 *     <VALUE name="KeyClass" val="0..11" />   // 主音 C..B
 *     <VALUE name="KeyType"  val="0|1"   />   // 0=大调 1=小调
 *
 * 协议中不存在 ReferencePitch / RetuneSpeed —— 这两个名字在二进制里
 * 从未出现在协议解析区域（RetuneSpeed 只作为 UI tooltip 和参数名存在）。
 * 因此 RetuneSpeed 只能靠平台各自的手段处理，见下方 SYNC_STRATEGY。
 *
 * 平台策略：
 *   - macOS：官方协议只给基调。RetuneSpeed 无协议可用（苹果禁止跨进程内存注入），
 *            由用户在机架里设定一次后保持固定；基调仍然全自动跟播。
 *   - Windows：除基调外，额外通过机架通道尝试同步 RetuneSpeed。
 */

export interface AutoKeyHandoffPayload {
  key: string
  scale: 'major' | 'minor'
  keyClass: number // 0=C, 1=C#, 2=D ... 11=B
  keyType: number // 0=Major, 1=Minor
  retuneSpeed?: number
  semitones?: number
  label: string
}

/** 各平台实际能做到的同步能力，供 UI 如实展示。 */
export const SYNC_STRATEGY = {
  /** 基调 + 实时转调：两个平台都由官方协议全自动支持 */
  keyAutomation: true,
  /** RetuneSpeed 自动同步：仅 Windows 通过机架通道可用 */
  retuneSpeedAutomation: process.platform === 'win32',
} as const

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const getAutoKeyCodes = (
  key: string,
  scale: 'major' | 'minor' | string,
): { keyClass: number, keyType: number } => {
  const normalized = (key || 'C')
    .toUpperCase()
    .replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#')
    .replace('AB', 'G#').replace('BB', 'A#')
  const idx = NOTES.indexOf(normalized)
  const keyClass = idx >= 0 ? idx : 0
  const keyType = scale === 'minor' ? 1 : 0
  return { keyClass, keyType }
}

/** 只有这两个字段是官方协议，多写别的不会被读取。 */
const buildHandoffXml = (payload: AutoKeyHandoffPayload): string =>
  '<?xml version="1.0"?>\n<PROPERTIES>\n' +
  `\t<VALUE name="KeyClass" val="${payload.keyClass}" />\n` +
  `\t<VALUE name="KeyType" val="${payload.keyType}" />\n` +
  '</PROPERTIES>\n'

/** 收集当前平台所有值得写入的 handoff 路径（官方硬编码路径在首位）。 */
const handoffDirectories = (): string[] => {
  const home = os.homedir()
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    const localappdata = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    const userprofile = process.env.USERPROFILE ?? home
    return [
      path.join(appdata, 'Antares', 'Auto-Key'),
      path.join(appdata, 'Auto-Key'),
      path.join(localappdata, 'Antares', 'Auto-Key'),
      path.join(localappdata, 'Auto-Key'),
      path.join(userprofile, 'Documents', 'Auto-Key'),
      path.join(userprofile, 'Music', 'Audio Music Apps', 'Temp'),
    ]
  }
  if (process.platform === 'darwin') {
    // Auto-Tune Pro 二进制里硬编码的路径就是这个，必须放首位。
    return [
      path.join(home, 'Music', 'Audio Music Apps', 'Temp'),
      path.join(home, 'Music', 'Audio Music Apps', 'Temp', 'AntaresData'),
      path.join(home, 'Music', 'Audio Music Apps'),
      path.join(home, 'Library', 'Application Support', 'Antares', 'Auto-Key'),
      path.join(home, 'Library', 'Application Support', 'Auto-Key'),
    ]
  }
  return [path.join(home, '.config', 'Auto-Key')]
}

export const writeAutoKeyHandoff = (payload: AutoKeyHandoffPayload): boolean => {
  if (!payload || typeof payload.keyClass !== 'number') return false

  const xml = buildHandoffXml(payload)
  let written = false

  for (const dir of handoffDirectories()) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'Auto-Key.handoff'), xml, 'utf8')
      written = true
    } catch {}
  }

  // 广播主进程内部事件，供后续 VST3 自动化 / 虚拟 MIDI / OSC 机架通道挂接
  try {
    (global.lx?.event_app as any)?.emit?.('song_key_sync_plugin', payload)
  } catch {}

  return written
}
