import { apiSource, qualityList, userApi } from '@renderer/store'
import { appSetting, setApiSource } from '@renderer/store/setting'
import { setUserApi as setUserApiAction } from '@renderer/utils/ipc'
import musicSdk from '@renderer/utils/musicSdk'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { ALWAYS_SUPPORTED_SOURCE_QUALITYS } from '@common/constants'

let prevId = ''
/** 当前请求生效的音源 id（运行时）。临时切换音源时它与设置中保存的 common.apiSource 不同。 */
export const getRequestedApiId = () => prevId
/**
 * 切换当前使用的音源。
 * @param persist 是否写回设置。错误恢复临时换源时传 false：只切换运行时音源，不改用户配置，
 * 恢复结束后再切回 appSetting['common.apiSource']。
 */
export const setUserApi = async(apiId: string, { persist = true }: { persist?: boolean } = {}) => {
  if (prevId == apiId) return
  prevId = apiId
  if (window.lx.apiInitPromise[1]) {
    window.lx.apiInitPromise[0] = new Promise<boolean>(resolve => {
      window.lx.apiInitPromise[1] = false
      window.lx.apiInitPromise[2] = (result: boolean) => {
        window.lx.apiInitPromise[1] = true
        resolve(result)
      }
    })
  }

  if (/^user_api/.test(apiId)) {
    qualityList.value = { ...ALWAYS_SUPPORTED_SOURCE_QUALITYS }
    userApi.status = false
    userApi.message = 'initing'

    await setUserApiAction(apiId).then(() => {
      if (prevId != apiId) return
      apiSource.value = apiId
    }).catch(err => {
      if (prevId != apiId) return
      if (!window.lx.apiInitPromise[1]) window.lx.apiInitPromise[2](false)
      console.log(err)
      let api = apiSourceInfo.find(api => !api.disabled)
      if (!api) return
      apiSource.value = api.id
      if (persist && api.id != appSetting['common.apiSource']) setApiSource(api.id)
    })
  } else {
    qualityList.value = { ...ALWAYS_SUPPORTED_SOURCE_QUALITYS, ...(musicSdk.supportQuality[apiId] ?? {}) }
    apiSource.value = apiId
    void setUserApiAction(apiId)
    if (!window.lx.apiInitPromise[1]) window.lx.apiInitPromise[2](true)
  }

  if (prevId != apiId) return
  if (persist && apiId != appSetting['common.apiSource']) setApiSource(apiId)
}
