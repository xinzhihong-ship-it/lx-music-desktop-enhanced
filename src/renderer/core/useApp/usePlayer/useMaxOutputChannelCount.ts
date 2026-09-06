import { watch } from '@common/utils/vueTools'
import { setMaxOutputChannelCount } from '@renderer/plugins/player'

import { appSetting } from '@renderer/store/setting'

export default () => {
  const isElectronEngine = () => appSetting['player.playEngine'] === 'electron'
  const applyMaxOutputChannelCount = (enabled: boolean) => {
    if (!isElectronEngine()) return
    setMaxOutputChannelCount(enabled)
  }

  applyMaxOutputChannelCount(appSetting['player.isMaxOutputChannelCount'])
  watch(() => appSetting['player.isMaxOutputChannelCount'], (val) => {
    applyMaxOutputChannelCount(val)
  })
  watch(() => appSetting['player.playEngine'], () => {
    applyMaxOutputChannelCount(appSetting['player.isMaxOutputChannelCount'])
  })
}

