import { onBeforeUnmount } from '@common/utils/vueTools'
import { pause } from '@renderer/core/player/action'
import { setMediaDeviceId } from '@renderer/plugins/player'
import { isPlay } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import useAudioDevices from '@renderer/utils/compositions/useAudioDevices'

export default () => {
  const devices = useAudioDevices()
  // Only the shared service may resolve hardware identity or persist a device.
  // The existing player still owns the serialized output-sink transaction.
  const removeBinder = devices.registerOutputBinder(setMediaDeviceId)
  const removeDeviceListener = devices.onDeviceChange(() => {
    window.app_event.playerDeviceChanged()
    if (appSetting['player.isMediaDeviceRemovedStopPlay'] && isPlay.value) {
      window.lx.isPlayedStop = true
      pause()
    }
  })
  onBeforeUnmount(() => {
    removeBinder()
    removeDeviceListener()
  })
}
