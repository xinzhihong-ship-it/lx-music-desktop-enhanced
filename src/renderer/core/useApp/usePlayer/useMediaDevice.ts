import {
  onBeforeUnmount,
  watch,
} from '@common/utils/vueTools'
import { pause } from '@renderer/core/player/action'
import { dialog } from '@renderer/plugins/Dialog'
import { setMediaDeviceId } from '@renderer/plugins/player'
import { isPlay } from '@renderer/store/player/state'
import { appSetting, saveMediaDeviceId } from '@renderer/store/setting'

const getDevices = async() => {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter(({ kind }) => kind == 'audiooutput')
}

let isShowingTipAlert = false

export default () => {
  // MPV 引擎使用 mpv 自己的音频设备管理，Web Audio 设备列表里找不到 mpv 设备 ID，
  // 强行匹配会把 player.mediaDeviceId 重置回 default。
  const isMpvEngine = () => appSetting['player.playEngine'] === 'mpv'

  let prevDeviceLabel: string | null = null
  let prevDeviceId = ''
  let deviceRequestVersion = 0
  let deviceChange = Promise.resolve()

  const getMediaDevice = async(deviceId: string) => {
    const requestedDeviceId = deviceId || 'default'
    const devices = await getDevices()
    const device = devices.find(item => item.deviceId === requestedDeviceId)

    if (!device && !devices.length && !isShowingTipAlert) {
      isShowingTipAlert = true
      void dialog({
        message: window.i18n.t('media_device__empty_device_tip'),
        confirmButtonText: window.i18n.t('ok'),
      }).finally(() => {
        isShowingTipAlert = false
      })
    }

    // Keep the requested ID when enumeration is temporarily stale or the device
    // disappeared. The player will retry it on the next devicechange instead of
    // silently persisting `default`.
    return device
      ? { label: device.label, deviceId: device.deviceId }
      : { label: '', deviceId: requestedDeviceId }
  }

  const setMediaDevice = async(deviceId: string, label: string, requestVersion: number, requestedDeviceId: string) => {
    prevDeviceLabel = label
    deviceChange = deviceChange.catch(() => {}).then(async() => {
      if (
        requestVersion !== deviceRequestVersion ||
        isMpvEngine() ||
        appSetting['player.mediaDeviceId'] !== requestedDeviceId
      ) return
      try {
        await setMediaDeviceId(deviceId)
        // 只保存最后一次仍然有效且成功绑定的设备，避免旧请求覆盖新选择。
        if (requestVersion !== deviceRequestVersion || appSetting['player.mediaDeviceId'] !== requestedDeviceId) return
        prevDeviceId = deviceId
        saveMediaDeviceId(deviceId)
      } catch (err: any) {
        console.error('set media device failed:', err?.message ?? err)
        // 路由重建期间的短暂失败不应把用户选择改写成 default；
        // 下一次路由/设备变更会再次尝试当前设置。
      }
    })
    await deviceChange
  }

  const handleDeviceChange = (label: string) => {
    // console.log(device)
    // console.log(appSetting['player.isMediaDeviceRemovedStopPlay'], isPlay.value, label, prevDeviceLabel)
    if (label != prevDeviceLabel) {
      window.app_event.playerDeviceChanged()

      if (appSetting['player.isMediaDeviceRemovedStopPlay'] && isPlay.value) {
        window.lx.isPlayedStop = true
        pause()
      }
    }
  }

  const logDeviceRequestError = (err: unknown) => {
    console.error('media device enumeration failed:', err instanceof Error ? err.message : err)
  }

  const handleMediaListChange = async() => {
    if (isMpvEngine()) return
    const mediaDeviceId = appSetting['player.mediaDeviceId']
    const requestVersion = ++deviceRequestVersion
    try {
      const device = await getMediaDevice(mediaDeviceId)
      if (requestVersion !== deviceRequestVersion || appSetting['player.mediaDeviceId'] !== mediaDeviceId) return

      handleDeviceChange(device.label)
      await setMediaDevice(device.deviceId, device.label, requestVersion, mediaDeviceId)
    } catch (err) {
      logDeviceRequestError(err)
    }
  }

  watch(() => appSetting['player.mediaDeviceId'], (id) => {
    if (isMpvEngine() || prevDeviceId == id) return
    const requestVersion = ++deviceRequestVersion
    void getMediaDevice(id).then(async({ deviceId, label }) => {
      if (requestVersion !== deviceRequestVersion || appSetting['player.mediaDeviceId'] !== id) return
      await setMediaDevice(deviceId, label, requestVersion, id)
    }).catch(logDeviceRequestError)
  })

  if (!isMpvEngine()) {
    const requestedDeviceId = appSetting['player.mediaDeviceId']
    const requestVersion = ++deviceRequestVersion
    void getMediaDevice(requestedDeviceId).then(async({ deviceId, label }) => {
      if (requestVersion !== deviceRequestVersion || appSetting['player.mediaDeviceId'] !== requestedDeviceId) return
      await setMediaDevice(deviceId, label, requestVersion, requestedDeviceId)
    }).catch(logDeviceRequestError)

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    navigator.mediaDevices.addEventListener('devicechange', handleMediaListChange)
  }

  onBeforeUnmount(() => {
    deviceRequestVersion++
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    navigator.mediaDevices.removeEventListener('devicechange', handleMediaListChange)
  })
}
