import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { probeAudioSourceSampleRate, probeAudioSourceInfo } from '@main/utils/audioSourceSampleRate'
import { getBiliCdnHeaders } from '../mpvVideoController'

const normalizeSource = (source: unknown): string | null => {
  if (typeof source !== 'string' || source.length === 0 || source.length > 8192 || source.includes('\0')) return null
  if (/^https?:\/\//i.test(source)) return source
  if (/^file:\/\//i.test(source)) {
    try { return fileURLToPath(source) } catch { return null }
  }
  return path.isAbsolute(source) ? source : null
}

export default () => {
  mainHandle<string, number | null>(WIN_MAIN_RENDERER_EVENT_NAME.audio_source_sample_rate, async({ params }) => {
    const source = normalizeSource(params)
    if (!source) return null
    const headers = /\.bilivideo\.(?:com|cn)(?::\d+)?\//i.test(source) ? getBiliCdnHeaders() : undefined
    try { return await probeAudioSourceSampleRate(source, headers) } catch { return null }
  })
  mainHandle<string, { sampleRate: number | null, contentType: string | null, contentLength: number | null, format: string | null, formatSource: string | null, formatHint: string | null, bitrate: number | null, bitsPerSample: number | null, bytesRead: number, httpStatus: number | null, error: string | null }>(WIN_MAIN_RENDERER_EVENT_NAME.probe_audio_source, async({ params }) => {
    const source = normalizeSource(params)
    if (!source) return { sampleRate: null, contentType: null, contentLength: null, format: null, formatSource: null, formatHint: null, bitrate: null, bitsPerSample: null, bytesRead: 0, httpStatus: null, error: '音频地址无效' }
    const headers = /\.bilivideo\.(?:com|cn)(?::\d+)?\//i.test(source) ? getBiliCdnHeaders() : undefined
    try {
      return await probeAudioSourceInfo(source, headers)
    } catch (error: any) {
      return { sampleRate: null, contentType: null, contentLength: null, format: null, formatSource: null, formatHint: null, bitrate: null, bitsPerSample: null, bytesRead: 0, httpStatus: null, error: error?.message || '音频探测失败' }
    }
  })
}
