import { STORE_NAMES } from '@common/constants'
import getStore from '@main/utils/store'

const CONFIG_KEY = 'acrcloudConfig'

const DEFAULT_CONFIG: LX.MusicRecognition.AcrcloudConfig = {
  enabled: false,
  host: '',
  accessKey: '',
  accessSecret: '',
}

let configStore: ReturnType<typeof getStore> | null = null

const getConfigStore = () => {
  configStore ??= getStore(STORE_NAMES.MUSIC_RECOGNITION)
  return configStore
}

export const getAcrcloudConfig = (): LX.MusicRecognition.AcrcloudConfig => {
  return { ...DEFAULT_CONFIG, ...getConfigStore().get<Partial<LX.MusicRecognition.AcrcloudConfig>>(CONFIG_KEY) }
}

export const setAcrcloudConfig = (config: LX.MusicRecognition.AcrcloudConfig): LX.MusicRecognition.AcrcloudConfig => {
  getConfigStore().set(CONFIG_KEY, {
    enabled: Boolean(config.enabled),
    host: config.host.trim(),
    accessKey: config.accessKey.trim(),
    accessSecret: config.accessSecret.trim(),
  })
  return getAcrcloudConfig()
}
