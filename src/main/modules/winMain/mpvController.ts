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

type MpvEventName = 'started' | 'loaded' | 'playing' | 'pause' | 'stopped' | 'ended' | 'error' | 'timeUpdate' | 'duration' | 'seeked'

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

let instanceCounter = 0

export class MpvController {
  readonly instanceId = ++instanceCounter
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
  hasFileLoaded = false
  private isPaused = true
  pausedAt = 0
  loadedUrl = ''
  private cachedVolume: number | null = null

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
    log.info(`MpvController starting mpv instance=${this.instanceId} source=${mpvPath.source} path=${mpvPath.path}`)

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
      this.hasFileLoaded = false
      this.isPaused = true
      this.rejectAll(err)
      this.sendEvent('error', { message: err.message })
    })
    mpvProcess.once('exit', (code, signal) => {
      const message = `mpv exited code=${code ?? 'null'} signal=${signal ?? 'null'}`
      log.warn(message)
      this.isPlayingState = false
      this.hasFileLoaded = false
      this.isPaused = true
      this.cleanupSocket()
      this.rejectAll(new Error(message))
      if (!this.isDestroyed) this.sendEvent('error', { message })
    })

    await this.waitForIpc()
    await this.command(['observe_property', 1, 'time-pos']).catch(err => log.warn(err))
    await this.command(['observe_property', 2, 'duration']).catch(err => log.warn(err))
    await this.command(['observe_property', 3, 'pause']).catch(err => log.warn(err))
    await this.command(['observe_property', 4, 'idle-active']).catch(err => log.warn(err))
    if (this.cachedVolume != null) {
      await this.command(['set_property', 'volume', this.cachedVolume]).catch(err => log.warn(err))
    }
    this.sendEvent('started', mpvPath)
    this.cachedPathInfo = mpvPath
    return mpvPath
  }

  private buildArgs(): string[] {
    // 每个实例使用独立的 IPC 路径，避免 restartMpvController 时新旧进程竞争同一 socket/pipe。
    this.ipcPath = isWin
      ? `\\\\.\\pipe\\lx-music-mpv-${process.pid}-${this.instanceId}`
      : path.join(os.tmpdir(), `lx-music-mpv-${process.pid}-${this.instanceId}.sock`)
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
      '--hr-seek=yes',
      '--audio-exclusive=no',
    ]

    if (global.lx.appSetting['player.mpv.bitPerfectMode']) {
      args.push('--replaygain=no', '--af-clr')
    }

    // 输出设备由 player.mediaDeviceId 单独控制，不污染 player.mpv.extraArgs
    const mediaDeviceId = global.lx.appSetting['player.mediaDeviceId']
    if (mediaDeviceId && mediaDeviceId !== 'default' && mediaDeviceId !== 'Default' && mediaDeviceId !== 'communications') {
      args.push(`--audio-device=${mediaDeviceId}`)
    }

    const extraArgs = global.lx.appSetting['player.mpv.extraArgs']
    log.info(`mpv extraArgs from config: ${JSON.stringify(extraArgs)}`)
    log.info(`mpv appSetting keys: ${Object.keys(global.lx.appSetting).filter(k => k.includes('mpv')).join(', ')}`)

    // 使用配置中的参数，过滤掉由本代码统一处理的 --audio-device
    if (Array.isArray(extraArgs) && extraArgs.length > 0) {
      args.push(...extraArgs.filter(arg => typeof arg == 'string' && arg.length && !arg.startsWith('--audio-device=')))
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
        this.hasFileLoaded = true
        // loaded / duration 事件推迟到 loadUrl 完成所有初始化（pause、seek 0）后再发送，
        // 避免 renderer 在待恢复 seek 还没应用前就进入播放。
        if (this.fileLoadedResolve) this.fileLoadedResolve()
        break
      case 'playback-restart':
        // 只有在真正有文件在播放时才上报 playing，避免空闲/加载状态误报。
        if (this.hasFileLoaded && !this.isPaused && !this.isPlayingState) {
          this.sendEvent('playing')
          this.isPlayingState = true
          this.startPolling()
        }
        break
      case 'end-file':
        this.hasFileLoaded = false
        this.stopPolling()
        this.isPlayingState = false
        this.pausedAt = 0
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
    // 进程正在销毁时，旧实例的事件不应再转发给 renderer，避免无感切换时
    // 旧进程退出的 pause/stopped 事件把播放状态覆盖成暂停。
    if (this.isDestroyed) return
    switch (name) {
      case 'time-pos':
        if (typeof data == 'number') {
          this.sendEvent('timeUpdate', data)
          // time-pos 变化意味着文件已加载且正在推进；某些场景下 file-loaded 或
          // pause property-change 可能延迟/丢失，这里补充同步状态，避免 UI 卡在加载中。
          // 但必须排除已暂停的情况，否则暂停后的残余 time-pos 更新会误报 playing。
          if (!this.hasFileLoaded) this.hasFileLoaded = true
          if (!this.isPaused && !this.isPlayingState) {
            this.sendEvent('playing')
            this.isPlayingState = true
            this.startPolling()
          }
        }
        break
      case 'duration':
        if (typeof data == 'number') this.sendEvent('duration', data)
        break
      case 'pause':
        this.isPaused = !!data
        if (data) {
          this.sendEvent('pause')
          this.isPlayingState = false
          this.stopPolling()
        } else {
          // MPV 在空闲/未加载文件时 pause 也可能为 false，
          // 必须确认已有文件加载完成才上报 playing，否则会出现“假播放”。
          if (this.hasFileLoaded && !this.isPlayingState) {
            this.sendEvent('playing')
            this.isPlayingState = true
            this.startPolling()
          }
        }
        break
      case 'idle-active':
        if (data) {
          this.hasFileLoaded = false
          this.isPaused = true
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
    // 文件可能在注册等待前就已加载完成（file-loaded 与 loadfile 响应同块到达时被提前处理），
    // 此时直接返回，避免干等 10 秒超时。
    if (this.hasFileLoaded) return
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

  private async waitForProperty<T>(name: string, expected: T, timeout = 2000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const value = await this.command<T>(['get_property', name]).catch(() => null)
      if (value === expected) return true
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return false
  }

  async loadUrl(url: string, options?: { emitLoaded?: boolean }): Promise<void> {
    await this.ensureStarted()
    this.loadedUrl = url
    log.info(`[MpvController loadUrl] instance=${this.instanceId} url: ${sanitizeUrl(url)}`)
    // 必须在发 loadfile 之前就注册 file-loaded 等待：两者在同一条 IPC 流上，
    // 若 file-loaded 与命令响应在同一个数据块到达，事件会在 promise 注册前被处理并丢弃，
    // 导致 waitForFileLoaded 干等 10 秒超时（表现为切换输出设备时卡住/失败）。
    this.hasFileLoaded = false
    const fileLoaded = this.waitForFileLoaded()
    try {
      await this.command(['loadfile', url, 'replace'])
    } catch (err: any) {
      // loadfile 已失败，吞掉 file-loaded 等待后续的超时，避免未处理的 rejection
      fileLoaded.catch(() => {})
      // 某些 MPV 启动状态下会把 replace 标志误解析为 index 参数，
      // 重试一次不带 flags（replace 是默认值）。
      const msg = err?.message ?? ''
      if (msg.includes('invalid parameter') || msg.includes('incompatible type')) {
        log.warn(`loadfile with replace failed (${msg}), retrying without flags`)
        await new Promise(resolve => setTimeout(resolve, 200))
        await this.command(['loadfile', url])
      } else {
        throw err
      }
    }
    await fileLoaded
    // 文件加载完成后立即置为暂停，使 pause 属性从 false/undefined 变为 true，
    // 从而触发 property-change 事件；同时避免 MPV 在加载后进入 playback-restart
    // 并误报 playing 事件。
    await this.command(['set_property', 'pause', true]).catch(() => {})
    // 等待 pause=true 真正生效后再返回，避免 renderer 紧接着调用 play() 时
    // 与 pause=true 命令竞争，导致播放/暂停状态错乱。
    const paused = await this.waitForProperty('pause', true)
    this.isPaused = paused
    this.isPlayingState = false
    this.stopPolling()
    // 新文件加载后必须回到 0:00，且要清除上一首残留的 pausedAt，
    // 否则紧接着的 play() 会把新文件 seek 到上一首的暂停位置。
    this.pausedAt = 0
    await this.command(['seek', 0, 'absolute', 'exact']).catch(() => {})
    // restart 场景下由调用方在 play() 成功后再通知 renderer，
    // 避免 renderer 在切换期间误发 pause 覆盖新实例的播放命令。
    if (options?.emitLoaded !== false) {
      this.sendEvent('loaded')
      void this.getDuration().then(duration => {
        this.sendEvent('duration', duration)
      }).catch(() => {})
    }
  }

  async play(): Promise<void> {
    await this.ensureStarted()
    // 恢复/开始播放前先把位置对齐到目标（暂停位置或 0），再解除暂停。
    // 这样可以避免 MPV 在加载后从错误位置先播一小段，然后又被 seek 拉回头。
    const target = this.pausedAt > 0 ? this.pausedAt : 0
    this.pausedAt = 0
    await this.command(['seek', target, 'absolute', 'exact']).catch(() => {})
    await this.command(['set_property', 'pause', false])
    // 轮询由 pause=false 的 property-change 启动，避免在真正恢复前误报 pause。
  }

  async pause(): Promise<void> {
    await this.ensureStarted()
    // 先立即发送暂停命令，避免等待 get_position 造成 UI 反应慢；
    // 恢复播放时使用 exact seek，即使 pausedAt 是包边界也能精确对齐。
    await this.command(['set_property', 'pause', true])
    // 立刻把内部状态置为暂停，避免 pause property-change 回来前，
    // 轮询/time-pos 误发 playing 导致播放按钮闪烁。
    this.isPaused = true
    this.isPlayingState = false
    this.stopPolling()
    this.pausedAt = await this.getPosition().catch(() => 0)
  }

  async stop(): Promise<void> {
    if (!this.socket) return
    this.pausedAt = 0
    await this.command(['stop']).catch(() => {})
    this.stopPolling()
    this.sendEvent('stopped')
  }

  async seek(seconds: number): Promise<void> {
    await this.ensureStarted()
    // 使用 absolute+exact seek，配合 --hr-seek=yes，避免按关键帧 seek 造成的回退/前进偏移。
    await this.command(['seek', seconds, 'absolute', 'exact'])
    this.pausedAt = seconds
    this.sendEvent('seeked')
  }

  async setVolume(volume: number): Promise<void> {
    this.cachedVolume = volume
    if (!this.socket) return
    await this.command(['set_property', 'volume', volume])
  }

  async getPosition(): Promise<number> {
    if (!this.socket) return 0
    return (await this.command<number | null>(['get_property', 'time-pos'])) ?? 0
  }

  async getDuration(): Promise<number> {
    if (!this.socket) return 0
    return (await this.command<number | null>(['get_property', 'duration'])) ?? 0
  }

  async getPaused(): Promise<boolean> {
    if (!this.socket) return true
    return (await this.command<boolean | null>(['get_property', 'pause'])) ?? true
  }

  async getPath(): Promise<string | null> {
    if (!this.socket) return null
    return await this.command<string | null>(['get_property', 'path']).catch(() => null)
  }

  private startPolling() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      if (!this.socket || this.isDestroyed) return
      void this.getPosition().then(position => {
        if (this.isDestroyed) return
        this.sendEvent('timeUpdate', position)
      }).catch(() => {})
      void this.getDuration().then(duration => {
        if (this.isDestroyed) return
        this.sendEvent('duration', duration)
      }).catch(() => {})
      void this.getPaused().then(paused => {
        if (this.isDestroyed) return

        // 定期同步暂停状态，避免 property-change 事件丢失导致 UI 与实际状态不一致。
        if (paused) {
          if (this.isPlayingState) {
            this.isPlayingState = false
            this.sendEvent('pause')
          }
        } else if (this.hasFileLoaded && !this.isPlayingState) {
          this.isPlayingState = true
          this.sendEvent('playing')
        }
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
    this.hasFileLoaded = false
    this.isPaused = true
    this.stopPolling()
    if (this.socket) {
      await this.command(['quit']).catch(() => {})
    }
    this.cleanupSocket()
    if (this.process && !this.process.killed) this.process.kill()
    this.process = null
    this.cachedPathInfo = null
    // 保持 isDestroyed=true，避免退出事件被误转发给 renderer 造成播放状态混乱。
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

  sendEvent(name: MpvEventName, data?: unknown) {
    if (this.isDestroyed && name !== 'error') return
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
      seeked: WIN_MAIN_RENDERER_EVENT_NAME.mpv_seeked,
    }
    // 仅对状态变化类事件保留调试日志，避免 timeUpdate/duration 刷屏。
    if (name !== 'timeUpdate' && name !== 'duration') {
      log.info(`[MpvController sendEvent] instance=${this.instanceId} name=${name} isDestroyed=${this.isDestroyed}`)
    }
    sendEvent(eventNames[name], data)
  }

  /**
   * 运行 mpv --audio-device=help 获取可用设备列表
   */
  static async listAudioDevices(): Promise<Array<{ id: string, name: string }>> {
    const mpvPath = resolveMpvPath()
    log.info(`[listAudioDevices] mpv path: ${mpvPath.path} source: ${mpvPath.source}`)
    return new Promise((resolve) => {
      // 仅枚举设备，不加载用户配置，不初始化视频/窗口，避免 probing 时抢占音频设备
      const proc = spawn(mpvPath.path, ['--no-config', '--no-video', '--force-window=no', '--audio-device=help'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      proc.stdout?.on('data', (data) => { output += String(data) })
      proc.stderr?.on('data', (data) => { output += String(data) })
      proc.on('close', (code) => {
        log.info(`[listAudioDevices] mpv exited code=${code ?? 'null'} output length=${output.length}`)
        const devices: Array<{ id: string, name: string }> = [{ id: 'auto', name: '默认设备' }]
        // macOS 上 mpv 会同时列出 coreaudio 与 avfoundation 两套驱动，
        // 造成同一物理设备重复出现；按名称去重，并优先保留 avfoundation（mpv 默认驱动）
        const deviceMap = new Map<string, string>()
        for (const line of output.split('\n')) {
          const match = line.match(/^\s*'([^']+)'\s*\(([^)]+)\)/)
          if (!match || match[1] === 'auto') continue
          const id = match[1]
          const name = match[2]
          const existingId = deviceMap.get(name)
          if (!existingId) {
            deviceMap.set(name, id)
          } else if (isMac && id.startsWith('avfoundation/') && !existingId.startsWith('avfoundation/')) {
            deviceMap.set(name, id)
          }
        }
        for (const [name, id] of deviceMap) {
          devices.push({ id, name })
        }
        log.info(`[listAudioDevices] parsed devices: ${JSON.stringify(devices)}`)
        resolve(devices)
      })
      proc.on('error', (err) => {
        log.warn(`[listAudioDevices] mpv spawn error: ${err.message}`)
        resolve([])
      })
      setTimeout(() => {
        log.warn('[listAudioDevices] mpv timeout')
        resolve([])
      }, 5000)
    })
  }
}

let activeMpvController = new MpvController()
export const getMpvController = () => activeMpvController
const setActiveMpvController = (controller: MpvController) => {
  activeMpvController = controller
}

export interface MpvRestartState {
  url?: string
  time?: number
  playing?: boolean
}

const doRestartMpvController = async(state: MpvRestartState): Promise<void> => {
  const oldController = activeMpvController
  const newController = new MpvController()
  // renderer 端的 currentUrl 可能因 HMR 等原因丢失，优先使用 main process 记录的 URL
  let url = state.url && state.url.length > 0 ? state.url : oldController.loadedUrl
  log.info(`[restartMpvController] start old=${oldController.instanceId} new=${newController.instanceId} rendererUrl=${state.url ? sanitizeUrl(state.url) : '<none>'} loadedUrl=${oldController.loadedUrl ? sanitizeUrl(oldController.loadedUrl) : '<none>'} time=${state.time} playing=${state.playing}`)
  if (!url && oldController.hasFileLoaded) {
    const pathFromMpv = await oldController.getPath().catch(() => null)
    log.info(`[restartMpvController] fallback path from mpv: ${pathFromMpv ? sanitizeUrl(pathFromMpv) : '<none>'}`)
    if (pathFromMpv) url = pathFromMpv
  }

  try {
    await newController.ensureStarted()
    log.info(`[restartMpvController] new controller ${newController.instanceId} started`)
    if (url) {
      // 先不通知 renderer loaded，等 play() 成功后再补发，避免切换期间 renderer 侧
      // handleCanplay 调用 setPause 与新实例的 play 命令竞争。
      await newController.loadUrl(url, { emitLoaded: false })
      log.info(`[restartMpvController] new controller ${newController.instanceId} loaded url`)
      // 把目标恢复位置记录到 pausedAt，play() 内部会精确 seek 到该位置
      if (state.time && state.time > 0) {
        newController.pausedAt = state.time
      }
      // 在新实例加载完成后立即接管，避免 loaded 事件触发的 renderer 侧 setPause
      // 被错误地发给旧实例；此时新实例已是 pause 状态，再多一次 pause 也无害。
      setActiveMpvController(newController)
      log.info(`[restartMpvController] switched to new controller ${newController.instanceId} before play`)
      if (state.playing) {
        await newController.play()
        log.info(`[restartMpvController] new controller ${newController.instanceId} playing`)
        // 等待 loadUrl 阶段排队的 pause=true 事件被处理，并确认播放状态
        await new Promise(resolve => setTimeout(resolve, 100))
        const isPaused = await newController.getPaused().catch(() => true)
        if (isPaused) {
          log.warn(`[restartMpvController] controller ${newController.instanceId} still paused, replaying`)
          await newController.play()
        }
      }
      // 播放命令生效后再通知 renderer，保证状态同步不会把新实例暂停。
      newController.sendEvent('loaded')
      void newController.getDuration().then(duration => {
        newController.sendEvent('duration', duration)
      }).catch(() => {})
    } else {
      // 新进程准备就绪后再接管，避免中间状态没有可用控制器
      setActiveMpvController(newController)
      log.info(`[restartMpvController] switched to new controller ${newController.instanceId}`)
    }
  } catch (err) {
    // 新进程启动失败，回退到旧进程，避免 active controller 指向被销毁的实例
    log.error('[restartMpvController] new controller failed:', err)
    await newController.destroy()
    if (getMpvController() === newController) {
      setActiveMpvController(oldController)
      log.info(`[restartMpvController] rolled back to old controller ${oldController.instanceId}`)
    }
    throw err
  }

  // 旧进程在新进程成功接管后再销毁，实现无感切换
  if (getMpvController() === newController) {
    log.info(`[restartMpvController] destroying old controller ${oldController.instanceId}`)
    await oldController.destroy()
  }
  log.info('[restartMpvController] done')
}

// 串行化 restart：快速连续切换输出设备/参数时多个 restart 交错，
// setActiveMpvController / destroy 顺序会错乱，导致 active 指向旧设备的实例或新实例被误销毁，
// 表现为切换卡住、要切好几次才到目标设备。
let restartQueue: Promise<void> = Promise.resolve()
export const restartMpvController = async(state: MpvRestartState): Promise<void> => {
  const run = restartQueue.then(async() => doRestartMpvController(state))
  restartQueue = run.catch(() => {})
  return run
}

app.on('before-quit', () => {
  void getMpvController().destroy()
})
