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

export const shouldToggleSourceOnError = () => {
  return getPlayErrorActions().includes('platform')
}

export const shouldLowerQualityOnError = () => {
  return getPlayErrorActions().includes('quality')
}

export const shouldSkipOnError = () => {
  return getPlayErrorActions().includes('next')
}
