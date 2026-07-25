/**
 * This file is used specifically and only for development. It installs
 * `electron-debug` & `vue-devtools`. There shouldn't be any need to
 *  modify this file, but it can be used to extend your development
 *  environment.
 */

import { app } from 'electron'
import electronDebug from 'electron-debug'
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer'
import { openDevTools } from './utils'
// Install `electron-debug` with `devtron`
electronDebug({
  showDevTools: false,
  devToolsMode: 'undocked',
})

let vueDevtoolsInstallPromise: Promise<string> | null = null
const installVueDevtools = async(session: Electron.Session) => {
  vueDevtoolsInstallPromise ??= installExtension(VUEJS_DEVTOOLS, { session })
    .then((name: string) => {
      console.log(`[开发工具] 已安装扩展：${name}`)
      return name
    })
    .catch((err: Error) => {
      console.warn(`[开发工具] Vue DevTools 安装失败，已跳过：${err.message}`)
      return ''
    })
  return vueDevtoolsInstallPromise
}

// Install `vue-devtools`
app.on('ready', () => {
  global.lx.event_app.on('main_window_created', (win) => {
    openDevTools(win.webContents)
    void installVueDevtools(win.webContents.session)
  })
  global.lx.event_app.on('desktop_lyric_window_created', (win) => {
    openDevTools(win.webContents)
    void installVueDevtools(win.webContents.session)
  })
})

// Require `main` process to boot app
require('./index')
