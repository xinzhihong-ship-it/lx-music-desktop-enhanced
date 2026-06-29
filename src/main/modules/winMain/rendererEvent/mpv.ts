import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mpvController, MpvController } from '../mpvController'

const notFoundMessage = '未找到 mpv，请安装 mpv、设置 mpv 路径，或放置内置 mpv'

const withMpvError = async<T>(handler: () => Promise<T>): Promise<T> => {
  try {
    return await handler()
  } catch (err: any) {
    if (err?.code == 'ENOENT') throw new Error(notFoundMessage)
    throw err
  }
}

export default () => {
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_init, async() => {
    return withMpvError(async() => mpvController.ensureStarted())
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_loadUrl, async({ params: url }) => {
    return withMpvError(async() => mpvController.loadUrl(url))
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_play, async() => {
    return withMpvError(async() => mpvController.play())
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_pause, async() => {
    return withMpvError(async() => mpvController.pause())
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_stop, async() => {
    return withMpvError(async() => mpvController.stop())
  })
  mainHandle<number>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_seek, async({ params: seconds }) => {
    return withMpvError(async() => mpvController.seek(seconds))
  })
  mainHandle<number>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_setVolume, async({ params: volume }) => {
    return withMpvError(async() => mpvController.setVolume(volume))
  })
  mainHandle<number>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_getPosition, async() => {
    return withMpvError(async() => mpvController.getPosition())
  })
  mainHandle<number>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_getDuration, async() => {
    return withMpvError(async() => mpvController.getDuration())
  })
  mainHandle<boolean>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_getPaused, async() => {
    return withMpvError(async() => mpvController.getPaused())
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_destroy, async() => {
    await mpvController.destroy()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_listAudioDevices, async() => {
    return MpvController.listAudioDevices()
  })
}
