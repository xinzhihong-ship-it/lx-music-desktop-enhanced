import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 「Folia 对接」（src/main/modules/foliaLink）：连接文件、接口校验、分享链接认平台、状态外推、问渲染进程、HTTP 服务。
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

const { resolveLinkFilePath, buildLinkConnectionInfo, writeLinkConnectionFile, removeLinkConnectionFile } = await import('../src/main/modules/foliaLink/connection.ts')
const { checkParams, isLinkOp, isRendererOp, detectSongListSource, extractSongListText, resolveSongListSource, LinkError } = await import('../src/main/modules/foliaLink/ops.ts')
const { createLinkState } = await import('../src/main/modules/foliaLink/state.ts')
const { createRendererRpc } = await import('../src/main/modules/foliaLink/rendererRpc.ts')
const { createLinkServer } = await import('../src/main/modules/foliaLink/server.ts')

const music = (id = 'kw_1') => ({ id, name: '歌', singer: '人', source: 'kw', interval: '03:00', meta: { songId: '1', albumName: '' } })

// ---------- 连接文件 ----------

test('connection file: system app data dir, XDG runtime dir on Linux', () => {
  assert.equal(
    resolveLinkFilePath({ platform: 'win32', env: {}, appDataDir: 'C:\\Users\\a\\AppData\\Roaming' }),
    path.join('C:\\Users\\a\\AppData\\Roaming', 'lx-music-folia-link', 'connection.json'),
  )
  assert.equal(resolveLinkFilePath({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, appDataDir: '/home/a/.config' }), path.join('/run/user/1000', 'lx-music-folia-link', 'connection.json'))
  assert.equal(resolveLinkFilePath({ platform: 'linux', env: { XDG_RUNTIME_DIR: 'relative' }, appDataDir: '/home/a/.config' }), path.join('/home/a/.config', 'lx-music-folia-link', 'connection.json'))
})

test('connection file: written whole, removed only by its own pid', async() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-link-'))
  const file = path.join(dir, 'sub', 'connection.json')
  const info = buildLinkConnectionInfo({ pid: 4242, port: 5000, token: 'abc', appVersion: '3.4.0' })
  assert.deepEqual(info, { version: 1, pid: 4242, port: 5000, baseUrl: 'http://127.0.0.1:5000', token: 'abc', appVersion: '3.4.0' })
  await writeLinkConnectionFile(file, info)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), info)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['connection.json'])
  await removeLinkConnectionFile(file, 1)
  assert.ok(fs.existsSync(file), 'another instance leaves the file alone')
  await removeLinkConnectionFile(file, 4242)
  assert.ok(!fs.existsSync(file))
  fs.rmSync(dir, { recursive: true, force: true })
})

// ---------- 接口校验 ----------

test('ops: whitelist and where each op runs', () => {
  assert.ok(isLinkOp('search'))
  assert.ok(isLinkOp('lists'))
  assert.ok(!isLinkOp('eval'))
  assert.ok(!isLinkOp(42))
  assert.ok(isRendererOp('play'))
  assert.ok(!isRendererOp('listAdd'))
})

