export type AudioDeviceEngine = 'electron' | 'mpv'
export interface AudioOutputDevice {
  deviceId: string
  label: string
  groupId?: string
}
export interface AudioDevicePreference {
  label: string
  electron: string
  mpv: string
  electronLabel?: string
  mpvLabel?: string
}

export const getAudioDevicePreference = (setting: Partial<LX.AppSetting>): AudioDevicePreference => ({
  label: setting['player.mediaDeviceLabel'] ?? '',
  electronLabel: setting['player.mediaDeviceLabel.electron'] ?? '',
  mpvLabel: setting['player.mediaDeviceLabel.mpv'] ?? '',
  electron: setting['player.mediaDeviceId.electron'] ?? '',
  mpv: setting['player.mediaDeviceId.mpv'] ?? '',
})
export const getAudioDevicePreferenceSetting = (preference: AudioDevicePreference) => ({
  'player.mediaDeviceLabel': preference.label,
  'player.mediaDeviceLabel.electron': preference.electronLabel ?? '',
  'player.mediaDeviceLabel.mpv': preference.mpvLabel ?? '',
  'player.mediaDeviceId.electron': preference.electron,
  'player.mediaDeviceId.mpv': preference.mpv,
})

export const isDefaultAudioDevice = (id: string) => !id || ['default', 'Default', 'auto'].includes(id)
const normalizeLabel = (label: string, engine?: AudioDeviceEngine) => {
  // Chromium appends transport metadata on macOS; MPV returns the native name.
  const name = engine === 'electron' ? label.replace(/\s+\((?:[0-9a-f]{4}:[0-9a-f]{4}|virtual|built-in|aggregate|bluetooth|hdmi|displayport|airplay|thunderbolt|pci)\)\s*$/i, '') : label
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}
const normalizeId = (id: string) => isDefaultAudioDevice(id) ? 'default' : id.replace(/^(avfoundation|coreaudio)\//, 'macos/')
export const sameAudioDeviceId = (left: string, right: string) => normalizeId(left) === normalizeId(right)
const emptyPreference = (): AudioDevicePreference => ({ label: '', electron: '', mpv: '' })

export const getAudioDeviceForEngine = (id: string, preference: AudioDevicePreference | undefined, engine: AudioDeviceEngine) => {
  if (preference?.[engine] && [preference.electron, preference.mpv].some(knownId => knownId && sameAudioDeviceId(knownId, id))) return preference[engine]
  return id
}

export const rememberAudioDevice = (
  previous: AudioDevicePreference | undefined,
  engine: AudioDeviceEngine,
  id: string,
  label: string,
): AudioDevicePreference => {
  if (isDefaultAudioDevice(id)) return { label: '', electron: 'default', mpv: 'default' }
  const saved = previous ?? emptyPreference()
  // A different ID chosen within one engine invalidates the old cross-engine
  // association, even when two connected devices have identical display names.
  const sameSelection = !!saved[engine] && sameAudioDeviceId(saved[engine], id)
  return {
    ...(sameSelection ? saved : emptyPreference()),
    label: label || (sameSelection ? saved.label : ''),
    [engine]: id,
    [engine === 'electron' ? 'electronLabel' : 'mpvLabel']: label || (sameSelection ? saved[engine === 'electron' ? 'electronLabel' : 'mpvLabel'] : ''),
  }
}

export const getRequestedAudioDevice = (id: string): { deviceId: string, engine?: AudioDeviceEngine } => {
  if (id.startsWith('unavailable:electron:')) return { deviceId: id.slice('unavailable:electron:'.length), engine: 'electron' }
  if (id.startsWith('unavailable:mpv:')) return { deviceId: id.slice('unavailable:mpv:'.length), engine: 'mpv' }
  return { deviceId: id }
}
const sameDeviceName = (left: string, leftEngine: AudioDeviceEngine, right: string, rightEngine: AudioDeviceEngine) =>
  !!left && !!right && (normalizeLabel(left) === normalizeLabel(right) || normalizeLabel(left, leftEngine) === normalizeLabel(right, rightEngine))
const namedDevices = (devices: AudioOutputDevice[], engine: AudioDeviceEngine, label: string, labelEngine: AudioDeviceEngine) => {
  const available = devices.filter(device => !isDefaultAudioDevice(device.deviceId) && device.deviceId !== 'communications')
  const exact = available.filter(device => normalizeLabel(device.label) === normalizeLabel(label))
  return exact.length ? exact : available.filter(device => sameDeviceName(device.label, engine, label, labelEngine))
}

const roleAwareDevices = (devices: AudioOutputDevice[], engine: AudioDeviceEngine) => engine !== 'electron' ? devices : devices.map(device => {
  if (device.deviceId !== 'communications' || !device.groupId) return device
  const peers = devices.filter(peer => peer.deviceId !== 'communications' && !isDefaultAudioDevice(peer.deviceId) && peer.groupId === device.groupId)
  return peers.length === 1 ? { ...device, label: peers[0].label } : device
})
const hasStableDeviceId = (engine: AudioDeviceEngine, id: string) => engine === 'electron' || /^(?:avfoundation|coreaudio)\//.test(id) || /^wasapi\/.*\{[0-9a-f-]{36}\}/i.test(id)

export const resolveAudioDeviceSelection = ({ sourceEngine, targetEngine, deviceId, preference, sourceDevices, targetDevices }: {
  sourceEngine: AudioDeviceEngine
  targetEngine: AudioDeviceEngine
  deviceId: string
  preference?: AudioDevicePreference
  sourceDevices: AudioOutputDevice[]
  targetDevices: AudioOutputDevice[]
}): { deviceId: string, preference: AudioDevicePreference } => {
  const request = getRequestedAudioDevice(deviceId)
  sourceEngine = request.engine ?? sourceEngine
  deviceId = request.deviceId
  if (isDefaultAudioDevice(deviceId)) return { deviceId: 'default', preference: { label: '', electron: 'default', mpv: 'default' } }
  sourceDevices = roleAwareDevices(sourceDevices, sourceEngine)
  targetDevices = roleAwareDevices(targetDevices, targetEngine)
  let source = sourceDevices.find(device => sameAudioDeviceId(device.deviceId, deviceId))
  const rememberedSource = preference?.[sourceEngine]
  const hasMemory = !!rememberedSource && sameAudioDeviceId(rememberedSource, deviceId)
  const sourceLabel = preference?.[sourceEngine === 'electron' ? 'electronLabel' : 'mpvLabel']
  let rememberedLabel = sourceLabel ?? ''
  if (!rememberedLabel) rememberedLabel = preference?.label ?? ''
  const wantedLabel = deviceId === 'communications' ? source?.label ?? '' : hasMemory && rememberedLabel ? rememberedLabel : source?.label ?? ''
  // Device IDs can be reassigned or imported from another computer. An ID with
  // a different description is not proof that it is still the selected output.
  if (source && wantedLabel && !sameDeviceName(source.label, sourceEngine, wantedLabel, sourceEngine)) {
    const peer = targetDevices.find(device => preference?.[targetEngine] && sameAudioDeviceId(device.deviceId, preference[targetEngine]))
    if (sourceEngine === targetEngine || !peer || !sameDeviceName(source.label, sourceEngine, peer.label, targetEngine)) source = undefined
  }
  if (!source && wantedLabel) {
    const matches = namedDevices(sourceDevices, sourceEngine, wantedLabel, sourceEngine)
    if (matches.length === 1) source = matches[0]
  }
  const saved = source
    ? rememberAudioDevice(preference, sourceEngine, source.deviceId, source.label)
    : hasMemory && preference ? { ...preference } : rememberAudioDevice(undefined, sourceEngine, deviceId, '')
  let target = targetDevices.find(device => saved[targetEngine] && sameAudioDeviceId(device.deviceId, saved[targetEngine]))
  const label = source?.label ? source.label : saved.label
  if (target && ((!source && sourceDevices.length > 0) || !sameDeviceName(label, sourceEngine, target.label, targetEngine))) {
    saved[targetEngine] = ''
    target = undefined
  }
  if (target && source && sourceEngine !== targetEngine && (!hasStableDeviceId(sourceEngine, source.deviceId) || !hasStableDeviceId(targetEngine, target.deviceId))) {
    if (namedDevices(sourceDevices, sourceEngine, label, sourceEngine).length !== 1 || namedDevices(targetDevices, targetEngine, label, sourceEngine).length !== 1) target = undefined
  }
  if (!target && source && sourceEngine === targetEngine) target = source
  if (!target && source && label) {
    const sources = namedDevices(sourceDevices, sourceEngine, label, sourceEngine)
    const targets = namedDevices(targetDevices, targetEngine, label, sourceEngine)
    // Names are only a fallback when both current catalogs identify exactly one
    // output. Never pair devices by row number, a partial name or a stale ID.
    if (sources.length === 1 && targets.length === 1) target = targets[0]
  }
  if (target) {
    return {
      deviceId: target.deviceId,
      preference: { ...saved, label: target.label || saved.label, [targetEngine]: target.deviceId, [targetEngine === 'electron' ? 'electronLabel' : 'mpvLabel']: target.label },
    }
  }
  const fallbackId = saved[targetEngine] || deviceId
  const collides = (fallbackId === 'communications' && targetEngine === 'mpv') || targetDevices.some(device => sameAudioDeviceId(device.deviceId, fallbackId))
  return {
    deviceId: collides ? `unavailable:${sourceEngine}:${deviceId}` : fallbackId,
    preference: saved,
  }
}
