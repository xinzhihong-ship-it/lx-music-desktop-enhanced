import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { AudioConversionService } from '@main/modules/audioConversion/service'

const service = new AudioConversionService()

export const initAudioConversion = () => service.init()

export default () => {
  mainHandle<LX.AudioConversion.Task[]>(WIN_MAIN_RENDERER_EVENT_NAME.audio_conversion_list_get, async() => service.getTasks())
  mainHandle<LX.AudioConversion.AddParams, LX.AudioConversion.Task[]>(WIN_MAIN_RENDERER_EVENT_NAME.audio_conversion_add, ({ params }) => service.add(params))
  mainHandle<string[], LX.AudioConversion.Task[]>(WIN_MAIN_RENDERER_EVENT_NAME.audio_conversion_wait, ({ params }) => service.wait(params))
  mainHandle<string[]>(WIN_MAIN_RENDERER_EVENT_NAME.audio_conversion_cancel, async({ params }) => { service.cancel(params) })
  mainHandle<string[]>(WIN_MAIN_RENDERER_EVENT_NAME.audio_conversion_remove, async({ params }) => { service.remove(params) })
  mainHandle<string[]>(WIN_MAIN_RENDERER_EVENT_NAME.audio_conversion_retry, async({ params }) => { service.retry(params) })
}