test('ops: params are checked and trimmed to known fields', () => {
  assert.deepEqual(checkParams('search', { text: ' 晴天 ', source: 'all', extra: 1 }), { text: '晴天', source: 'all', page: 1 })
  assert.throws(() => checkParams('search', { text: '', source: 'all' }), err => err instanceof LinkError && err.code == 'invalid-params')
  assert.throws(() => checkParams('search', { text: 'a', source: 'all', page: 0 }), LinkError)
  assert.deepEqual(checkParams('control', { action: 'volume', value: 0.5 }), { action: 'volume', value: 0.5 })
  assert.throws(() => checkParams('control', { action: 'volume', value: 2 }), LinkError)
  assert.throws(() => checkParams('control', { action: 'rate', value: 3 }), LinkError)
  assert.deepEqual(checkParams('control', { action: 'next', value: 'x' }), { action: 'next' })
  assert.deepEqual(checkParams('control', { action: 'playMode', value: 'singleLoop' }), { action: 'playMode', value: 'singleLoop' })
  assert.throws(() => checkParams('control', { action: 'playMode', value: 'shuffle' }), LinkError)
  assert.throws(() => checkParams('control', { action: 'quality', value: '999k' }), LinkError)
  assert.throws(() => checkParams('control', { action: 'mute', value: 'yes' }), LinkError)
  assert.deepEqual(checkParams('play', { target: 'list', listId: 'love', musicId: 'kw_1' }), { target: 'list', listId: 'love', musicId: 'kw_1' })
  assert.equal(checkParams('play', { target: 'search', musicInfo: music() }).musicInfo.id, 'kw_1')
  assert.throws(() => checkParams('play', { target: 'search', musicInfo: { id: 'x' } }), LinkError)
  assert.throws(() => checkParams('play', { target: 'eval' }), LinkError)
  // 稍后播放：一首默认排最前，几首按顺序、top: false 排最后
  assert.deepEqual(checkParams('play', { target: 'later', musicInfo: music() }), { target: 'later', musicInfos: [music()], top: true })
  assert.equal(checkParams('play', { target: 'later', musicInfos: [music(), music()], top: false }).top, false)
  assert.equal(checkParams('play', { target: 'later', musicInfos: [music(), music()] }).musicInfos.length, 2)
  assert.throws(() => checkParams('play', { target: 'later', musicInfos: [] }), LinkError)
  assert.throws(() => checkParams('play', { target: 'later', musicInfo: music(), top: 'yes' }), LinkError)
  assert.throws(() => checkParams('listRemove', { listId: 'love', ids: [1] }), LinkError)
  assert.throws(() => checkParams('listAdd', { listId: 'love', musicInfos: 'x' }), LinkError)
  assert.throws(() => checkParams('lists', 'x'), LinkError)
  assert.deepEqual(checkParams('lists', undefined), {})
})

test('songlist links: platform from the host, links taken out of share texts', () => {
  assert.equal(detectSongListSource('https://music.163.com/playlist?id=123&userid=4'), 'wy')
  assert.equal(detectSongListSource('https://y.music.163.com/m/playlist?id=123'), 'wy')
  assert.equal(detectSongListSource('http://163cn.tv/abc'), 'wy')
  assert.equal(detectSongListSource('https://y.qq.com/n/ryqq/playlist/8522515502'), 'tx')
  assert.equal(detectSongListSource('https://c6.y.qq.com/base/fcgi-bin/u?__=abc'), 'tx')
  assert.equal(detectSongListSource('https://www.kugou.com/yy/special/single/546903.html'), 'kg')
  assert.equal(detectSongListSource('https://t1.kugou.com/song.html?id=abc'), 'kg')
  assert.equal(detectSongListSource('https://www.kuwo.cn/playlist_detail/3570611447'), 'kw')
  assert.equal(detectSongListSource('https://music.migu.cn/v3/music/playlist/179730639'), 'mg')
  assert.equal(detectSongListSource('https://c.migu.cn/abc'), 'mg')
  assert.equal(detectSongListSource('3570611447'), null)
  assert.equal(detectSongListSource('https://example.com/playlist/1'), null)
  assert.equal(detectSongListSource('https://evil163.com/playlist?id=1'), null)
  const share = '分享XX创建的歌单「夜」：https://y.qq.com/n/ryqq/playlist/8522515502 (@QQ音乐)'
  assert.equal(extractSongListText(share), 'https://y.qq.com/n/ryqq/playlist/8522515502')
  assert.equal(detectSongListSource(share), 'tx')
  assert.equal(extractSongListText(' 123 '), '123')
  assert.equal(resolveSongListSource('123', 'kg'), 'kg')
  assert.throws(() => resolveSongListSource('123'), err => err.code == 'unknown-source')
  assert.throws(() => resolveSongListSource('123', 'bili'), LinkError)
})

// ---------- 状态 ----------

