import { BrowserWindow, ipcMain, session } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import USER_API_RENDERER_EVENT_NAME from './rendererEvent/name'
import { getProxy } from './main'
import { getScript, getUserApis } from './utils'

const TEST_EVENT_NAME = {
  init: 'userApiTest_init',
  request: 'userApiTest_request',
  response: 'userApiTest_response',
}

interface Runtime {
  apiId: string
  window: BrowserWindow
  session: Electron.Session
  sources: Partial<LX.UserApi.UserApiSources>
  initPromise: Promise<Partial<LX.UserApi.UserApiSources>>
  resolveInit: (sources: Partial<LX.UserApi.UserApiSources>) => void
  rejectInit: (error: Error) => void
  requests: Map<string, { resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>
}

const runtimes = new Map<string, Runtime>()
const runtimesByWebContents = new Map<number, Runtime>()
let registered = false

const getUserApiDir = () => process.env.NODE_ENV !== 'production'
  ? webpackUserApiPath
  : path.join(__dirname, 'userApi')

const getPreloadPath = () => process.env.NODE_ENV !== 'production'
  ? path.join(__dirname, '../dist/user-api-preload.js')
  : path.join(__dirname, 'user-api-preload.js')

const rejectRuntime = (runtime: Runtime, error: Error) => {
  for (const request of runtime.requests.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  runtime.requests.clear()
  runtime.rejectInit(error)
}

const destroyRuntime = (runtime: Runtime) => {
  rejectRuntime(runtime, new Error('音源测试已停止'))
  runtimes.delete(runtime.apiId)
  runtimesByWebContents.delete(runtime.window.webContents.id)
  if (!runtime.window.isDestroyed()) runtime.window.destroy()
  void Promise.all([
    runtime.session.clearAuthCache(),
    runtime.session.clearStorageData(),
    runtime.session.clearCache(),
  ]).catch(() => {})
}

const createRuntime = async(apiId: string): Promise<Runtime> => {
  const apiInfo = getUserApis().find(api => api.id == apiId)
  if (!apiInfo) throw new Error('音源不存在')
  const script = await getScript(apiId)
  if (!script) throw new Error('音源脚本不存在')
  const userApiDir = getUserApiDir()
  const html = await fs.readFile(path.join(userApiDir, 'renderer/user-api.html'), 'utf8')
  const testSession = session.fromPartition(`temp:lx-source-test-${apiId}-${Date.now()}`)
  const window = new BrowserWindow({
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    hasShadow: false,
    webPreferences: {
      session: testSession,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,
      spellcheck: false,
      autoplayPolicy: 'document-user-activation-required',
      enableWebSQL: false,
      webgl: false,
      images: false,
      preload: getPreloadPath(),
    },
  })
  for (const eventName of ['will-navigate', 'will-redirect', 'will-attach-webview', 'will-prevent-unload', 'media-started-playing']) {
    window.webContents.on(eventName as any, (event: Electron.Event) => {
      event.preventDefault()
    })
  }
  testSession.setPermissionRequestHandler((webContents, _permission, resolve) => {
    resolve(webContents !== window.webContents)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let resolveInit: (sources: Partial<LX.UserApi.UserApiSources>) => void = () => {}
  let rejectInit: (error: Error) => void = () => {}
  const initPromise = new Promise<Partial<LX.UserApi.UserApiSources>>((resolve, reject) => {
    resolveInit = resolve
    rejectInit = reject
  })
  const runtime: Runtime = {
    apiId,
    window,
    session: testSession,
    sources: {},
    initPromise,
    resolveInit,
    rejectInit,
    requests: new Map(),
  }
  runtimes.set(apiId, runtime)
  runtimesByWebContents.set(window.webContents.id, runtime)
  window.webContents.on('render-process-gone', (_event, details) => {
    if (runtimes.get(apiId) === runtime) destroyRuntime(runtime)
    if (details.reason !== 'clean-exit') runtime.rejectInit(new Error('音源测试实例崩溃'))
  })
  window.on('closed', () => {
    if (runtimes.get(apiId) === runtime) {
      runtimes.delete(apiId)
      runtimesByWebContents.delete(window.webContents.id)
      rejectRuntime(runtime, new Error('音源测试实例已关闭'))
    }
  })
  // Wait until the hidden renderer has completed its first paint before sending
  // initEnv.  The user API preload installs its IPC listener during renderer
  // startup; sending immediately after loadURL can race that listener and leave
  // an otherwise valid source waiting until the initialization timeout.
  let initSent = false
  const sendInit = () => {
    if (initSent || window.isDestroyed()) return
    initSent = true
    window.webContents.send(USER_API_RENDERER_EVENT_NAME.initEnv, {
      ...apiInfo,
      script,
      proxy: getProxy(),
      test: true,
    })
  }
  window.once('ready-to-show', sendInit)
  window.webContents.once('did-finish-load', sendInit)
  await window.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html))
  return runtime
}

const ensureRuntime = async(apiId: string) => {
  const existing = runtimes.get(apiId)
  if (existing) {
    await existing.initPromise
    return existing
  }
  let runtime: Runtime | undefined
  try {
    runtime = await createRuntime(apiId)
    await Promise.race([
      runtime.initPromise,
      new Promise<never>((_resolve, reject) => setTimeout(() => { reject(new Error('音源初始化超时')) }, 20_000)),
    ])
    return runtime
  } catch (error: any) {
    if (runtime) destroyRuntime(runtime)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

const handleInit = (event: Electron.IpcMainEvent, payload: any) => {
  const runtime = runtimesByWebContents.get(event.sender.id)
  if (!runtime) return
  if (!payload?.status) {
    runtime.rejectInit(new Error(String(payload?.message || '音源初始化失败')))
    return
  }
  runtime.sources = payload.data?.sources ?? {}
  runtime.resolveInit(runtime.sources)
}

const handleResponse = (event: Electron.IpcMainEvent, payload: any) => {
  const runtime = runtimesByWebContents.get(event.sender.id)
  const requestKey = payload?.data?.requestKey
  if (!runtime || typeof requestKey !== 'string') return
  const request = runtime.requests.get(requestKey)
  if (!request) return
  runtime.requests.delete(requestKey)
  clearTimeout(request.timer)
  if (payload.status) request.resolve(payload.data.result)
  else request.reject(new Error(String(payload.message || '音源请求失败')))
}

export const registerTestUserApi = () => {
  if (registered) return
  registered = true
  ipcMain.on(TEST_EVENT_NAME.init, handleInit)
  ipcMain.on(TEST_EVENT_NAME.response, handleResponse)
  ipcMain.handle('winMain_test_user_api_sources', async(_event, ids: string[]) => {
    const result: Record<string, Partial<LX.UserApi.UserApiSources>> = {}
    for (const id of Array.isArray(ids) ? ids.slice(0, 20) : []) {
      const runtime = await ensureRuntime(id)
      result[id] = runtime.sources
    }
    return result
  })
  ipcMain.handle('winMain_test_user_api_request', async(_event, params: LX.UserApi.TestUserApiRequestParams) => {
    if (!params || typeof params.apiId !== 'string' || typeof params.requestKey !== 'string') throw new Error('测试参数无效')
    const runtime = await ensureRuntime(params.apiId)
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        runtime.requests.delete(params.requestKey)
        reject(new Error('音源请求超时'))
      }, 10_000)
      runtime.requests.set(params.requestKey, { resolve, reject, timer })
      runtime.window.webContents.send(TEST_EVENT_NAME.request, { requestKey: params.requestKey, data: params.data })
    })
  })
  ipcMain.on('winMain_test_user_api_cancel', (_event, requestKey: string) => {
    if (typeof requestKey !== 'string') return
    for (const runtime of runtimes.values()) {
      const request = runtime.requests.get(requestKey)
      if (!request) continue
      clearTimeout(request.timer)
      runtime.requests.delete(requestKey)
      request.reject(new Error('测试请求已取消'))
    }
  })
  ipcMain.on('winMain_test_user_api_stop', (_event, ids?: string[]) => {
    const selected = Array.isArray(ids) ? new Set(ids) : null
    for (const runtime of [...runtimes.values()]) {
      if (!selected || selected.has(runtime.apiId)) destroyRuntime(runtime)
    }
  })
}

export const stopTestUserApis = (ids?: string[]) => {
  const selected = Array.isArray(ids) ? new Set(ids) : null
  for (const runtime of [...runtimes.values()]) {
    if (!selected || selected.has(runtime.apiId)) destroyRuntime(runtime)
  }
}
