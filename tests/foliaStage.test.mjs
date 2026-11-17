import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 推送到 Folia 歌词舞台（src/main/modules/foliaStage）：歌词转换、封面、连接文件、请求与推送状态机。
// 源码用 webpack 的 @common 别名和无扩展名的相对导入，测试里补上。

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src')
const resolveTs = base => {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return pathToFileURL(candidate).href
  }
  return null
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@common/')) {
      const url = resolveTs(path.join(srcDir, 'common', specifier.slice('@common/'.length)))
      if (url) return nextResolve(url, context)
    }
    if (specifier.startsWith('./') && context.parentURL?.includes('/src/') && !specifier.endsWith('.ts')) {
      const url = resolveTs(path.join(path.dirname(fileURLToPath(context.parentURL)), specifier))
      if (url) return nextResolve(url, context)
    }
    return nextResolve(specifier, context)
  },
})

const { buildFoliaLyricContent, formatStamp } = await import('../src/main/modules/foliaStage/lyric.ts')
const { resolveFoliaCover, MAX_COVER_BYTES } = await import('../src/main/modules/foliaStage/cover.ts')
const { parseConnectionFile, resolveConnectionFilePaths, resolveSystemAppDataDir, readStageConnection } = await import('../src/main/modules/foliaStage/connection.ts')
const { requestStage } = await import('../src/main/modules/foliaStage/client.ts')
const bridgeModule = await import('../src/main/modules/foliaStage/bridge.ts')
const { createFoliaStageBridge, TRACK_SETTLE_MS, UPDATE_DEBOUNCE_MS, CLOCK_DEBOUNCE_MS, DRIFT_MS, DRIFT_RATE_MS, POLL_MS, RETRY_BACKOFF_MS } = bridgeModule

/** 解开 `[awlrc:...]` 容器 */
const decodeContainer = content => {
  const match = /^\[awlrc:(.+)\]$/.exec(content)
  assert.ok(match, `not a container: ${content}`)
  const tracks = {}
  for (const segment of match[1].split(',')) {
    const index = segment.indexOf(':')
    tracks[segment.slice(0, index)] = Buffer.from(segment.slice(index + 1), 'base64').toString('utf-8')
  }
  return tracks
}

test('stamps: always three-digit milliseconds', () => {
  assert.equal(formatStamp(0), '[00:00.000]')
  assert.equal(formatStamp(12_340), '[00:12.340]')
  assert.equal(formatStamp(163_097), '[02:43.097]')
  assert.equal(formatStamp(3_725_005), '[62:05.005]')
  assert.equal(formatStamp(-5), '[00:00.000]')
})

test('lyrics: word-by-word, translation and romaji share the line stamp', () => {
  const content = buildFoliaLyricContent({
    lyric: '[00:01.00]君の名は\n[00:04.50]夢の中',
    tlyric: '[00:01.00]你的名字\n[00:04.50]在梦里',
    rlyric: '[00:01.00]kimi no na wa\n[00:04.50]yume no naka',
    lxlyric: '[00:01.000]<0,300>君<300,200>の<500,400>名<900,300>は\n[00:04.500]<0,500>夢<500,300>の<800,700>中',
  })
  const tracks = decodeContainer(content)
  assert.deepEqual(Object.keys(tracks), ['lrc', 'tlrc', 'rlrc', 'awlrc'])
  assert.equal(tracks.lrc, '[00:01.000]君の名は\n[00:04.500]夢の中')
  assert.equal(tracks.tlrc, '[00:01.000]你的名字\n[00:04.500]在梦里')
  assert.equal(tracks.rlrc, '[00:01.000]kimi no na wa\n[00:04.500]yume no naka')
  assert.equal(tracks.awlrc, '[00:01.000]<0,300>君<300,200>の<500,400>名<900,300>は\n[00:04.500]<0,500>夢<500,300>の<800,700>中')
})

