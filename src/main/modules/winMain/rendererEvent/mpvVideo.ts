import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import * as mpvVideo from '../mpvVideoController'

interface VideoLoadParams {
  videoUrl: string
  audioUrl?: string
}

export default () => {
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_init, async() => {
    mpvVideo.init()
  })
  mainHandle<VideoLoadParams>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_loadUrl, async({ params }) => {
    return mpvVideo.loadUrl(params.videoUrl, params.audioUrl)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_play, async() => {
    mpvVideo.play()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_pause, async() => {
    mpvVideo.pause()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_stop, async() => {
    mpvVideo.stop()
  })
  mainHandle<number>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_seek, async({ params }) => {
    mpvVideo.seek(params)
  })
  mainHandle<number>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setVolume, async({ params }) => {
    mpvVideo.setVolume(params)
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setAudioDevice, async({ params }) => {
    mpvVideo.setAudioDevice(params)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_getPosition, async() => mpvVideo.getPosition())
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_getDuration, async() => mpvVideo.getDuration())
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_getPaused, async() => mpvVideo.getPaused())
  mainHandle<Electron.Rectangle>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setBounds, async({ params }) => {
    mpvVideo.setBounds(params)
  })
  mainHandle<boolean>(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_setVisible, async({ params }) => {
    mpvVideo.setVisible(params)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.mpv_video_destroy, async() => {
    return mpvVideo.destroy()
  })
}
