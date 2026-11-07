import { createApp } from 'vue'

import { i18nPlugin } from './plugins/i18n'

import mountComponents from './components'

import App from './App.vue'
import IslandApp from './IslandApp.vue'

import '@root/common/error'
import { getSetting, onMainWindowInited, onSettingChanged, sendConnectMainWindowEvent } from './utils/ipc'
import { initSetting, mergeSetting } from './store/action'
import { init as initMainWindowChannel } from './core/mainWindowChannel'

window.ELECTRON_DISABLE_SECURITY_WARNINGS = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS

void getSetting().then((setting) => {
  // window.lx.appSetting = setting
  // Set language automatically
  const languageId = setting['common.langId']
  if (window.i18n.locale !== languageId && languageId != null) {
    window.i18n.setLanguage(languageId)
    window.setLang(languageId)
  }

  // store.commit('setSetting', setting)
  initSetting(setting)

  onSettingChanged(({ params: setting }) => {
    // console.log('onSettingChanged', setting)
    mergeSetting(setting)
  })
  onMainWindowInited(() => {
    sendConnectMainWindowEvent()
  })
  initMainWindowChannel()

  // 同一个渲染包：mode=island 时挂载顶部歌词岛
  const isIsland = new URLSearchParams(location.search).get('mode') == 'island'
  const app = createApp(isIsland ? IslandApp : App)
  app.use(i18nPlugin)
  mountComponents(app)
  app.mount('#root')
})