test('lyrics: two-digit LRC fractions are written as milliseconds, offset folded into the stamps', () => {
  const tracks = decodeContainer(buildFoliaLyricContent({
    lyric: '[offset:500]\n[00:12.34]Hello\n[00:15.5]World',
    tlyric: '[00:12.34]你好',
    rlyric: '',
    lxlyric: '',
  }))
  // 生效位置 = 播放位置 + offset：offset 为正时歌词提前 500ms
  assert.equal(tracks.lrc, '[00:11.840]Hello\n[00:15.000]World')
  assert.equal(tracks.tlrc, '[00:11.840]你好')
  assert.equal(tracks.awlrc, undefined)
  assert.equal(tracks.rlrc, undefined)
})

test('lyrics: none, blank or untimed → no lyric source', () => {
  assert.equal(buildFoliaLyricContent(null), null)
  assert.equal(buildFoliaLyricContent({ lyric: '', tlyric: '', rlyric: '', lxlyric: '' }), null)
  assert.equal(buildFoliaLyricContent({ lyric: 'no timestamps here', tlyric: '', rlyric: '', lxlyric: '' }), null)
})

test('lyrics: markup characters in text cannot break the word markers', () => {
  const tracks = decodeContainer(buildFoliaLyricContent({
    lyric: '[00:01.00]a<b',
    tlyric: '',
    rlyric: '',
    lxlyric: '[00:01.000]<0,300>a<b',
  }))
  assert.ok(!tracks.lrc.includes('<'))
})

