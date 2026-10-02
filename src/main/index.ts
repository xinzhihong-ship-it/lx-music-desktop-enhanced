import { app } from 'electron'
import './utils/logInit'
import '@common/error'
import {
  initGlobalData,
  initSingleInstanceHandle,
  applyElectronEnvParams,
  setUserDataPath,
  registerDeeplink,
  listenerAppEvent,
} from './app'
import { isLinux, log } from '@common/utils'
import { initAppSetting } from '@main/app'
import registerModules from '@main/modules'
import { MpvController } from '@main/modules/winMain/mpvController'

// 初始化应用
let isInited = false
const init = () => {
  if (isInited) return
  isInited = true
  console.log('init')
  void initAppSetting().then(() => {
    registerModules()
    global.lx.event_app.app_inited()
    // 后台预热 mpv：把首次运行的 Gatekeeper 在线校验与（macOS x86_64 版本的）
    // Rosetta 翻译开销提前消化，避免用户首次枚举音频设备/播放时因超时而失败。
    // 不阻塞启动流程，失败仅记日志。
    void MpvController.warmupMpv().catch((err: Error) => {
      log.warn(`mpv warmup failed: ${err.message}`)
    })
  })
}

initGlobalData()
initSingleInstanceHandle()
applyElectronEnvParams()
setUserDataPath()
registerDeeplink(init)
listenerAppEvent(init)


// https://github.com/electron/electron/issues/16809
void app.whenReady().then(() => {
  isLinux ? setTimeout(init, 300) : init()
})
