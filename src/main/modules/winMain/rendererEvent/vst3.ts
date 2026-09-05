import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { log } from '@common/utils'

import { defaultDirectories, findPlugins, scanPlugins } from '../../../../../native/vst3-host/client.cjs'
import { Vst3Chain } from '../../../../../native/vst3-host/chain.cjs'

let chain: Vst3Chain | null = null

const getDirectories = () => {
  const custom = global.lx.appSetting['player.vst3.directories']
  if (!Array.isArray(custom) || custom.length > 128 || custom.some(directory => typeof directory !== 'string' || !path.isAbsolute(directory))) {
    throw new Error('Invalid VST3 directories')
  }
  return [...new Set([...defaultDirectories(), ...custom])]
}

const executablePath = () => {
  const name = process.platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host'
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'bin', name)]
    : [path.join(process.cwd(), 'build/Release', name), path.join(process.cwd(), 'native/vst3-host/target/debug', name)]
  const executable = candidates.find(candidate => fs.existsSync(candidate))
  if (!executable) throw new Error('VST3 host is not built. Run npm run build:native:vst3.')
  return executable
}

export const processVst3Audio = async(inputs: Float32Array[]): Promise<{ outputs: Float32Array[], latencySamples: number, bypassed?: boolean }> => {
  if (!chain || !global.lx.appSetting['player.vst3.enabled'] || global.lx.appSetting['player.playEngine'] === 'audirvana') {
    throw new Error('VST3 audio mode is not active')
  }
  // chain.cjs 为无类型 JS 模块，其推断返回类型含 void 分支，这里显式收口。
  return chain.process(inputs) as Promise<{ outputs: Float32Array[], latencySamples: number, bypassed?: boolean }>
}

export default () => {
  let scanning: Promise<unknown> | null = null
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.vst3_scan, async() => {
    if (scanning) return scanning
    const directories = getDirectories()
    scanning = scanPlugins(executablePath(), directories).then((result: object) => ({ ...result, directories })).finally(() => { scanning = null })
    return scanning
  })
  mainHandle<number>(WIN_MAIN_RENDERER_EVENT_NAME.vst3_configure, async({ params: sampleRate }) => {
    if (global.lx.appSetting['player.playEngine'] === 'audirvana') throw new Error('Audirvana does not support VST3')
    const allowed = await findPlugins(getDirectories())
    chain ??= new Vst3Chain(executablePath(), path.join(app.getPath('userData'), 'vst3-state'))
    return chain.configure(global.lx.appSetting['player.vst3.chain'], sampleRate, new Set(allowed.paths))
  })
  mainHandle<Float32Array[], { outputs: Float32Array[], latencySamples: number, bypassed?: boolean }>(WIN_MAIN_RENDERER_EVENT_NAME.vst3_process, async({ params }) => processVst3Audio(params))
  mainHandle<{ id: string, open: boolean }>(WIN_MAIN_RENDERER_EVENT_NAME.vst3_editor, async({ params }) => {
    if (!chain) throw new Error('VST3 chain is not loaded')
    await chain.editor(params.id, params.open)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.vst3_status, async() => chain?.status() ?? null)
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.vst3_close, async() => {
    await chain?.close()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.vst3_reset, async() => { await chain?.reset() })
  // Persist editor changes even when the native window was closed using its title bar.
  const saveTimer = setInterval(() => { void chain?.save().catch((err: Error) => { log.warn('VST3 state save failed:', err.message) }) }, 5000)
  saveTimer.unref()
}
