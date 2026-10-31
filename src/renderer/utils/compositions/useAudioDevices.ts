import { computed, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import {
  getAudioDevicePreference, getAudioDevicePreferenceSetting, getRequestedAudioDevice,
  isDefaultAudioDevice, normalizeAudioDeviceId, normalizeAudioDeviceLabel,
  rememberAudioDevice, resolveAudioDeviceSelection, sameAudioDeviceId,
  type AudioDeviceEngine, type AudioOutputDevice,
} from '@common/utils/audioDeviceSelection'
import * as mpvPlayer from '@renderer/plugins/player/mpv'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { useI18n } from '@renderer/plugins/i18n'

type BindOutput = (id: string, isCurrent: () => boolean) => Promise<void>
const isManagedEngine = (engine: string): engine is AudioDeviceEngine => engine === 'electron' || engine === 'mpv'
const selectionChanged = () => Object.assign(new Error('Audio output selection changed; retry playback'), { code: 'AUDIO_DEVICE_SELECTION_CHANGED' })
const unavailable = (message: string) => Object.assign(new Error(message), { code: 'AUDIO_DEVICE_UNAVAILABLE' })

const createAudioDevices = () => {
  const t = useI18n()
  const lists = { electron: ref<AudioOutputDevice[]>([]), mpv: ref<AudioOutputDevice[]>([]) }
  const loadedAt = { electron: 0, mpv: 0 }
  const loadVersions = { electron: 0, mpv: 0 }
  const forceNextLoad = { electron: false, mpv: false }
  const pending: Partial<Record<AudioDeviceEngine, Promise<AudioOutputDevice[]>>> = {}
  const mediaDeviceId = ref(normalizeAudioDeviceId(appSetting['player.mediaDeviceId']))
  const deviceListeners = new Set<(label: string) => void>()
  let bindOutput: BindOutput | undefined
  let binding: { id: string, version: number, catalogVersion: number, promise: Promise<void> } | undefined
  let selectionVersion = 0
  let switchVersion = 0
  let disposed = false
  let committing = false
  let lastDeviceLabel: string | undefined

  const reportError = (error: unknown) => {
    if ((error as { code?: string })?.code !== 'AUDIO_DEVICE_SELECTION_CHANGED') console.error('Audio output update failed:', error)
  }
  const snapshot = () => ({ engine: appSetting['player.playEngine'], id: normalizeAudioDeviceId(appSetting['player.mediaDeviceId']), version: selectionVersion })
  const isCurrent = (state: ReturnType<typeof snapshot>) => !disposed && state.version === selectionVersion && state.engine === appSetting['player.playEngine'] && state.id === normalizeAudioDeviceId(appSetting['player.mediaDeviceId'])
  const commit = (patch: Partial<LX.AppSetting>) => {
    if (!Object.entries(patch).some(([key, value]) => appSetting[key as keyof LX.AppSetting] !== value)) return
    committing = true
    try { updateSetting(patch) } finally { committing = false }
  }
  const invalidate = (engine: AudioDeviceEngine) => {
    loadedAt[engine] = 0
    forceNextLoad[engine] = true
    loadVersions[engine]++
    pending[engine] = undefined
  }
  const load = async(engine: AudioDeviceEngine, force = false): Promise<AudioOutputDevice[]> => {
    if (!force && pending[engine]) return pending[engine]
    if (!force && loadedAt[engine] && Date.now() - loadedAt[engine] < 15000) return lists[engine].value
    const version = loadVersions[engine]
    const forceRefresh = force || forceNextLoad[engine]
    forceNextLoad[engine] = false
    const promise = (async() => {
      const devices = engine === 'mpv'
        ? (await mpvPlayer.listAudioDevices({ forceRefresh })).filter(device => device.id !== 'auto').map(device => ({ deviceId: device.id, label: device.name }))
        : (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput').map(device => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }))
      const valid = devices.filter(device => typeof device.deviceId === 'string' && normalizeAudioDeviceId(device.deviceId, '') === device.deviceId)
        .map(device => ({ ...device, label: normalizeAudioDeviceLabel(device.label) }))
      if (!disposed && version === loadVersions[engine]) {
        lists[engine].value = valid
        // Empty results and hidden descriptions are transient, not a successful cache.
        loadedAt[engine] = valid.some(device => !isDefaultAudioDevice(device.deviceId) && device.label.trim()) ? Date.now() : 0
      }
      return valid
    })().catch((error: unknown) => {
      if (version === loadVersions[engine]) loadedAt[engine] = 0
      reportError(error)
      return []
    }).finally(() => {
      if (pending[engine] === promise) pending[engine] = undefined
    })
    pending[engine] = promise
    return promise
  }

  const resolve = async(targetEngine: AudioDeviceEngine, state: ReturnType<typeof snapshot>, explicitId?: string) => {
    const id = explicitId ?? state.id
    const request = getRequestedAudioDevice(id)
    let sourceEngine: AudioDeviceEngine = request.engine ?? (isManagedEngine(state.engine) ? state.engine : targetEngine)
    const catalogVersion = loadVersions[targetEngine]
    const sourceRequest = load(sourceEngine)
    const targetRequest = load(targetEngine)
    const [initialSource, targetDevices] = await Promise.all([sourceRequest, targetRequest])
    let sourceDevices = initialSource
    let preference = getAudioDevicePreference(appSetting)
    if (explicitId !== undefined) {
      const selected = targetDevices.find(device => sameAudioDeviceId(device.deviceId, id))
      if (!isDefaultAudioDevice(id) && !selected?.label.trim()) throw unavailable(t('setting__play_mediaDevice_unavailable', { name: preference.label || t('setting__play_mediaDevice') }))
      sourceEngine = targetEngine
      sourceDevices = targetDevices
      preference = rememberAudioDevice(preference, targetEngine, id, selected?.label ?? '')
    } else if (!isDefaultAudioDevice(request.deviceId) && !sourceDevices.some(device => sameAudioDeviceId(device.deviceId, request.deviceId))) {
      const otherEngine = sourceEngine === 'electron' ? 'mpv' : 'electron'
      const otherDevices = await load(otherEngine)
      const remembered = preference[otherEngine]
      if (otherDevices.some(device => sameAudioDeviceId(device.deviceId, request.deviceId)) || (remembered && sameAudioDeviceId(remembered, request.deviceId))) {
        sourceEngine = otherEngine
        sourceDevices = otherDevices
      }
    }
    const selection = resolveAudioDeviceSelection({ sourceEngine, targetEngine, deviceId: id, preference, sourceDevices, targetDevices })
    const device = targetDevices.find(device => device.deviceId === selection.deviceId && device.label.trim())
    return {
      patch: { 'player.mediaDeviceId': selection.deviceId, ...getAudioDevicePreferenceSetting(selection.preference) },
      available: isDefaultAudioDevice(selection.deviceId) || !!device,
      label: isDefaultAudioDevice(selection.deviceId) ? device?.label ?? t('setting__play_mediaDevice_default') : device?.label ?? '',
      catalogVersion,
    }
  }
  const bind = async(id: string, state: ReturnType<typeof snapshot>, catalogVersion: number) => {
    if (!bindOutput || state.engine !== 'electron') return
    if (!binding || binding.id !== id || binding.version !== state.version || binding.catalogVersion !== catalogVersion) {
      const current = () => isCurrent(state) && catalogVersion === loadVersions.electron
      binding = { id, version: state.version, catalogVersion, promise: bindOutput(id, current) }
    }
    const request = binding
    try {
      await request.promise
    } catch (error) {
      throw unavailable(error instanceof Error ? error.message : String(error))
    } finally { if (binding === request) binding = undefined }
  }
  const apply = async(target: AudioDeviceEngine, strict: boolean, notify = false, explicitId?: string) => {
    const state = snapshot()
    while (isCurrent(state)) {
      const result = await resolve(target, state, explicitId)
      if (!isCurrent(state)) break
      if (result.catalogVersion !== loadVersions[target]) continue
      if (result.available && target === state.engine) await bind(result.patch['player.mediaDeviceId'], state, result.catalogVersion)
      if (!isCurrent(state)) break
      if (result.catalogVersion !== loadVersions[target]) continue
      if (notify && target === 'electron') {
        if (lastDeviceLabel !== undefined && result.label !== lastDeviceLabel) for (const listener of deviceListeners) listener(result.label)
        lastDeviceLabel = result.label
      } else if (result.available && target === 'electron') lastDeviceLabel = result.label
      if (target === state.engine) commit(result.patch)
      else commit({ ...getAudioDevicePreferenceSetting(getAudioDevicePreference(result.patch)), 'player.mediaDeviceLabel': appSetting['player.mediaDeviceLabel'] })
      if (strict && !result.available) throw unavailable(t('setting__play_mediaDevice_unavailable', { name: appSetting['player.mediaDeviceLabel'] || t('setting__play_mediaDevice') }))
      return true
    }
    throw selectionChanged()
  }
  const reconcile = async(notify = false) => {
    const engine = appSetting['player.playEngine']
    if (isManagedEngine(engine)) await apply(engine, false, notify)
  }
  const scheduleReconcile = (notify = false) => { void reconcile(notify).catch(reportError) }
  const prepareEngineChange = async(targetEngine: string): Promise<Partial<LX.AppSetting> | null> => {
    const version = ++switchVersion
    if (!isManagedEngine(targetEngine)) return {}
    const state = snapshot()
    while (isCurrent(state)) {
      const result = await resolve(targetEngine, state)
      if (!isCurrent(state) || version !== switchVersion) return null
      if (result.catalogVersion === loadVersions[targetEngine]) return result.patch
    }
    return null
  }
  const selectMediaDevice = async(id: string) => {
    selectionVersion++
    const engine = appSetting['player.playEngine']
    if (isManagedEngine(engine)) await apply(engine, true, false, normalizeAudioDeviceId(id))
    mediaDeviceId.value = normalizeAudioDeviceId(appSetting['player.mediaDeviceId'])
  }
  const refresh = async() => {
    const engine = appSetting['player.playEngine']
    for (const target of ['electron', 'mpv'] as const) invalidate(target)
    if (isManagedEngine(engine)) {
      await load(engine, true)
      await reconcile(true)
    }
  }
  const handleDeviceChange = () => { void refresh().catch(reportError) }
  const mediaDevices = computed(() => {
    const engine = appSetting['player.playEngine']
    const preference = getAudioDevicePreference(appSetting)
    const selectedId = mediaDeviceId.value
    const devices = isManagedEngine(engine) ? lists[engine].value : []
    const fallbackLabel = isManagedEngine(engine) ? preference[engine === 'electron' ? 'electronLabel' : 'mpvLabel'] || preference.label : preference.label
    const list = [{ deviceId: 'default', label: t('setting__play_mediaDevice_default') }, ...devices.filter(device => device.deviceId !== 'default').map(device => ({
      ...device,
      label: device.label.trim() ? device.label : t('setting__play_mediaDevice_unavailable', { name: device.deviceId === selectedId && fallbackLabel ? fallbackLabel : t('setting__play_mediaDevice') }),
    }))]
    if (!list.some(device => device.deviceId === selectedId)) list.push({ deviceId: selectedId, label: t('setting__play_mediaDevice_unavailable', { name: fallbackLabel || t('setting__play_mediaDevice') }) })
    return list
  })

  watch(() => [appSetting['player.playEngine'], appSetting['player.mediaDeviceId']], () => {
    selectionVersion++
    mediaDeviceId.value = normalizeAudioDeviceId(appSetting['player.mediaDeviceId'])
    if (!committing) scheduleReconcile()
  }, { flush: 'sync' })
  watch(() => [appSetting['player.mediaDeviceLabel'], appSetting['player.mediaDeviceLabel.electron'], appSetting['player.mediaDeviceLabel.mpv'], appSetting['player.mediaDeviceId.electron'], appSetting['player.mediaDeviceId.mpv']], () => {
    if (!committing) scheduleReconcile()
  }, { flush: 'sync' })
  watch(() => appSetting['player.mpv.path'], () => { void refresh().catch(reportError) })
  onMounted(() => { navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange); scheduleReconcile() })
  onBeforeUnmount(() => { disposed = true; selectionVersion++; navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange); deviceListeners.clear(); shared = undefined })

  return {
    mediaDevices,
    mediaDeviceId,
    prepareEngineChange,
    selectMediaDevice,
    refresh,
    ensureForPlayback: async(engine = appSetting['player.playEngine']) => isManagedEngine(engine) ? apply(engine, true) : true,
    registerOutputBinder: (binder: BindOutput) => { bindOutput = binder; return () => { if (bindOutput === binder) bindOutput = undefined } },
    onDeviceChange: (listener: (label: string) => void) => { deviceListeners.add(listener); return () => { deviceListeners.delete(listener) } },
  }
}

let shared: ReturnType<typeof createAudioDevices> | undefined
export default () => (shared ??= createAudioDevices())
export const ensureAudioDeviceForPlayback = async(engine?: LX.AppSetting['player.playEngine']) => shared ? shared.ensureForPlayback(engine) : true
