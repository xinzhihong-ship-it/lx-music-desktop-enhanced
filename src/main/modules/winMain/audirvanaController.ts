import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { log } from '@common/utils'
import { checkAndCreateDir, joinPath } from '@common/utils/nodejs'
import { filterFileName } from '@common/utils/common'
import { clipFileNameLength, formatMusicName } from '@common/utils/tools'

const isMac = process.platform == 'darwin'
const defaultTmpDir = path.join(os.tmpdir(), 'lx-music-audirvana')

const runAppleScript = (script: string, timeout = 10000): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!isMac) {
      reject(new Error('Audirvana is only available on macOS'))
      return
    }
    log.info(`[Audirvana] AppleScript: ${script.replace(/\n/g, ' ').substring(0, 200)}`)
    execFile('osascript', ['-e', script], { timeout }, (err, stdout, stderr) => {
      if (err) {
        log.warn(`[Audirvana] AppleScript error: ${err.message}\nstderr: ${stderr}`)
        reject(err)
        return
      }
      const output = stdout.trim()
      if (output) log.info(`[Audirvana] AppleScript output: ${output}`)
      resolve(output)
    })
  })
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const isAudirvanaRunning = async (): Promise<boolean> => {
  try {
    const result = await runAppleScript('tell application "System Events" to (name of processes) contains "Audirvana"')
    return result === 'true'
  } catch {
    return false
  }
}

const hideAudirvanaWindow = (): Promise<void> => {
  // 启动后强制隐藏 Audirvana 主窗口，避免它跳到前台
  return runAppleScript('tell application "System Events" to set visible of process "Audirvana" to false')
    .then(() => log.info('[Audirvana] window hidden'))
    .catch(err => log.warn('[Audirvana] hide window failed', err))
}

const ensureAudirvanaRunning = async() => {
  const script = 'tell application "System Events" to (name of processes) contains "Audirvana"'
  try {
    const result = await runAppleScript(script)
    log.info(`[Audirvana] running check: ${result}`)
    if (result !== 'true') {
      log.info('[Audirvana] launching Audirvana in background...')
      // launch 只启动应用，不把它带到前台
      await runAppleScript('tell application "Audirvana" to launch')
      // 等待 Audirvana 真正启动并响应，最多 10 秒
      const start = Date.now()
      while (Date.now() - start < 10000) {
        await delay(1000)
        try {
          const state = await getState()
          log.info(`[Audirvana] launch wait state: ${state}`)
          await hideAudirvanaWindow()
          // 进程启动并能响应 AppleScript 后，再给它 1.5 秒让音频引擎初始化，
          // 避免立即 setTrack 时音频引擎还没准备好导致假播放。
          await delay(1500)
          return
        } catch {}
      }
      log.warn('[Audirvana] launch wait timeout')
    }
  } catch (err) {
    log.warn('[Audirvana] ensureAudirvanaRunning failed', err)
  }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const downloadFile = (url: string, dest: string, redirectCount = 0): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('too many redirects'))
      return
    }
    log.info(`[Audirvana] downloading to ${dest}`)
    const client = url.startsWith('https:') ? https : http
    const parsed = new URL(url)
    const req = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        log.info(`[Audirvana] redirect to ${res.headers.location}`)
        void downloadFile(res.headers.location, dest, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        let msg = `download failed: ${res.statusCode}`
        if (res.statusCode === 410) msg = '歌曲链接已过期（410）'
        else if (res.statusCode === 403) msg = '歌曲链接无权限（403）'
        else if (res.statusCode === 404) msg = '歌曲文件不存在（404）'
        reject(new Error(msg))
        return
      }
      let received = 0
      const file = fs.createWriteStream(dest)
      res.on('data', (chunk) => {
        received += chunk.length
      })
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        log.info(`[Audirvana] download finished: ${received} bytes`)
        resolve()
      })
      file.on('error', reject)
    })
    req.on('error', (err) => {
      log.warn('[Audirvana] download error', err)
      reject(err)
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('download timeout'))
    })
    req.end()
  })
}

const toAppleScriptString = (str: string): string => {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

const fileExistsAndValid = (filePath: string): boolean => {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() && stat.size > 10000
  } catch {
    return false
  }
}

export const getState = async(): Promise<'stopped' | 'playing' | 'paused'> => {
  try {
    const result = await runAppleScript('tell application "Audirvana" to get player state')
    const state = result.toLowerCase()
    if (state.includes('play')) return 'playing'
    if (state.includes('paus')) return 'paused'
    return 'stopped'
  } catch {
    return 'stopped'
  }
}

