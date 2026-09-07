import { ipcRenderer } from 'electron'
import { WIN_MAIN_RENDERER_EVENT_NAME as IPC } from '@common/ipcNames'

export const readSourceSampleRate = async(src: string, signal: AbortSignal): Promise<number | null> => {
  if (signal.aborted) return null
  const result = await Promise.race([
    ipcRenderer.invoke(IPC.audio_source_sample_rate, src),
    new Promise<null>(resolve => {
      signal.addEventListener('abort', () => { resolve(null) }, { once: true })
    }),
  ])
  return typeof result === 'number' && Number.isInteger(result) ? result : null
}
