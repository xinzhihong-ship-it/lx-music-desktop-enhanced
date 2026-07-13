import { app } from 'electron'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import * as service from './service'

let isInitialized = false

export default () => {
  if (isInitialized) return
  isInitialized = true

  mainHandle<never, LX.MusicRecognition.Snapshot>(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_start, async({ event }) => {
    const sender = event.sender
    const handleDestroyed = () => {
      service.stopRecognition()
    }
    sender.once('destroyed', handleDestroyed)
    try {
      return await service.startRecognition(snapshot => {
        if (!sender.isDestroyed()) sender.send(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_status, snapshot)
      })
    } finally {
      sender.removeListener('destroyed', handleDestroyed)
    }
  })

  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_stop, async() => {
    service.stopRecognition()
  })

  mainHandle<Uint8Array, LX.MusicRecognition.Snapshot>(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_recognize_mic, async({ event, params }) => {
    const sender = event.sender
    const handleDestroyed = () => {
      service.stopRecognition()
    }
    sender.once('destroyed', handleDestroyed)
    try {
      return await service.recognizeMicPcm(Buffer.from(params), snapshot => {
        if (!sender.isDestroyed()) sender.send(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_status, snapshot)
      })
    } finally {
      sender.removeListener('destroyed', handleDestroyed)
    }
  })

  mainHandle<LX.MusicRecognition.Snapshot>(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_snapshot, async() => {
    return service.getSnapshot()
  })

  mainHandle<LX.MusicRecognition.Snapshot>(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_clear_history, async() => {
    return service.clearRecognitionHistory()
  })

  mainHandle<string, LX.MusicRecognition.Snapshot>(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_remove_history, async({ params }) => {
    return service.removeRecognitionHistoryItem(params)
  })

  mainHandle<LX.MusicRecognition.AcrcloudConfig>(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_get_config, async() => {
    return service.getRecognitionConfig()
  })

  mainHandle<LX.MusicRecognition.AcrcloudConfig, LX.MusicRecognition.AcrcloudConfig>(WIN_MAIN_RENDERER_EVENT_NAME.music_recognition_set_config, async({ params }) => {
    return service.setRecognitionConfig(params)
  })

  app.on('before-quit', service.stopRecognition)
}
