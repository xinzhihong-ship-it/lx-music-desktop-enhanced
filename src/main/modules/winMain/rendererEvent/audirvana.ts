import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import * as audirvana from '../audirvanaController'

export default () => {
  mainHandle<{ url: string, musicInfo?: LX.Music.MusicInfo, filePath?: string } | string, string>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_set_track, async({ params }) => {
    return await audirvana.setTrack(params)
  })

  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_play, async() => {
    await audirvana.play()
  })

  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_pause, async() => {
    await audirvana.pause()
  })

  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_stop, async() => {
    await audirvana.stop()
  })

  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_next, async() => {
    await audirvana.next()
  })

  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_previous, async() => {
    await audirvana.previous()
  })

  mainHandle<undefined, 'stopped' | 'playing' | 'paused'>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_get_state, async() => {
    return await audirvana.getState()
  })

  mainHandle<undefined, number>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_get_position, async() => {
    return await audirvana.getPosition()
  })

  mainHandle<undefined, number>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_get_duration, async() => {
    return await audirvana.getDuration()
  })

  mainHandle<number, void>(WIN_MAIN_RENDERER_EVENT_NAME.audirvana_set_position, async({ params }) => {
    await audirvana.setPosition(params)
  })
}