test('state: position runs on while playing, holds when paused, never past the end', () => {
  let now = 1000
  const state = createLinkState({ now: () => now })
  state.update({ musicId: 'kw_1', isPlay: true, positionMs: 10_000, durationMs: 12_000, rate: 1 })
  now += 500
  assert.equal(state.read().positionMs, 10_500)
  state.update({ volume: 0.4 })
  assert.equal(state.read().positionMs, 10_500, 'a change without a position does not set the clock back')
  now += 5000
  assert.equal(state.read().positionMs, 12_000)
  state.update({ isPlay: false, positionMs: 11_000 })
  now += 3000
  assert.equal(state.read().positionMs, 11_000)
  state.update({ isPlay: true, rate: 1.5, positionMs: 0 })
  now += 1000
  assert.equal(state.read().positionMs, 1500)
  state.update({ loading: true })
  now += 1000
  assert.equal(state.read().positionMs, 1500, 'a loading track does not run on')
})

test('state: which changes are pushed at once', () => {
  let now = 0
  const state = createLinkState({ now: () => now })
  assert.equal(state.update({ musicId: 'kw_1', isPlay: true, positionMs: 0 }), true)
  now += 1000
  assert.equal(state.update({ positionMs: 1000 }), false, 'ordinary progress')
  now += 1000
  assert.equal(state.update({ positionMs: 60_000 }), true, 'a seek')
  assert.equal(state.update({ volume: 0.3 }), true)
  assert.equal(state.update({ volume: 0.3 }), false)
  assert.equal(state.update({ quality: { wanted: 'flac', current: 'flac', actual: '' } }), true)
  assert.equal(state.update({ quality: { wanted: 'flac' } }), false)
})

test('state: revisions for the queue, the lists and the loved songs', () => {
  const state = createLinkState({ now: () => 0 })
  state.update({ listId: 'default' })
  const first = state.read()
  assert.equal(state.listsChanged(['userlist_1']), false)
  let next = state.read()
  assert.equal(next.queueRev, first.queueRev)
  assert.equal(next.listsRev, first.listsRev + 1)
  assert.equal(next.loveRev, first.loveRev)
  assert.equal(state.listsChanged(['default', 'love']), true)
  const after = state.read()
  assert.equal(after.queueRev, next.queueRev + 1)
  assert.equal(after.loveRev, next.loveRev + 1)
  next = after
  state.update({ listId: 'love' })
  assert.equal(state.read().queueRev, next.queueRev + 1, 'another list is playing')
  state.update({ playLaterCount: 2 })
  assert.equal(state.read().queueRev, next.queueRev + 2)
})

// ---------- 问渲染进程 ----------

const manualTimers = () => {
  const timers = new Map()
  let id = 0
  return {
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id },
    clearTimeout: handle => { timers.delete(handle) },
    fire: () => { for (const [key, timer] of [...timers]) { timers.delete(key); timer.fn() } },
    size: () => timers.size,
  }
}

test('renderer rpc: answers matched by key, failures and timeouts reject', async() => {
  const timers = manualTimers()
  const sent = []
  const rpc = createRendererRpc({ send: request => { sent.push(request); return true }, ...timers })
  const first = rpc.request('search', { text: 'a' })
  const second = rpc.request('lyric', {})
  assert.equal(sent.length, 2)
  assert.notEqual(sent[0].requestKey, sent[1].requestKey)
  rpc.handleResponse({ requestKey: sent[1].requestKey, ok: false, error: { code: 'not-found', message: 'nope' } })
  rpc.handleResponse({ requestKey: sent[0].requestKey, ok: true, data: { list: [1] } })
  rpc.handleResponse({ requestKey: 'unknown', ok: true })
  assert.deepEqual(await first, { list: [1] })
  await assert.rejects(second, err => err.code == 'not-found' && err.message == 'nope')
  assert.equal(timers.size(), 0)
  const late = rpc.request('play', {})
  timers.fire()
  await assert.rejects(late, err => err.code == 'timeout')
  assert.equal(rpc.pendingCount(), 0)
})

test('renderer rpc: no window, or the link closes', async() => {
  const timers = manualTimers()
  const offline = createRendererRpc({ send: () => false, ...timers })
  await assert.rejects(offline.request('search', {}), err => err.code == 'unavailable')
  const rpc = createRendererRpc({ send: () => true, ...timers })
  const pending = rpc.request('search', {})
  rpc.cancelAll('closed')
  await assert.rejects(pending, err => err.code == 'unavailable')
  assert.equal(timers.size(), 0)
})