export const getPosition = async(): Promise<number> => {
  try {
    const result = await runAppleScript('tell application "Audirvana" to get player position')
    const pos = parseFloat(result)
    return isNaN(pos) ? 0 : pos
  } catch {
    return 0
  }
}

export const getDuration = async(): Promise<number> => {
  try {
    const result = await runAppleScript('tell application "Audirvana" to get playing track duration')
    const dur = parseInt(result, 10)
    return isNaN(dur) ? 0 : dur
  } catch {
    return 0
  }
}

export const setPosition = async(position: number): Promise<void> => {
  log.info(`[Audirvana] set position to ${position}`)
  // Audirvana 的 AppleScript 没有 `play` 命令，使用 `playpause`；
  // 只在 seek 前处于非播放状态时才恢复播放，避免把正在播放的歌暂停。
  const script = `tell application "Audirvana"
  set curState to player state
  set player position to ${position}
  if curState is not playing then playpause
end tell`
  await runAppleScript(script)
}

const syncSleep = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export const quit = (): void => {
  log.info('[Audirvana] quitting Audirvana')

  // 1. 先发送正常 quit 命令（同步执行，确保退出命令在应用关闭前完成）
  try {
    execFileSync('osascript', ['-e', 'tell application "Audirvana" to quit'], { timeout: 5000 })
  } catch (err) {
    log.warn('[Audirvana] normal quit command failed:', err)
  }

  // 2. 同步阻塞等待 Audirvana 进程真正消失，最多 5 秒
  const start = Date.now()
  while (Date.now() - start < 5000) {
    try {
      const result = execFileSync('osascript', ['-e', 'tell application "System Events" to (name of processes) contains "Audirvana"'], { timeout: 2000 })
      if (result.toString().trim() !== 'true') {
        log.info('[Audirvana] quit confirmed')
        return
      }
    } catch {}
    syncSleep(500)
  }

  // 3. 进程还在，强制结束
  log.warn('[Audirvana] process still running after quit, force killing')
  try {
    execFileSync('pkill', ['-9', '-x', 'Audirvana'], { timeout: 3000 })
    log.info('[Audirvana] force kill sent')
  } catch (err) {
    log.warn('[Audirvana] force kill failed:', err)
  }
}

const waitForPlaying = async(maxWaitMs = 8000): Promise<boolean> => {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await delay(500)
    const state = await getState().catch(() => 'stopped')
    log.info(`[Audirvana] waitForPlaying state: ${state}`)
    if (state === 'playing') return true
  }
  return false
}

// 有些情况下 Audirvana 会报告 playing 但音频引擎还没真正出声，
// 通过检测 player position 是否在推进来确认它确实在播放。
const waitForPositionAdvancing = async(maxWaitMs = 6000, minAdvanceSec = 0.3): Promise<boolean> => {
  const startPos = await getPosition().catch(() => 0)
  log.info(`[Audirvana] waitForPositionAdvancing startPos=${startPos}`)
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await delay(800)
    const pos = await getPosition().catch(() => 0)
    log.info(`[Audirvana] waitForPositionAdvancing pos=${pos}`)
    if (pos - startPos >= minAdvanceSec) return true
  }
  return false
}

const waitForRealPlaying = async(maxWaitMs = 10000): Promise<boolean> => {
  if (!(await waitForPlaying(maxWaitMs))) return false
  const remaining = maxWaitMs - 500 // 留给 position 检测至少 500ms
  if (remaining <= 0) return true
  return waitForPositionAdvancing(remaining)
}

