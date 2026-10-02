import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { log } from '@common/utils'

import { defaultDirectories, findPlugins, scanPlugins } from '../../../../../native/vst3-host/client.cjs'
import { Vst3Chain } from '../../../../../native/vst3-host/chain.cjs'
import { validateVst3HostBinary } from '../../../../../native/vst3-host/binary.cjs'

let chain: Vst3Chain | null = null

const getDirectories = (custom = global.lx.appSetting['player.vst3.directories']) => {
  if (!Array.isArray(custom) || custom.length > 128 || custom.some(directory => typeof directory !== 'string' || !path.isAbsolute(directory))) {
    throw new Error('Invalid VST3 directories')
  }
  return [...new Set([...defaultDirectories(), ...custom])]
}

const executablePath = () => {
  const name = process.platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host'
  const appRoot = app.getAppPath()
  const developmentRoots = [...new Set([appRoot, path.resolve(appRoot, '..')])]
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'bin', name)]
    : developmentRoots.flatMap(root => [
      path.join(root, 'build/Release', name),
      path.join(root, 'native/vst3-host/target/debug', name),
    ])
  const executable = candidates.find(candidate => fs.existsSync(candidate))
  if (!executable) throw new Error(`VST3 host is unavailable for ${process.platform}-${process.arch}. Build it with npm run build:native:vst3 or use a package containing the matching host.`)
  try {
    validateVst3HostBinary(executable, process.platform, process.arch)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`VST3 host is not compatible with ${process.platform}-${process.arch}: ${message}`)
  }
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
  let scanning: Promise<LX.Vst3.ScanResponse> | null = null
  let scanningKey = ''
  let latestProgress: LX.Vst3.ScanProgress | null = null
  const scanSubscribers = new Set<Electron.WebContents>()
  const sendScanProgress = (sender: Electron.WebContents, progress: LX.Vst3.ScanProgress) => {
    if (sender.isDestroyed()) {
      scanSubscribers.delete(sender)
      return
    }
    try {
      sender.send(WIN_MAIN_RENDERER_EVENT_NAME.vst3_scan_progress, progress)
    } catch {
      scanSubscribers.delete(sender)
    }
  }
  const publishScanProgress = (progress: LX.Vst3.ScanProgress) => {
    latestProgress = progress
    for (const sender of scanSubscribers) sendScanProgress(sender, progress)
  }
  mainHandle<string[] | undefined, LX.Vst3.ScanResponse>(WIN_MAIN_RENDERER_EVENT_NAME.vst3_scan, async({ event, params }) => {
    const directories = getDirectories(params)
    const customDirectories = [...(params ?? global.lx.appSetting['player.vst3.directories'])]
    const key = JSON.stringify([...customDirectories].sort((a, b) => a.localeCompare(b)))
    // 相同目录共享扫描；不同目录等待当前扫描结束后重新扫描，避免旧结果写入新目录缓存。
    while (true) {
      if (!scanning) break
      if (key === scanningKey) {
        scanSubscribers.add(event.sender)
        if (latestProgress) sendScanProgress(event.sender, latestProgress)
        return scanning
      }
      try { await scanning } catch {}
    }
    const executable = executablePath()
    scanningKey = key
    latestProgress = null
    scanSubscribers.add(event.sender)
    scanning = scanPlugins(executable, directories, publishScanProgress)
      .then((result: LX.Vst3.ScanResult) => ({ ...result, directories, customDirectories }))
      .finally(() => {
        scanning = null
        latestProgress = null
        scanSubscribers.clear()
      })
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
