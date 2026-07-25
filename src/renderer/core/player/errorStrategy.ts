import { appSetting } from '@renderer/store/setting'

export type PlayErrorStrategy = LX.AppSetting['player.playErrorStrategy']

export const isPlayErrorHandlingEnabled = () => appSetting['player.autoSkipOnError']

export const shouldToggleSourceOnError = () => {
  if (!isPlayErrorHandlingEnabled()) return false
  return appSetting['player.playErrorStrategy'] == 'auto' || appSetting['player.playErrorStrategy'] == 'source'
}

export const shouldLowerQualityOnError = () => {
  if (!isPlayErrorHandlingEnabled()) return false
  return appSetting['player.playErrorStrategy'] == 'auto' || appSetting['player.playErrorStrategy'] == 'quality'
}

export const shouldSkipOnError = () => {
  if (!isPlayErrorHandlingEnabled()) return false
  return appSetting['player.playErrorStrategy'] == 'auto' || appSetting['player.playErrorStrategy'] == 'next'
}