test('cover: http url, data uri, local file, too large', async() => {
  assert.deepEqual(await resolveFoliaCover('https://y.qq.com/a.jpg'), { coverUrl: 'https://y.qq.com/a.jpg' })
  assert.equal(await resolveFoliaCover(''), null)

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  assert.deepEqual(await resolveFoliaCover(`data:image/png;base64,${png.toString('base64')}`), { cover: { mimeType: 'image/png', data: png.toString('base64') } })
  // 声明成 jpg、实际是 png：按文件头
  assert.equal((await resolveFoliaCover(`data:image/jpg;base64,${png.toString('base64')}`)).cover.mimeType, 'image/png')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-cover-'))
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])
  const file = path.join(dir, 'song.flac.png')
  fs.writeFileSync(file, jpg)
  assert.equal((await resolveFoliaCover(file)).cover.mimeType, 'image/jpeg')
  assert.equal((await resolveFoliaCover(pathToFileURL(file).href)).cover.data, jpg.toString('base64'))

  const big = path.join(dir, 'big.jpg')
  fs.writeFileSync(big, Buffer.concat([jpg, Buffer.alloc(MAX_COVER_BYTES)]))
  assert.equal(await resolveFoliaCover(big), null)
  assert.equal(await resolveFoliaCover(path.join(dir, 'missing.jpg')), null)
  assert.equal(await resolveFoliaCover('relative/path.jpg'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('connection file: system app data dir, not the portable override', () => {
  assert.equal(resolveSystemAppDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, homeDir: 'C:\\Users\\a' }), 'C:\\Users\\a\\AppData\\Roaming')
  assert.equal(resolveSystemAppDataDir({ platform: 'win32', env: {}, homeDir: 'C:\\Users\\a' }), path.join('C:\\Users\\a', 'AppData', 'Roaming'))
  assert.equal(resolveSystemAppDataDir({ platform: 'darwin', env: {}, homeDir: '/Users/a' }), path.join('/Users/a', 'Library', 'Application Support'))
  assert.equal(resolveSystemAppDataDir({ platform: 'linux', env: {}, homeDir: '/home/a' }), path.join('/home/a', '.config'))
  assert.equal(resolveSystemAppDataDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x/cfg' }, homeDir: '/home/a' }), '/x/cfg')
})

test('connection file: location per platform and validation', async() => {
  assert.deepEqual(resolveConnectionFilePaths({ platform: 'win32', env: {}, appDataDir: 'C:\\Users\\a\\AppData\\Roaming' }),
    [path.join('C:\\Users\\a\\AppData\\Roaming', 'Folia', 'stage', 'connection.json')])
  assert.deepEqual(resolveConnectionFilePaths({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, appDataDir: '/home/a/.config' }),
    [path.join('/run/user/1000', 'folia', 'stage.json'), path.join('/home/a/.config', 'Folia', 'stage', 'connection.json')])

  const valid = { version: 1, pid: process.pid, port: 32107, baseUrl: 'http://127.0.0.1:32107', token: 't0k' }
  assert.deepEqual(parseConnectionFile(JSON.stringify(valid)), { pid: process.pid, port: 32107, token: 't0k' })
  assert.equal(parseConnectionFile('{'), null)
  assert.equal(parseConnectionFile(JSON.stringify({ ...valid, version: 2 })), null)
  assert.equal(parseConnectionFile(JSON.stringify({ ...valid, token: '' })), null)
  // 不是本机回环地址的不认
  assert.equal(parseConnectionFile(JSON.stringify({ ...valid, baseUrl: 'http://192.168.1.5:32107' })), null)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-conn-'))
  const file = path.join(dir, 'connection.json')
  assert.equal(await readStageConnection([file]), null)
  fs.writeFileSync(file, JSON.stringify(valid))
  assert.equal((await readStageConnection([file])).token, 't0k')
  // 写文件的进程已经不在：残留文件
  fs.writeFileSync(file, JSON.stringify({ ...valid, pid: 2 ** 22 + 12345 }))
  assert.equal(await readStageConnection([file]), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('client: bearer token, JSON body, parsed response', async() => {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body })
      res.writeHead(req.url == '/bad' ? 409 : 200, { 'Content-Type': 'application/json' })
      res.end(req.url == '/bad' ? '{"code":"X"}' : '{"ok":true}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const connection = { pid: 0, port: server.address().port, token: 'secret' }
  assert.deepEqual(await requestStage(connection, 'POST', '/stage/lyrics', { title: '歌' }), { status: 200, body: { ok: true } })
  assert.deepEqual(await requestStage(connection, 'DELETE', '/bad'), { status: 409, body: { code: 'X' } })
  assert.deepEqual(seen[0], { method: 'POST', url: '/stage/lyrics', auth: 'Bearer secret', type: 'application/json; charset=utf-8', body: '{"title":"歌"}' })
  assert.equal(seen[1].body, '')
  server.close()
  await assert.rejects(requestStage(connection, 'GET', '/stage/status'))
})

// ---- 状态机：假时钟、假 Folia ----

const createHarness = ({ connected = true, respond } = {}) => {
  let now = 1_000_000
  let timers = []
  let timerId = 0
  const requests = []
  let updatedAt = 0
  let connection = connected ? { pid: 1, port: 32107, token: 'tok' } : null
  const logs = []

  const defaultRespond = (method, pathname) => {
    if (pathname == '/stage/lyrics') return { status: 200, body: { lyricsSession: { updatedAt: ++updatedAt } } }
    return { status: 200, body: {} }
  }

  const bridge = createFoliaStageBridge({
    readConnection: async() => connection,
    request: async(conn, method, pathname, body) => {
      requests.push({ method, pathname, body, token: conn.token, at: now })
      const custom = respond?.(method, pathname, body)
      if (custom instanceof Error) throw custom
      return custom ?? defaultRespond(method, pathname, body)
    },
    buildLyricContent: texts => texts.lyric ? `LRC:${texts.lyric}|${texts.tlyric}` : null,
    resolveCover: async picUrl => picUrl ? { coverUrl: picUrl } : null,
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++timerId
      timers.push({ id, at: now + ms, fn })
      return id
    },
    clearTimeout: id => { timers = timers.filter(timer => timer.id !== id) },
    log: (level, message) => { logs.push(`${level} ${message}`) },
  })

  const settle = async() => {
    for (let i = 0; i < 20; i++) await bridge.flush()
  }
  /** 往前走 ms，依次触发到期的计时器，每步等队列发完 */
  const advance = async ms => {
    const end = now + ms
    for (;;) {
      // 队列里的任务可能又排了新的计时器
      await settle()
      timers.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = timers[0]
      if (!next || next.at > end) break
      timers.shift()
      now = Math.max(now, next.at)
      next.fn()
    }
    now = end
  }
  const take = () => requests.splice(0)
  const posts = list => list.filter(r => r.pathname != '/stage/status')

  return {
    bridge,
    advance,
    settle,
    take,
    posts,
    logs,
    get now() { return now },
    setConnection(value) { connection = value },
  }
}

const idleStatus = {
  status: 'stoped', name: '', singer: '', albumName: '', picUrl: '', progress: 0, duration: 0, playbackRate: 1,
  lyricLineText: '', lyricLineAllText: '', lyric: '', tlyric: '', rlyric: '', lxlyric: '', collect: false, volume: 0, mute: false,
}
const toggle = (name, extra = {}) => ({ collect: false, name, singer: 'Singer', albumName: 'Album', picUrl: 'https://p/1.jpg', lyric: '', lyricLineText: '', lyricLineAllText: '', ...extra })
const lyricUpdate = (lyric, tlyric = '') => ({ lyric, tlyric, rlyric: '', lxlyric: '', lyricLineText: '', lyricLineAllText: '' })

const start = async(h, snapshot = idleStatus) => {
  h.bridge.setEnabled(true, snapshot)
  await h.advance(0)
  const first = h.take()
  return first
}

test('bridge: connects, waits for lyrics after a track change, pushes once with everything', async() => {
  const h = createHarness()
  const first = await start(h)
  assert.deepEqual(first.map(r => `${r.method} ${r.pathname}`), ['GET /stage/status'])
  assert.equal(h.bridge.getStatus().state, 'connected')

  h.bridge.handleStatus({ duration: 0, progress: 0 })
  h.bridge.handleStatus(toggle('Song A'))
  h.bridge.handleStatus({ status: 'paused' })
  h.bridge.handleStatus({ duration: 200 })
  await h.advance(300)
  h.bridge.handleStatus(lyricUpdate('[00:01.00]a', '[00:01.00]甲'))
  await h.advance(UPDATE_DEBOUNCE_MS + 10)

  const sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  assert.equal(sent[0].pathname, '/stage/lyrics')
  assert.deepEqual(sent[0].body, {
    title: 'Song A',
    artist: 'Singer',
    album: 'Album',
    durationMs: 200_000,
    lyricSource: { type: 'local', lrcContent: 'LRC:[00:01.00]a|[00:01.00]甲' },
    coverUrl: 'https://p/1.jpg',
    positionMs: 0,
    paused: true,
  })

  // 那之后什么都没变：没有重复的会话推送
  await h.advance(TRACK_SETTLE_MS * 2)
  assert.deepEqual(h.posts(h.take()), [])
})

test('bridge: no lyrics in time → pushes the track first, again when lyrics arrive; empty updates do not re-push', async() => {
  const h = createHarness()
  await start(h)
  h.bridge.handleStatus(toggle('Song B'))
  await h.advance(TRACK_SETTLE_MS + 10)
  let sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body.lyricSource, undefined)

  // 歌词加载失败或找不到：空的 lyricUpdated 不该让舞台重新载入
  h.bridge.handleStatus(lyricUpdate(''))
  await h.advance(UPDATE_DEBOUNCE_MS + 10)
  assert.deepEqual(h.posts(h.take()), [])

  h.bridge.handleStatus(lyricUpdate('[00:02.00]b'))
  await h.advance(UPDATE_DEBOUNCE_MS + 10)
  sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body.lyricSource.lrcContent, 'LRC:[00:02.00]b|')
})