// ---------- HTTP 服务 ----------

const call = (port, { method = 'GET', pathname, token, body, headers = {} }) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : Buffer.from(typeof body == 'string' ? body : JSON.stringify(body))
  const req = http.request({
    host: '127.0.0.1',
    port,
    method,
    path: pathname,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      ...headers,
    },
  }, res => {
    const chunks = []
    res.on('data', chunk => chunks.push(chunk))
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8')
      let json = null
      try { json = JSON.parse(text) } catch {}
      resolve({ status: res.statusCode, json })
    })
  })
  req.on('error', reject)
  if (data) req.write(data)
  req.end()
})

const startServer = async(overrides = {}) => {
  const calls = []
  const server = createLinkServer({
    token: 'secret-token',
    getState: () => ({ musicId: 'kw_1' }),
    handleRpc: async(op, params) => {
      calls.push({ op, params })
      if (op == 'boom') throw new Error('kaput')
      if (op == 'bad') throw new LinkError('invalid-params', 'bad params')
      return { echo: params }
    },
    log: () => {},
    now: () => Date.now(),
    ...overrides,
  })
  const port = await server.start()
  return { server, port, calls }
}

test('server: token required, browsers and foreign hosts refused', async() => {
  const { server, port } = await startServer()
  try {
    assert.equal((await call(port, { pathname: '/status' })).status, 401)
    assert.equal((await call(port, { pathname: '/status', token: 'wrong-token!' })).status, 401)
    assert.equal((await call(port, { pathname: '/status', token: 'secret-token', headers: { Origin: 'https://evil.example' } })).status, 403)
    assert.equal((await call(port, { pathname: '/status', token: 'secret-token', headers: { Host: 'evil.example' } })).status, 403)
    assert.equal(server.isClientActive(), false)
    const ok = await call(port, { pathname: '/status', token: 'secret-token' })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.json, { ok: true, data: { musicId: 'kw_1' } })
    assert.equal(server.isClientActive(), true)
  } finally {
    await server.stop()
  }
})

test('server: rpc answers, errors become status codes', async() => {
  const { server, port, calls } = await startServer()
  try {
    const ok = await call(port, { method: 'POST', pathname: '/rpc', token: 'secret-token', body: { op: 'search', params: { text: 'a' } } })
    assert.deepEqual(ok.json, { ok: true, data: { echo: { text: 'a' } } })
    assert.deepEqual(calls[0], { op: 'search', params: { text: 'a' } })
    const bad = await call(port, { method: 'POST', pathname: '/rpc', token: 'secret-token', body: { op: 'bad' } })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'invalid-params')
    const boom = await call(port, { method: 'POST', pathname: '/rpc', token: 'secret-token', body: { op: 'boom' } })
    assert.equal(boom.status, 500)
    assert.equal(boom.json.error.code, 'failed')
    const notJson = await call(port, { method: 'POST', pathname: '/rpc', token: 'secret-token', body: '{nope' })
    assert.equal(notJson.status, 400)
    assert.equal((await call(port, { pathname: '/nope', token: 'secret-token' })).status, 404)
  } finally {
    await server.stop()
  }
})

test('server: event stream starts with the state and carries broadcasts', async() => {
  const { server, port } = await startServer()
  try {
    const events = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/events', headers: { Authorization: 'Bearer secret-token' } }, res => {
        assert.equal(res.statusCode, 200)
        let text = ''
        res.on('data', chunk => {
          text += chunk.toString('utf-8')
          if (text.includes('event: state') && !text.includes('event: lists')) server.broadcast('lists', { listsRev: 3 })
          if (text.includes('event: lists')) {
            req.destroy()
            resolve(text)
          }
        })
      })
      req.on('error', err => { if (err.code != 'ECONNRESET') reject(err) })
      req.end()
    })
    assert.match(events, /event: state\ndata: \{"musicId":"kw_1"\}/)
    assert.match(events, /event: lists\ndata: \{"listsRev":3\}/)
  } finally {
    await server.stop()
  }
})
