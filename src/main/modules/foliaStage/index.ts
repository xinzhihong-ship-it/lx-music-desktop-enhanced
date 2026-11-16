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
import { isFoliaLinkClientActive, onFoliaLinkClientActiveChange } from '../foliaLink/presence'

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
  // 设置里的开关；Folia 经「Folia 对接」连着时它自己跟随本软件播放，舞台推送暂停，免得舞台把 Folia 的播放挤掉
  let wanted = false
  const applyEnabled = () => {
    const value = wanted && !isFoliaLinkClientActive()
    if (value === enabled) return
    enabled = value
    bridge.setEnabled(value, global.lx.player_status)
  }
  const setEnabled = (value: boolean) => {
    wanted = value
    applyEnabled()
  }
  onFoliaLinkClientActiveChange(applyEnabled)

  // 关着时不跟踪：开启时从主进程当前的播放状态补齐
  global.lx.event_app.on('player_status', status => {
    if (enabled) bridge.handleStatus(status)
  })
  global.lx.event_app.on('updated_config', (keys, setting) => {
    if (keys.includes('foliaStage.enable')) setEnabled(!!setting['foliaStage.enable'])
  })
  setEnabled(!!global.lx.appSetting['foliaStage.enable'])

  mainHandle<FoliaStageStatus & { pausedByLink: boolean }>(WIN_MAIN_RENDERER_EVENT_NAME.folia_stage_status, async() => ({
    ...bridge.getStatus(),
    pausedByLink: wanted && isFoliaLinkClientActive(),
  }))

  app.on('before-quit', () => { bridge.shutdown() })
}
