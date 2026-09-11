import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ipcMain } from 'electron'
import { mainHandle, mainOn } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { fetchSongKeyAudio } from '@main/utils/songKeyAudio'
import { getBiliCdnHeaders } from '../mpvVideoController'
import {
  createSongKeyWindow,
  closeSongKeyWindow,
  syncSongKeyDataToWindow,
} from '../songKeyWindow'
import { writeAutoKeyHandoff, getAutoKeyCodes, type AutoKeyHandoffPayload } from '@main/utils/autoKeyHandoff'
import { sendEvent } from '../main'

export interface SongKeyAudioPayload {
  source: string
  maxBytes: number
}

export interface SongKeyAudioResult {
  bytes: Uint8Array
  totalBytes: number | null
  truncated: boolean
}

const normalizeSource = (source: unknown): string | null => {
  if (typeof source !== 'string' || source.length === 0 || source.length > 8192 || source.includes('\0')) return null
  if (/^https?:\/\//i.test(source)) return source
  if (/^file:\/\//i.test(source)) {
    try { return fileURLToPath(source) } catch { return null }
  }
  return path.isAbsolute(source) ? source : null
}

export default () => {
  // 音频抓取
  mainHandle<SongKeyAudioPayload, SongKeyAudioResult | null>(
    WIN_MAIN_RENDERER_EVENT_NAME.song_key_fetch_audio,
    async({ params }) => {
      const source = normalizeSource(params?.source)
      if (!source) return null
      const headers = /\.bilivideo\.(?:com|cn)(?::\d+)?\//i.test(source) ? getBiliCdnHeaders() : {}
      try {
        const chunk = await fetchSongKeyAudio(source, params?.maxBytes, headers)
        if (!chunk) return null
        return {
          bytes: chunk.bytes,
          totalBytes: chunk.totalBytes,
          truncated: chunk.truncated,
        }
      } catch {
        return null
      }
    },
  )

  // 独立基调窗口打开/关闭/同步
  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.open_song_key_window, () => {
    createSongKeyWindow()
  })

  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.close_song_key_window, () => {
    closeSongKeyWindow()
  })

  mainHandle<any, boolean>(
    WIN_MAIN_RENDERER_EVENT_NAME.sync_song_key_data,
    async({ params }) => {
      return syncSongKeyDataToWindow(params)
    },
  )

  // 独立窗口发起的保存/重置请求，转发给主窗口渲染进程执行
  ipcMain.on('winMain_song_key_window_save_action', (_event, data) => {
    sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.song_key_window_save_action, data)
  })

  ipcMain.on('winMain_song_key_window_reset_action', (_event, data) => {
    sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.song_key_window_reset_action, data)
  })

  ipcMain.on('winMain_song_key_window_reanalyze_action', (_event, data) => {
    sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.song_key_window_reanalyze_action, data)
  })

  ipcMain.on('winMain_song_key_window_toggle_plugin_sync', (_event, enabled: boolean) => {
    sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.song_key_window_toggle_plugin_sync, enabled)
  })

  ipcMain.on('winMain_song_key_window_set_retune_speed', (_event, speed: number) => {
    sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.song_key_window_set_retune_speed, speed)
  })

  // 独立窗口点击音名/调式/分段即时试听同步
  ipcMain.on('song_key_window_instant_audition', (_event, data: any) => {
    if (!data?.key) return
    const { keyClass, keyType } = getAutoKeyCodes(data.key, data.scale)
    writeAutoKeyHandoff({
      key: data.key,
      scale: data.scale,
      keyClass,
      keyType,
      label: data.label ?? '',
    })
  })

  // 机架 / VST3 / Auto-Tune 电音插件同步通道
  mainHandle<AutoKeyHandoffPayload, boolean>(
    WIN_MAIN_RENDERER_EVENT_NAME.song_key_sync_plugin,
    async({ params }) => {
      return writeAutoKeyHandoff(params)
    },
  )
}