test('bridge: play / pause / seek push the clock with the session id; steady playback only corrects drift', async() => {
  const h = createHarness()
  await start(h)
  h.bridge.handleStatus(toggle('Song C'))
  h.bridge.handleStatus({ duration: 180 })
  h.bridge.handleStatus(lyricUpdate('[00:01.00]c'))
  await h.advance(UPDATE_DEBOUNCE_MS + 10)
  h.take()

  h.bridge.handleStatus({ status: 'playing' })
  await h.advance(CLOCK_DEBOUNCE_MS + 10)
  let sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  assert.equal(sent[0].pathname, '/stage/lyrics/clock')
  assert.equal(sent[0].body.paused, false)
  assert.equal(sent[0].body.sessionUpdatedAt, 1)
  assert.equal(sent[0].body.durationMs, 180_000)

  // 正常推进的进度不触发推送
  for (let i = 1; i <= 8; i++) {
    await h.advance(250)
    h.bridge.handleStatus({ progress: (250 * i + 90) / 1000 })
  }
  assert.deepEqual(h.posts(h.take()), [])

  // 拖动到 90 秒
  h.bridge.handleStatus({ progress: 90 })
  await h.advance(CLOCK_DEBOUNCE_MS + 10)
  sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  // 拖动后合并窗口结束时发出，位置是 90 秒加上这段时间
  assert.equal(sent[0].body.positionMs, 90_000 + CLOCK_DEBOUNCE_MS)

  // 漂移纠正：每 DRIFT_MS 一次
  await h.advance(DRIFT_MS + 300)
  sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  assert.equal(sent[0].pathname, '/stage/lyrics/clock')

  h.bridge.handleStatus({ status: 'paused' })
  await h.advance(CLOCK_DEBOUNCE_MS + 10)
  sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body.paused, true)
  // 暂停时没有漂移纠正
  await h.advance(DRIFT_MS * 3)
  assert.deepEqual(h.posts(h.take()), [])
})

