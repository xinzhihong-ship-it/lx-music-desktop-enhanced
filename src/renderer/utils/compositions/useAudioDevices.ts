import { computed, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import {
  getAudioDevicePreference,
  getAudioDevicePreferenceSetting,
  getRequestedAudioDevice,
  isDefaultAudioDevice,
  resolveAudioDeviceSelection,
  sameAudioDeviceId,
  type AudioDeviceEngine,
  type AudioOutputDevice,
} from '@common/utils/audioDeviceSelection'
import * as mpvPlayer from '@renderer/plugins/player/mpv'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { useI18n } from '@renderer/plugins/i18n'

const isManagedEngine = (engine: string): engine is AudioDeviceEngine => engine === 'electron' || engine === 'mpv'

const createAudioDevices = () => {
  const t = useI18n()
  const lists = { electron: ref<AudioOutputDevice[]>([]), mpv: ref<AudioOutputDevice[]>([]) }
  const loaded = { electron: false, mpv: false }
  const loadVersions = { electron: 0, mpv: 0 }
  const pending: Partial<Record<AudioDeviceEngine, Promise<AudioOutputDevice[]>>> = {}
  const mediaDeviceId = ref(appSetting['player.mediaDeviceId'])
  let requestVersion = 0
  let disposed = false

  const load = async(engine: AudioDeviceEngine, force = false): Promise<AudioOutputDevice[]> => {
    if (!force && pending[engine]) return pending[engine]
    if (!force && loaded[engine]) return Promise.resolve(lists[engine].value)
    const version = ++loadVersions[engine]
    const promise = (async() => {
      let devices: AudioOutputDevice[]
      if (engine === 'mpv') {
        devices = (await mpvPlayer.listAudioDevices()).filter(device => device.id !== 'auto')
          .map(device => ({ deviceId: device.id, label: device.name }))
      } else {
        devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput')
          .map(device => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }))
      }
      if (!disposed && version === loadVersions[engine]) {
        lists[engine].value = devices
        loaded[engine] = true
      }
      return devices
    })().catch((error: unknown) => {
      console.error('Audio device enumeration failed:', error)
      return lists[engine].value
    }).finally(() => {
      if (pending[engine] === promise) pending[engine] = undefined
    })
    pending[engine] = promise
    return promise
  }

  const prepareEngineChange = async(targetEngine: string): Promise<Partial<LX.AppSetting> | null> => {
    const version = ++requestVersion
    if (!isManagedEngine(targetEngine)) return {}
    const previousEngine = appSetting['player.playEngine']
    const deviceId = appSetting['player.mediaDeviceId']
    const request = getRequestedAudioDevice(deviceId)
    let sourceEngine: AudioDeviceEngine = request.engine ?? (isManagedEngine(previousEngine) ? previousEngine : targetEngine)
    const [initialSourceDevices, targetDevices] = await Promise.all([load(sourceEngine), load(targetEngine)])
    let sourceDevices = initialSourceDevices
    // Recover legacy settings that still contain the other engine's ID.
    if (!isDefaultAudioDevice(request.deviceId) && !sourceDevices.some(device => sameAudioDeviceId(device.deviceId, request.deviceId))) {
      const otherEngine = sourceEngine === 'electron' ? 'mpv' : 'electron'
      const otherDevices = await load(otherEngine)
      const remembered = getAudioDevicePreference(appSetting)[otherEngine]
      if (otherDevices.some(device => sameAudioDeviceId(device.deviceId, request.deviceId)) || (remembered && sameAudioDeviceId(remembered, request.deviceId))) {
        sourceEngine = otherEngine
        sourceDevices = otherDevices
      }
    }
    if (disposed || version !== requestVersion || appSetting['player.playEngine'] !== previousEngine || appSetting['player.mediaDeviceId'] !== deviceId) return null
    const selection = resolveAudioDeviceSelection({
      sourceEngine,
      targetEngine,
      deviceId,
      preference: getAudioDevicePreference(appSetting),
      sourceDevices,
      targetDevices,
    })
    return { 'player.mediaDeviceId': selection.deviceId, ...getAudioDevicePreferenceSetting(selection.preference) }
  }

  const reconcile = async() => {
    const engine = appSetting['player.playEngine']
    if (!isManagedEngine(engine)) return
    const patch = await prepareEngineChange(engine)
    if (!patch) return
    if (Object.entries(patch).some(([key, value]) => appSetting[key as keyof LX.AppSetting] !== value)) updateSetting(patch)
  }
  const refresh = async() => {
    const engine = appSetting['player.playEngine']
    if (!isManagedEngine(engine)) return
    requestVersion++
    await load(engine, true)
    if (appSetting['player.playEngine'] === engine && !disposed) await reconcile()
  }
  const handleDeviceChange = () => {
    for (const engine of ['electron', 'mpv'] as const) {
      loaded[engine] = false
      loadVersions[engine]++
      pending[engine] = undefined
    }
    void refresh()
  }
  const mediaDevices = computed(() => {
    const engine = appSetting['player.playEngine']
    const devices = isManagedEngine(engine) ? lists[engine].value : []
    const list = [{ deviceId: 'default', label: t('setting__play_mediaDevice_default') }, ...devices.filter(device => device.deviceId !== 'default')]
    const selectedId = mediaDeviceId.value
    if (selectedId && !list.some(device => device.deviceId === selectedId)) {
      const name = appSetting['player.mediaDeviceLabel'] || t('setting__play_mediaDevice')
      list.push({ deviceId: selectedId, label: t('setting__play_mediaDevice_unavailable', { name }) })
    }
    return list
  })

  const ensureForPlayback = async(targetEngine = appSetting['player.playEngine']): Promise<boolean> => {
    if (!isManagedEngine(targetEngine)) return true
    const activeEngine = appSetting['player.playEngine']
    const patch = await prepareEngineChange(targetEngine)
    if (!patch?.['player.mediaDeviceId']) return false
    const id = patch['player.mediaDeviceId']
    const available = isDefaultAudioDevice(id) || (loaded[targetEngine] && lists[targetEngine].value.some(device => sameAudioDeviceId(device.deviceId, id)))
    if (targetEngine === activeEngine) {
      if (Object.entries(patch).some(([key, value]) => appSetting[key as keyof LX.AppSetting] !== value)) updateSetting(patch)
    } else {
      const activeDevice = isManagedEngine(activeEngine) ? lists[activeEngine].value.find(device => sameAudioDeviceId(device.deviceId, appSetting['player.mediaDeviceId'])) : undefined
      const activeLabel = activeDevice?.label || appSetting['player.mediaDeviceLabel']
      updateSetting({ ...getAudioDevicePreferenceSetting(getAudioDevicePreference(patch)), 'player.mediaDeviceLabel': activeLabel })
    }
    if (!available) throw new Error(t('setting__play_mediaDevice_unavailable', { name: appSetting['player.mediaDeviceLabel'] || t('setting__play_mediaDevice') }))
    return true
  }

  watch(() => appSetting['player.mediaDeviceId'], id => {
    requestVersion++
    mediaDeviceId.value = id
  })
  watch(() => appSetting['player.playEngine'], () => { void reconcile() })
  watch(() => [appSetting['player.mediaDeviceLabel'], appSetting['player.mediaDeviceLabel.electron'], appSetting['player.mediaDeviceLabel.mpv'], appSetting['player.mediaDeviceId.electron'], appSetting['player.mediaDeviceId.mpv']], () => { void reconcile() })
  watch(() => appSetting['player.mpv.path'], () => {
    loaded.mpv = false
    loadVersions.mpv++
    pending.mpv = undefined
    if (appSetting['player.playEngine'] === 'mpv') void refresh()
  })
  onMounted(() => {
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    void reconcile()
  })
  onBeforeUnmount(() => {
    disposed = true
    requestVersion++
    navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    shared = undefined
  })

  return { mediaDevices, mediaDeviceId, prepareEngineChange, ensureForPlayback }
}

let shared: ReturnType<typeof createAudioDevices> | undefined
export default () => (shared ??= createAudioDevices())
export const ensureAudioDeviceForPlayback = async(engine?: LX.AppSetting['player.playEngine']) => shared ? shared.ensureForPlayback(engine) : true
