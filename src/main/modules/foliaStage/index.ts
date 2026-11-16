// 「推送到 Folia 歌词舞台」：设置开关、主进程播放状态、Folia Stage API 之间的接线。
// 状态机在 bridge.ts，请求在 client.ts，歌词转换在 lyric.ts，封面在 cover.ts，连接文件在 connection.ts。
import { app } from 'electron'
import { log } from '@common/utils'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { createFoliaStageBridge, type FoliaStageStatus } from './bridge'
import { requestStage } from './client'
import { readStageConnection, resolveConnectionFilePaths, resolveSystemAppDataDir } from './connection'
import { resolveFoliaCover } from './cover'
import { buildFoliaLyricContent } from './lyric'

let isRegistered = false
export default () => {
  if (isRegistered) return
  isRegistered = true

  const connectionFilePaths = resolveConnectionFilePaths({
    platform: process.platform,
    env: process.env,
    appDataDir: resolveSystemAppDataDir({ platform: process.platform, env: process.env }),
  })

  const bridge = createFoliaStageBridge({
    readConnection: async() => readStageConnection(connectionFilePaths),
    request: requestStage,
    buildLyricContent: buildFoliaLyricContent,
    resolveCover: async picUrl => resolveFoliaCover(picUrl),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => { clearTimeout(handle as NodeJS.Timeout) },
    log: (level, message, detail) => {
      if (detail === undefined) log[level](message)
      else log[level](message, detail)
    },
  })

  let enabled = false
  const setEnabled = (value: boolean) => {
    enabled = value
    bridge.setEnabled(value, global.lx.player_status)
  }

  // 关着时不跟踪：开启时从主进程当前的播放状态补齐
  global.lx.event_app.on('player_status', status => {
    if (enabled) bridge.handleStatus(status)
  })
  global.lx.event_app.on('updated_config', (keys, setting) => {
    if (keys.includes('foliaStage.enable')) setEnabled(!!setting['foliaStage.enable'])
  })
  setEnabled(!!global.lx.appSetting['foliaStage.enable'])

  mainHandle<FoliaStageStatus>(WIN_MAIN_RENDERER_EVENT_NAME.folia_stage_status, async() => bridge.getStatus())

  app.on('before-quit', () => { bridge.shutdown() })
}