export const setTrack = async(params: { url: string, musicInfo?: LX.Music.MusicInfo, filePath?: string } | string): Promise<string> => {
  let url: string
  let filePath: string
  let isLocalFile = false

  if (typeof params === 'string') {
    url = params
    log.info(`[Audirvana] setTrack received string url: ${url.substring(0, 200)}`)
    if (url.startsWith('file://')) {
      filePath = decodeURIComponent(url.replace(/^file:\/\//, ''))
      isLocalFile = true
      log.info(`[Audirvana] local file (file://): ${filePath}`)
    } else if (/^[a-zA-Z]:\\/.test(url) || url.startsWith('/')) {
      // Windows / Unix 绝对路径，本地音乐直接播放
      try {
        filePath = decodeURIComponent(url)
      } catch (err) {
        log.warn(`[Audirvana] decodeURIComponent failed for url: ${url.substring(0, 200)}, using raw url`)
        filePath = url
      }
      isLocalFile = true
      log.info(`[Audirvana] local file path (/ or C:\\): ${filePath}`)
    } else {
      throw new Error('Audirvana 模式只支持本地文件或带下载地址的在线音乐')
    }
  } else {
    url = params.url
    filePath = params.filePath ?? ''
    log.info(`[Audirvana] setTrack received object, url: ${url.substring(0, 120)}, filePath: ${filePath}`)
  }

  log.info(`[Audirvana] setTrack called: ${url.substring(0, 120)}, isLocalFile: ${isLocalFile}`)
  await ensureAudirvanaRunning()

  // 确保目标目录存在（在线音乐需要）
  if (!isLocalFile) {
    const dir = path.dirname(filePath)
    await checkAndCreateDir(dir)
  }

  // 本地文件或用户已下载的文件直接复用
  if (fileExistsAndValid(filePath)) {
    log.info(`[Audirvana] reuse existing file: ${filePath}`)
  } else if (!isLocalFile) {
    await downloadFile(url, filePath)
  } else {
    throw new Error('本地音乐文件不存在或无效')
  }

  const fileUrl = `file://${encodeURI(filePath)}`

  // Audirvana 原生 AppleScript 接口：设置曲目后立刻播放（不 activate，避免跳到前台）
  // 使用 resume 而不是 playpause，避免在 Audirvana 已经处于 playing 状态时把播放暂停。
  const setTrackScript = () => `tell application "Audirvana"
  set event types reported to TrackAndPosition
  set playing track type AudioFile URL "${toAppleScriptString(fileUrl)}"
  delay 1
  if player state is not playing then
    playpause
  else
    resume
  end if
end tell`

  let playing = false
  try {
    await runAppleScript(setTrackScript(), 20000)
    log.info('[Audirvana] set playing track + play command sent')
    playing = await waitForRealPlaying(10000)
  } catch (err: any) {
    log.warn('[Audirvana] native set track failed, will retry', err.message)
  }

  // 如果没真正播放，用同样的脚本再试一次（Audirvana 偶尔第一次不响应）
  if (!playing) {
    try {
      log.info('[Audirvana] retrying setTrack')
      await runAppleScript(setTrackScript(), 20000)
      playing = await waitForRealPlaying(10000)
    } catch (err: any) {
      log.warn('[Audirvana] retry set track failed, trying open command', err.message)
    }
  }

  // 备用：用 open 命令把文件丢给 Audirvana，再显式播放
  if (!playing) {
    try {
      await openWithAudirvana(filePath)
      await delay(2000)
      await play().catch(() => {})
      playing = await waitForRealPlaying(10000)
    } catch (err: any) {
      log.warn('[Audirvana] open command failed', err.message)
    }
  }

  if (!playing) {
    throw new Error('Audirvana 未能开始播放该曲目')
  }

  return fileUrl
}

const openWithAudirvana = (filePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    log.info(`[Audirvana] opening file with Audirvana in background: ${filePath}`)
    // -g 让应用保持在后台，不激活到前台
    const child = spawn('open', ['-g', '-a', 'Audirvana', filePath], { timeout: 15000 })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        log.info('[Audirvana] open command succeeded')
        // open 之后仍可能显示窗口，再隐藏一次
        void hideAudirvanaWindow()
        resolve()
      } else {
        reject(new Error(`open command exited with ${code}`))
      }
    })
  })
}

export const play = async(): Promise<void> => {
  log.info('[Audirvana] play')
  // 避免把正在播放的歌暂停，只在 stopped/paused 时触发 playpause
  const script = `tell application "Audirvana"
  if player state is not playing then playpause
end tell`
  await runAppleScript(script)
  // 等待 Audirvana 真正开始推进，避免界面已经进入播放状态但实际没出声
  if (!(await waitForRealPlaying(8000))) {
    throw new Error('Audirvana 未能真正恢复播放')
  }
}

export const pause = async() => {
  log.info('[Audirvana] pause')
  await runAppleScript('tell application "Audirvana" to pause').catch(() => {})
}

export const stop = async() => {
  log.info('[Audirvana] stop')
  await runAppleScript('tell application "Audirvana" to stop').catch(() => {})
}

export const next = async() => {
  log.info('[Audirvana] next')
  await runAppleScript('tell application "Audirvana" to next track').catch(() => {})
}

export const previous = async() => {
  log.info('[Audirvana] previous')
  await runAppleScript('tell application "Audirvana" to previous track').catch(() => {})
}

export const cleanup = (targetDir?: string, maxAgeMs = 24 * 60 * 60 * 1000) => {
  const dir = targetDir || defaultTmpDir
  try {
    if (!fs.existsSync(dir)) return
    const now = Date.now()
    for (const file of fs.readdirSync(dir)) {
      const filePath = joinPath(dir, file)
      try {
        const stat = fs.statSync(filePath)
        if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(filePath)
      } catch {}
    }
  } catch (err) {
    log.warn('[Audirvana] cleanup failed', err)
  }
}