test('bridge: playback rate — position advances at the rate and the clock is corrected often', async() => {
  const h = createHarness()
  await start(h)
  h.bridge.handleStatus(toggle('Song D'))
  h.bridge.handleStatus(lyricUpdate('[00:01.00]d'))
  h.bridge.handleStatus({ status: 'playing', playbackRate: 1.5 })
  const playingFrom = h.now
  await h.advance(UPDATE_DEBOUNCE_MS + 10)
  h.take()
  const startedAt = h.now
  await h.advance(2000)
  const sent = h.posts(h.take())
  // 每 DRIFT_RATE_MS 纠正一次（第一次落在会话推送之后最近的一拍上）
  assert.ok(sent.length >= 2000 / DRIFT_RATE_MS - 1, `got ${sent.length}`)
  for (let i = 1; i < sent.length; i++) assert.equal(sent[i].at - sent[i - 1].at, DRIFT_RATE_MS)
  assert.ok(sent[0].at - startedAt <= DRIFT_RATE_MS + bridgeModule.TICK_MS)
  // 1.5 倍速：推出的位置从开始播放起按 1.5 倍推进
  for (const push of sent) assert.equal(push.body.positionMs, Math.round((push.at - playingFrom) * 1.5))
})

test('bridge: stage taken over (409) → stops pushing until the next song', async() => {
  let reject = false
  const h = createHarness({ respond: (method, pathname) => reject && pathname == '/stage/lyrics/clock' ? { status: 409, body: { code: 'STAGE_LYRICS_SESSION_CHANGED' } } : undefined })
  await start(h)
  h.bridge.handleStatus(toggle('Song E'))
  h.bridge.handleStatus(lyricUpdate('[00:01.00]e'))
  await h.advance(UPDATE_DEBOUNCE_MS + 10)
  h.take()

  reject = true
  h.bridge.handleStatus({ status: 'playing' })
  await h.advance(CLOCK_DEBOUNCE_MS + 10)
  assert.equal(h.posts(h.take()).length, 1)
  assert.equal(h.bridge.getStatus().detached, true)

  h.bridge.handleStatus({ status: 'paused' })
  h.bridge.handleStatus(lyricUpdate('[00:01.00]e2'))
  await h.advance(DRIFT_MS * 2)
  assert.deepEqual(h.posts(h.take()), [])

  reject = false
  h.bridge.handleStatus(toggle('Song F'))
  await h.advance(TRACK_SETTLE_MS + 10)
  const sent = h.posts(h.take())
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body.title, 'Song F')
  assert.equal(h.bridge.getStatus().detached, false)
})

