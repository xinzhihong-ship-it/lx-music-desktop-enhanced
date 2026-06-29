import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { log } from '@common/utils'
import { sendEvent } from '@main/modules/winMain/main'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

export type MpvPathSource = 'custom' | 'bundled' | 'dev-bundled' | 'dev-bundled-app' | 'dev-bundled-x64-fallback' | 'system' | 'common-path'

export interface MpvPathInfo {
  path: string
  source: MpvPathSource
}

type MpvEventName = 'started' | 'loaded' | 'playing' | 'pause' | 'stopped' | 'ended' | 'error' | 'timeUpdate' | 'duration'

interface MpvIpcResponse {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  name?: string
  reason?: string
}

const isWin = process.platform == 'win32'
const isMac = process.platform == 'darwin'

const sanitizeUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}${parsed.search ? '?…' : ''}`
  } catch {
    return url.length > 80 ? `${url.substring(0, 80)}…` : url
  }
}

const existsFile = (filePath: string) => {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

const resolvePlatformArch = () => {
  switch (process.platform) {
    case 'darwin':
      return process.arch == 'arm64' ? 'darwin-arm64' : 'darwin-x64'
    case 'win32':
      return process.arch == 'arm64' ? 'win32-arm64' : 'win32-x64'
    case 'linux':
      return process.arch == 'arm64' ? 'linux-arm64' : process.arch == 'arm' ? 'linux-armv7l' : 'linux-x64'
    default:
      return `${process.platform}-${process.arch}`
  }
}

const getCommonPaths = () => {
  if (isMac) {
    return [
      '/opt/homebrew/bin/mpv',
      '/usr/local/bin/mpv',
      '/Applications/mpv.app/Contents/MacOS/mpv',
    ]
  }
  if (isWin) {
    return [
      'C:\\Program Files\\mpv\\mpv.exe',
      'C:\\Program Files (x86)\\mpv\\mpv.exe',
    ]
  }
  return [
    '/usr/bin/mpv',
    '/usr/local/bin/mpv',
  ]
}

export const resolveMpvPath = (): MpvPathInfo => {
  const customPath = global.lx.appSetting['player.mpv.path']
  log.info(`resolveMpvPath - player.mpv.path: ${customPath}`)
  if (customPath && existsFile(customPath)) return { path: customPath, source: 'custom' }

  const exeName = isWin ? 'mpv.exe' : 'mpv'
  const bundledPath = path.join(process.resourcesPath, 'bin', exeName)
  if (process.env.NODE_ENV == 'production' && existsFile(bundledPath)) return { path: bundledPath, source: 'bundled' }

  // Production macOS: check for mpv.app bundle inside bin/
  if (isMac && process.env.NODE_ENV == 'production') {
    const appBundledProdPath = path.join(process.resourcesPath, 'bin', 'mpv.app', 'Contents', 'MacOS', exeName)
    if (existsFile(appBundledProdPath)) return { path: appBundledProdPath, source: 'bundled' }
  }

  const devBundledPath = path.join(process.cwd(), 'resources', 'mpv', resolvePlatformArch(), exeName)
  if (existsFile(devBundledPath)) return { path: devBundledPath, source: 'dev-bundled' }

  // Dev fallback: check for mpv.app bundle (macOS)
  if (isMac) {
    const appBundlePath = path.join(process.cwd(), 'resources', 'mpv', resolvePlatformArch(), 'mpv.app', 'Contents', 'MacOS', exeName)
    if (existsFile(appBundlePath)) return { path: appBundlePath, source: 'dev-bundled-app' }
  }

  // ARM fallback: try x64 variant (Rosetta/WSL compatibility)
  if (process.arch == 'arm64' || process.arch == 'arm') {
    const fallbackDir = process.platform == 'darwin' ? 'darwin-x64' : 'linux-x64'
    const x64FallbackPath = path.join(process.cwd(), 'resources', 'mpv', fallbackDir, exeName)
    if (existsFile(x64FallbackPath)) return { path: x64FallbackPath, source: 'dev-bundled-x64-fallback' }
  }

  for (const commonPath of getCommonPaths()) {
    if (existsFile(commonPath)) return { path: commonPath, source: 'common-path' }
  }

  return { path: exeName, source: 'system' }
}

export class MpvController {
  private process: ChildProcess | null = null
  private socket: net.Socket | null = null
  private ipcPath = ''
  private requestId = 0
  private readonly pendingRequests = new Map<number, {
    resolve: (data: unknown) => void
    reject: (err: Error) => void
    timeout: NodeJS.Timeout
  }>()

  private buffer = ''
  private starting: Promise<MpvPathInfo> | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private isDestroyed = false
  private startError: Error | null = null
  private cachedPathInfo: MpvPathInfo | null = null
  private isPlayingState = false

  async ensureStarted(): Promise<MpvPathInfo> {
    if (this.socket && this.process && !this.process.killed) {
      return this.cachedPathInfo ?? resolveMpvPath()
    }
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<MpvPathInfo> {
    this.isDestroyed = false
    this.startError = null
    const mpvPath = resolveMpvPath()
    const args = this.buildArgs()
    log.info(`MpvController starting mpv source=${mpvPath.source} path=${mpvPath.path}`)

    const mpvProcess = spawn(mpvPath.path, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.process = mpvProcess

    mpvProcess.stdout?.on('data', data => {
      log.info(`mpv stdout: ${String(data).trim()}`)
    })
    mpvProcess.stderr?.on('data', data => {
      log.warn(`mpv stderr: ${String(data).trim()}`)
    })
    mpvProcess.once('error', err => {
      this.startError = err
      this.isPlayingState = false
      this.rejectAll(err)
      this.sendEvent('error', { message: err.message })
    })
    mpvProcess.once('exit', (code, signal) => {
      const message = `mpv exited code=${code ?? 'null'} signal=${signal ?? 'null'}`
      log.warn(message)
      this.isPlayingState = false
      this.cleanupSocket()
      this.rejectAll(new Error(message))
      if (!this.isDestroyed) this.sendEvent('error', { message })
    })

    await this.waitForIpc()
    await this.command(['observe_property', 1, 'time-pos']).catch(err => log.warn(err))
    await this.command(['observe_property', 2, 'duration']).catch(err => log.warn(err))
    await this.command(['observe_property', 3, 'pause']).catch(err => log.warn(err))
    await this.command(['observe_property', 4, 'idle-active']).catch(err => log.warn(err))
    this.sendEvent('started', mpvPath)
    this.cachedPathInfo = mpvPath
    return mpvPath
  }

  private buildArgs(): string[] {
    this.ipcPath = isWin
      ? `\\\\.\\pipe\\lx-music-mpv-${process.pid}`
      : path.join(os.tmpdir(), `lx-music-mpv-${process.pid}.sock`)
    if (!isWin) {
      try {
        fs.unlinkSync(this.ipcPath)
      } catch {}
    }

    const args = [
      '--idle=yes',
      '--no-video',
      '--force-window=no',
      '--audio-display=no',
      `--input-ipc-server=${this.ipcPath}`,
    ]

    if (global.lx.appSetting['player.mpv.bitPerfectMode']) {
      args.push('--replaygain=no', '--af-clr')
    }
    if (isWin && global.lx.appSetting['player.mpv.audioExclusive']) {
      args.push('--ao=wasapi', '--audio-exclusive=yes')
    }

    const extraArgs = global.lx.appSetting['player.mpv.extraArgs']
    log.info(`mpv extraArgs from config: ${JSON.stringify(extraArgs)}`)
    log.info(`mpv appSetting keys: ${Object.keys(global.lx.appSetting).filter(k => k.includes('mpv')).join(', ')}`)

    // 使用配置中的参数，如果为空则使用默认设备
    if (Array.isArray(extraArgs) && extraArgs.length > 0) {
      args.push(...extraArgs.filter(arg => typeof arg == 'string' && arg.length))
      log.info('Using extraArgs from config')
    } else {
      log.info('No extraArgs in config, using default audio device')
    }

    log.info(`mpv final args: ${args.join(' ')}`)
    return args
  }

  private async waitForIpc(): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < 5000) {
      if (this.startError) throw this.startError
      if (this.process?.exitCode != null) throw new Error('mpv exited before IPC became ready')
      try {
        await this.connectIpc()
        return
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    throw new Error('mpv IPC connect timeout')
  }

  private async connectIpc(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.ipcPath)
      const onError = (err: Error) => {
        socket.destroy()
        reject(err)
      }
      socket.once('error', onError)
      socket.once('connect', () => {
        socket.off('error', onError)
        this.socket = socket
        socket.setEncoding('utf8')
        socket.on('data', data => {
          this.handleData(String(data))
        })
        socket.on('error', err => {
          this.rejectAll(err)
          this.sendEvent('error', { message: err.message })
        })
        socket.on('close', () => {
          this.socket = null
        })
        resolve()
      })
    })
  }

  private handleData(data: string) {
    this.buffer += data
    let index = this.buffer.indexOf('\n')
    while (index > -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.handleMessage(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private handleMessage(line: string) {
    let message: MpvIpcResponse
    try {
      message = JSON.parse(line) as MpvIpcResponse
    } catch (err) {
      log.warn(`mpv invalid ipc message: ${line}`)
      return
    }

    if (message.request_id != null) {
      const pending = this.pendingRequests.get(message.request_id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(message.request_id)
        if (message.error && message.error != 'success') pending.reject(new Error(message.error))
        else pending.resolve(message.data)
      }
      return
    }

    switch (message.event) {
      case 'file-loaded':
        this.sendEvent('loaded')
        if (this.fileLoadedResolve) this.fileLoadedResolve()
        void this.getDuration().then(duration => {
          this.sendEvent('duration', duration)
        }).catch(() => {})
        break
      case 'playback-restart':
        if (!this.isPlayingState) {
          this.sendEvent('playing')
          this.isPlayingState = true
        }
        this.startPolling()
        break
      case 'end-file':
        this.stopPolling()
        this.isPlayingState = false
        if (message.reason == 'eof') {
          this.sendEvent('ended')
        } else if (message.reason == 'error') {
          this.sendEvent('error', { message: 'mpv playback error (end-file reason=error)' })
        } else {
          this.sendEvent('stopped')
        }
        break
      case 'property-change':
        this.handlePropertyChange(message.name, message.data)
        break
    }
  }

  private handlePropertyChange(name?: string, data?: unknown) {
    switch (name) {
      case 'time-pos':
        if (typeof data == 'number') this.sendEvent('timeUpdate', data)
        break
      case 'duration':
        if (typeof data == 'number') this.sendEvent('duration', data)
        break
      case 'pause':
        if (data) {
          this.sendEvent('pause')
          this.isPlayingState = false
          this.stopPolling()
        } else {
          if (!this.isPlayingState) {
            this.sendEvent('playing')
            this.isPlayingState = true
          }
          this.startPolling()
        }
        break
      case 'idle-active':
        if (data) {
          this.stopPolling()
          this.isPlayingState = false
          this.sendEvent('stopped')
        }
        break
    }
  }

  private async command<T = unknown>(command: unknown[]): Promise<T> {
    if (!this.socket) return Promise.reject(new Error('mpv IPC is not connected'))
    const request_id = ++this.requestId
    const payload = JSON.stringify({ command, request_id }) + '\n'
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request_id)
        reject(new Error('mpv IPC request timeout'))
      }, 5000)
      this.pendingRequests.set(request_id, {
        resolve: data => {
          resolve(data as T)
        },
        reject,
        timeout,
      })
      this.socket!.write(payload, err => {
        if (!err) return
        clearTimeout(timeout)
        this.pendingRequests.delete(request_id)
        reject(err)
      })
    })
  }

  private fileLoadedResolve: (() => void) | null = null
  private fileLoadedReject: ((err: Error) => void) | null = null
  private fileLoadedPromise: Promise<void> | null = null

  private async waitForFileLoaded(): Promise<void> {
    if (this.fileLoadedPromise) return this.fileLoadedPromise
    this.fileLoadedPromise = new Promise((resolve, reject) => {
      this.fileLoadedResolve = () => {
        this.fileLoadedResolve = null
        this.fileLoadedReject = null
        this.fileLoadedPromise = null
        resolve()
      }
      this.fileLoadedReject = (err: Error) => {
        this.fileLoadedResolve = null
        this.fileLoadedReject = null
        this.fileLoadedPromise = null
        reject(err)
      }
      setTimeout(() => {
        if (this.fileLoadedReject) {
          const timeoutErr = new Error('mpv file-load timeout')
          this.fileLoadedReject(timeoutErr)
        }
      }, 10000)
    })
    return this.fileLoadedPromise
  }

  async loadUrl(url: string): Promise<void> {
    await this.ensureStarted()
    log.info(`MpvController load url: ${sanitizeUrl(url)}`)
    await this.command(['loadfile', url, 'replace'])
    await this.waitForFileLoaded().catch(() => {})
    await this.command(['set_property', 'pause', false]).catch(() => {})
    this.startPolling()
  }

  async play(): Promise<void> {
    await this.ensureStarted()
    await this.command(['set_property', 'pause', false])
    this.startPolling()
  }

  async pause(): Promise<void> {
    await this.ensureStarted()
    await this.command(['set_property', 'pause', true])
    this.stopPolling()
  }

  async stop(): Promise<void> {
    if (!this.socket) return
    await this.command(['stop']).catch(() => {})
    this.stopPolling()
    this.sendEvent('stopped')
  }

  async seek(seconds: number): Promise<void> {
    await this.ensureStarted()
    await this.command(['seek', seconds, 'absolute'])
  }

  async setVolume(volume: number): Promise<void> {
    await this.ensureStarted()
    await this.command(['set_property', 'volume', volume])
  }

  async getPosition(): Promise<number> {
    await this.ensureStarted()
    return (await this.command<number | null>(['get_property', 'time-pos'])) ?? 0
  }

  async getDuration(): Promise<number> {
    await this.ensureStarted()
    return (await this.command<number | null>(['get_property', 'duration'])) ?? 0
  }

  async getPaused(): Promise<boolean> {
    await this.ensureStarted()
    return (await this.command<boolean | null>(['get_property', 'pause'])) ?? true
  }

  private startPolling() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      if (!this.socket) return
      void this.getPosition().then(position => {
        this.sendEvent('timeUpdate', position)
      }).catch(() => {})
      void this.getDuration().then(duration => {
        this.sendEvent('duration', duration)
      }).catch(() => {})
    }, 1000)
  }

  private stopPolling() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async destroy(): Promise<void> {
    this.isDestroyed = true
    this.isPlayingState = false
    this.stopPolling()
    if (this.socket) {
      await this.command(['quit']).catch(() => {})
    }
    this.cleanupSocket()
    if (this.process && !this.process.killed) this.process.kill()
    this.process = null
    this.cachedPathInfo = null
    this.isDestroyed = false
  }

  private cleanupSocket() {
    this.stopPolling()
    this.socket?.destroy()
    this.socket = null
    if (!isWin && this.ipcPath) {
      try {
        fs.unlinkSync(this.ipcPath)
      } catch {}
    }
  }

  private rejectAll(err: Error) {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(err)
      this.pendingRequests.delete(requestId)
    }
  }

  private sendEvent(name: MpvEventName, data?: unknown) {
    const eventNames: Record<MpvEventName, string> = {
      started: WIN_MAIN_RENDERER_EVENT_NAME.mpv_started,
      loaded: WIN_MAIN_RENDERER_EVENT_NAME.mpv_loaded,
      playing: WIN_MAIN_RENDERER_EVENT_NAME.mpv_playing,
      pause: WIN_MAIN_RENDERER_EVENT_NAME.mpv_pause_event,
      stopped: WIN_MAIN_RENDERER_EVENT_NAME.mpv_stopped,
      ended: WIN_MAIN_RENDERER_EVENT_NAME.mpv_ended,
      error: WIN_MAIN_RENDERER_EVENT_NAME.mpv_error,
      timeUpdate: WIN_MAIN_RENDERER_EVENT_NAME.mpv_timeUpdate,
      duration: WIN_MAIN_RENDERER_EVENT_NAME.mpv_duration,
    }
    sendEvent(eventNames[name], data)
  }

  /**
   * 运行 mpv --audio-device=help 获取可用设备列表
   */
  static async listAudioDevices(): Promise<Array<{ id: string, name: string }>> {
    const mpvPath = resolveMpvPath()
    return new Promise((resolve) => {
      const proc = spawn(mpvPath.path, ['--audio-device=help'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      proc.stdout?.on('data', (data) => { output += String(data) })
      proc.stderr?.on('data', (data) => { output += String(data) })
      proc.on('close', () => {
        const devices: Array<{ id: string, name: string }> = [{ id: 'auto', name: '默认设备' }]
        for (const line of output.split('\n')) {
          const match = line.match(/^\s*'([^']+)'\s*\(([^)]+)\)/)
          if (match && match[1] !== 'auto') {
            devices.push({ id: match[1], name: match[2] })
          }
        }
        resolve(devices)
      })
      proc.on('error', () => { resolve([]) })
      setTimeout(() => { resolve([]) }, 5000)
    })
  }
}

export const mpvController = new MpvController()

app.on('before-quit', () => {
  void mpvController.destroy()
})
