import { log } from '@common/utils'
import { closeWindow } from './main'
import { getUserApis, importApi as handleImportApi, removeApi as handleRemoveApi, setAllowShowUpdateAlert as saveAllowShowUpdateAlert } from './utils'
import { loadApi, setAllowShowUpdateAlert as setRendererEventAllowShowUpdateAlert, init } from './rendererEvent/rendererEvent'

let userApiId: string | null

const toPlainObject = <T>(value: T): T => {
  // 通过 JSON 往返清洗，确保返回值可被 Electron IPC structured clone 序列化
  return JSON.parse(JSON.stringify(value))
}

export const getApiList = (): LX.UserApi.UserApiInfo[] => {
  return toPlainObject(getUserApis())
}

export const importApi = async(script: string): Promise<LX.UserApi.ImportUserApi> => {
  try {
    const apiInfo = await handleImportApi(script)
    const apiList = getUserApis()
    const result = toPlainObject({ apiInfo, apiList })
    log.info('[importApi] success, apiInfo:', result.apiInfo, 'apiList length:', result.apiList.length)
    return result
  } catch (err: any) {
    log.error('[importApi] error:', err)
    let message = err?.message
    if (message == null) message = err instanceof Error ? err.toString() : String(err)
    throw new Error(message || '自定义源导入失败')
  }
}
export const removeApi = async(ids: string[]): Promise<LX.UserApi.UserApiInfo[]> => {
  if (userApiId && ids.includes(userApiId)) {
    userApiId = null
    await closeWindow()
  }
  handleRemoveApi(ids)
  return toPlainObject(getUserApis())
}

export const setApi = async(id: string) => {
  if (userApiId) {
    userApiId = null
    await closeWindow()
  }
  const apiList = getUserApis()
  if (!apiList.some(a => a.id === id)) return
  userApiId ||= id
  await loadApi(id)
}

export const setAllowShowUpdateAlert = (id: string, enable: boolean) => {
  saveAllowShowUpdateAlert(id, enable)
  setRendererEventAllowShowUpdateAlert(id, enable)
}


export * from './rendererEvent/rendererEvent'

export default () => {
  init()

  global.lx.event_app.on('main_window_close', () => {
    void closeWindow()
  })
}