test('bridge: stop and disable clear the stage', async() => {
  const h = createHarness()
  await start(h)
  h.bridge.handleStatus(toggle('Song G'))
  await h.advance(TRACK_SETTLE_MS + 10)
  h.take()
  h.bridge.handleStatus({ status: 'stoped' })
  await h.advance(10)
  assert.deepEqual(h.posts(h.take()).map(r => `${r.method} ${r.pathname}`), ['DELETE /stage/state'])

  h.bridge.handleStatus(toggle('Song H'))
  await h.advance(TRACK_SETTLE_MS + 10)
  assert.equal(h.posts(h.take()).length, 1)
  h.bridge.setEnabled(false)
  await h.advance(10)
  assert.deepEqual(h.posts(h.take()).map(r => `${r.method} ${r.pathname}`), ['DELETE /stage/state'])
  assert.equal(h.bridge.getStatus().state, 'disabled')
  // 关着时不推
  h.bridge.handleStatus(toggle('Song I'))
  await h.advance(TRACK_SETTLE_MS * 2 + POLL_MS)
  assert.deepEqual(h.take(), [])
})

test('bridge: enabling mid-song pushes the current song; stale translation of the previous song is not used', async() => {
  const h = createHarness()
  const first = await start(h, { ...idleStatus, status: 'playing', name: 'Now', singer: 'S', progress: 30, duration: 100, lyric: '', tlyric: '[00:01.00]上一首的翻译' })
  assert.deepEqual(first.map(r => r.pathname), ['/stage/status', '/stage/lyrics'])
  assert.equal(first[1].body.title, 'Now')
  assert.equal(first[1].body.positionMs, 30_000)
  assert.equal(first[1].body.paused, false)
  assert.equal(first[1].body.lyricSource, undefined)
})

test('bridge: Folia not running → waits; appears later → connects and pushes', async() => {
  const h = createHarness({ connected: false })
  h.bridge.setEnabled(true, idleStatus)
  h.bridge.handleStatus(toggle('Song J'))
  await h.advance(TRACK_SETTLE_MS + 10)
  assert.deepEqual(h.take(), [])
  assert.equal(h.bridge.getStatus().state, 'waiting')

  h.setConnection({ pid: 7, port: 32107, token: 'new' })
  await h.advance(POLL_MS + 10)
  const sent = h.take()
  assert.deepEqual(sent.map(r => r.pathname), ['/stage/status', '/stage/lyrics'])
  assert.equal(sent[1].token, 'new')

  // Folia 退出（连接文件删除）
  h.setConnection(null)
  await h.advance(POLL_MS + 10)
  assert.equal(h.bridge.getStatus().state, 'waiting')
})

test('bridge: wrong token is not retried until the file changes; unreachable backs off', async() => {
  let mode = 'ok'
  const h = createHarness({
    respond: (method, pathname) => {
      if (mode == 'unauthorized') return { status: 401, body: {} }
      if (mode == 'down') return new Error('ECONNREFUSED')
      return undefined
    },
  })
  mode = 'unauthorized'
  await start(h)
  assert.equal(h.bridge.getStatus().state, 'waiting')
  await h.advance(POLL_MS * 3)
  assert.deepEqual(h.take(), [])

  mode = 'ok'
  h.setConnection({ pid: 1, port: 32107, token: 'regenerated' })
  await h.advance(POLL_MS + 10)
  assert.deepEqual(h.take().map(r => r.token), ['regenerated'])
  assert.equal(h.bridge.getStatus().state, 'connected')

  mode = 'down'
  h.bridge.handleStatus(toggle('Song K'))
  await h.advance(TRACK_SETTLE_MS + 10)
  assert.equal(h.take().length, 1)
  assert.equal(h.bridge.getStatus().state, 'waiting')
  // 退避期间不重试
  await h.advance(RETRY_BACKOFF_MS - POLL_MS)
  assert.deepEqual(h.take(), [])
  mode = 'ok'
  await h.advance(POLL_MS * 2)
  assert.deepEqual(h.take().map(r => r.pathname), ['/stage/status', '/stage/lyrics'])
})

test('bridge: request body too large → retried once without the cover', async() => {
  const h = createHarness({ respond: (method, pathname, body) => pathname == '/stage/lyrics' && body.coverUrl ? { status: 413, body: {} } : undefined })
  await start(h)
  h.bridge.handleStatus(toggle('Song L'))
  await h.advance(TRACK_SETTLE_MS + 10)
  const sent = h.posts(h.take())
  assert.equal(sent.length, 2)
  assert.equal(sent[1].body.coverUrl, undefined)
  assert.equal(sent[1].body.title, 'Song L')
})
