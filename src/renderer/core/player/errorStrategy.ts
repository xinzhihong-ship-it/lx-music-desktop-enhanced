import { appSetting } from '@renderer/store/setting'
import {
  getPlayErrorActions as resolvePlayErrorActions,
  normalizePlayErrorApiSourceCount,
  normalizePlayErrorRetryCount,
} from '@common/utils/playErrorStrategy'

export type PlayErrorStrategy = LX.AppSetting['player.playErrorStrategy']

export const isPlayErrorHandlingEnabled = () => appSetting['player.autoSkipOnError']

export const getPlayErrorActions = () => isPlayErrorHandlingEnabled()
  ? resolvePlayErrorActions(appSetting['player.playErrorStrategy'], appSetting['player.playErrorStrategyOrder'])
  : []

export const getPlayErrorRetryCount = () => normalizePlayErrorRetryCount(appSetting['player.playErrorRetryCount'])

export const getPlayErrorApiSourceCount = () => normalizePlayErrorApiSourceCount(appSetting['player.playErrorApiSourceCount'])

/**
 * 是否启用严格音质：只有用户明确开启时，实际音质低于请求音质才视为播放失败。
 * 默认关闭：降质只在播放栏标记实际音质，不中断播放、不触发错误恢复。
 * 「直接播放下一曲」策略没有可用的恢复动作，严格音质对其无意义。
 */
export const isStrictPlayQualityEnabled = () => isPlayErrorHandlingEnabled() &&
  appSetting['player.playErrorStrictQuality'] &&
  getPlayErrorActions().some(action => action != 'next')

export const shouldToggleSourceOnError = () => {
  return getPlayErrorActions().includes('platform')
}

export const shouldLowerQualityOnError = () => {
  return getPlayErrorActions().includes('quality')
}

export const shouldSkipOnError = () => {
  return getPlayErrorActions().includes('next')
}
