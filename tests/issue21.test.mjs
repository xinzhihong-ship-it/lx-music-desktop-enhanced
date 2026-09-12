import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

/**
 * Issue #21 回归测试：QQ 音乐歌单加歌失败（"invalid request"）。
 *
 * QQ 音乐有两套加歌接口，而且标识符要求相反：
 *   现代 musicu 接口  music.musicasset.PlaylistDetailWrite / AddSonglist
 *                     → 要【数字 songId】
 *   老版 CGI 接口      splcloud/fcgi-bin/fcg_music_add2songdir.fcg
 *                     → 要【字符串 mid】(midlist)
 *
 * 原实现把数字 songId 塞进了老接口的 midlist，服务端直接回 "invalid request"。
 * 现在现代接口优先；只有明确失败且具备网页凭证时才回退老接口，并且各用各的正确标识符。
 */

const state = globalThis.__issue21 = {
  requests: [],
  modernResult: null, // 覆盖现代接口响应；null 表示成功
  legacyResult: null, // 覆盖老接口响应；null 表示成功
  playlistResult: null, // 覆盖写入后重新读取歌单的歌曲
  playlistPages: null, // 覆盖分页读取结果
  loginExchangeResult: null, // 覆盖扫码二次换票响应
  mqttHandlers: null,
  loginCookies: null, // 覆盖 QQ 登录窗口返回的 cookies
}

const virtualModules = new Map([
  ['@main/utils/request', `
    export const httpFetch = async (url, options) => {
      const entry = { url: String(url), options }
      globalThis.__issue21.requests.push(entry)
      if (entry.url.includes('musics.fcg')) {
        if (entry.options?.text) {
          try { entry.body = JSON.parse(entry.options.text) } catch {}
        }
        if (entry.body?.req_0?.method === 'CreateQRCode') {
          return {
            statusCode: 200,
            body: {
              code: 0,
              req_0: {
                code: 0,
                data: { qrcodeID: 'test-qrcode', qrcode: 'data:image/png;base64,AA==', expiresIn: 60 },
              },
            },
          }
        }
        return globalThis.__issue21.loginExchangeResult
          ?? { statusCode: 200, body: { code: 0, req_0: { code: 0, data: { musicid: '12345', musickey: 'MKEY' } } } }
      }
      if (entry.url.includes('musicu.fcg')) {
        const method = entry.options?.json?.req_0?.method
        if (method === 'CreateQRCode') {
          return {
            statusCode: 200,
            body: {
              code: 0,
              req_0: {
                code: 0,
                data: { qrcodeID: 'test-qrcode', qrcode: 'data:image/png;base64,AA==', expiresIn: 60 },
              },
            },
          }
        }
        if (method === 'Login') {
          return globalThis.__issue21.loginExchangeResult
            ?? { statusCode: 200, body: { code: 0, req_0: { code: 0, data: { musicid: '12345', musickey: 'MKEY' } } } }
        }
        if (method === 'CgiGetDiss') {
          const songBegin = Number(entry.options?.json?.req_0?.param?.song_begin ?? 0)
          const page = globalThis.__issue21.playlistPages
            ? (globalThis.__issue21.playlistPages[Math.floor(songBegin / 500)] ?? [])
            : globalThis.__issue21.playlistResult
          return {
            statusCode: 200,
            body: {
              code: 0,
              req_0: {
                code: 0,
                data: {
                  songlist: page ?? [
                    { mid: '0039MnYb0qxYhV', id: 1234567, title: 'song-1234567' },
                    { mid: '004Zb7Tt2vGaCC', id: 7654321, title: 'song-7654321' },
                  ],
                  ...(globalThis.__issue21.playlistPages ? {} : { hasmore: 0, total_song_num: 2 }),
                },
              },
            },
          }
        }
        return globalThis.__issue21.modernResult
          ?? { statusCode: 200, body: { code: 0, req_0: { code: 0, data: { retCode: 0 } } } }
      }
      return globalThis.__issue21.legacyResult ?? { statusCode: 200, body: { code: 0 } }
    }
  `],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const virtual = virtualModules.get(specifier)
    if (virtual != null) {
      return { url: `data:text/javascript,${encodeURIComponent(virtual)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

virtualModules.set('mqtt', `
  export const connect = () => {
    const handlers = {}
    const client = {
      on(name, callback) {
        ;(handlers[name] ??= []).push(callback)
        if (name === 'connect') queueMicrotask(() => callback())
        return client
      },
      once(name, callback) {
        return client.on(name, callback)
      },
      subscribe(_topic, _options, callback) {
        queueMicrotask(() => callback?.(null))
        return client
      },
      end() {},
    }
    globalThis.__issue21.mqttHandlers = handlers
    return client
  }
`)

const { addPlaylistTracks, removePlaylistTracks, getPlaylistTrackIds, createQrCode, checkQrCodeStatus } = await import('../src/main/modules/account/providers/tx.ts')

const makeSession = (withWebKey = true) => ({
  id: 'tx_12345',
  source: 'tx',
  account: { id: 'tx_12345', source: 'tx', nickname: 'test', isLogin: true },
  // getGtk 优先读 p_skey/skey，这里给 skey 保证 g_tk 可算
  cookies: withWebKey
    ? { skey: 'SKEY', qqmusic_key: 'MKEY', uin: '12345' }
    : { qqmusic_key: 'MKEY', qqmusic_uin: '12345' },
  tokens: { uin: '12345', musicKey: 'MKEY' },
})

const makeTrack = (songId, songMid) => ({
  source: 'tx',
  songId: String(songId),
  songMid,
  platformId: String(songId),
  name: `song-${songId}`,
})

const reset = () => {
  state.requests.length = 0
  state.modernResult = null
  state.legacyResult = null
  state.playlistResult = null
  state.playlistPages = null
  state.loginExchangeResult = null
  state.mqttHandlers = null
}

const modernRequest = () => state.requests.find(r => r.url.includes('musicu.fcg'))
const legacyRequest = () => state.requests.find(r => r.url.includes('fcg_music_add2songdir'))

test('优先使用现代接口，并用数字 songId 组装 v_songInfo', async() => {
  reset()
  await addPlaylistTracks(makeSession(), '101', '201', [
    makeTrack(1234567, '0039MnYb0qxYhV'),
    makeTrack(7654321, '004Zb7Tt2vGaCC'),
  ])

  const req = modernRequest()
  assert.ok(req, '应当调用现代 musicu 接口')

  const body = req.options.json
  assert.equal(body.req_0.module, 'music.musicasset.PlaylistDetailWrite')
  assert.equal(body.req_0.method, 'AddSonglist')
  assert.equal(body.req_0.param.dirId, 201, 'dirId 必须是数字')
  assert.equal(body.req_0.param.tid, 101, 'tid 必须是数字')
  assert.equal(body.req_0.param.bFmtUtf8, true, '写接口必须声明 UTF-8')
  assert.deepEqual(
    body.req_0.param.v_songInfo,
    [{ songId: 1234567, songType: 0 }, { songId: 7654321, songType: 0 }],
    '现代接口要数字 songId',
  )

  assert.equal(legacyRequest(), undefined, '现代接口成功时不应再走老接口')
})

test('现代接口失败时回退老接口，且 midlist 必须是字符串 MID', async() => {
  reset()
  // 现代接口返回业务失败
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: -1, message: 'boom' } } }

  await addPlaylistTracks(makeSession(), '101', '201', [
    makeTrack(1234567, '0039MnYb0qxYhV'),
    makeTrack(7654321, '004Zb7Tt2vGaCC'),
  ])

  const req = legacyRequest()
  assert.ok(req, '现代接口失败后应回退到老接口')

  const url = new URL(req.url)
  const form = req.options?.form || {}
  const getParam = (k) => form[k] ?? url.searchParams.get(k)
  const midlist = getParam('midlist')
  assert.equal(midlist, '0039MnYb0qxYhV,004Zb7Tt2vGaCC', 'midlist 必须是歌曲 MID')
  assert.ok(!midlist.includes('1234567'), 'midlist 绝不能是数字 songId')
  assert.equal(getParam('dirid'), '201')

  // 老版 CGI 必须带完整上下文参数，否则服务端直接回 "invalid request"
  for (const key of ['loginUin', 'uin', 'hostUin', 'format', 'inCharset', 'outCharset', 'notice', 'platform', 'needNewCode', 'g_tk']) {
    assert.ok(getParam(key) != null, `老接口缺少必需上下文参数：${key}`)
  }
  assert.equal(getParam('loginUin'), '12345')
  assert.equal(getParam('uin'), '12345')
})

test('现代接口返回业务 retCode 失败时，才允许使用有网页凭证的兼容接口', async() => {
  reset()
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: 0, data: { retCode: 80092 } } } }

  await addPlaylistTracks(makeSession(), '101', '201', [makeTrack(1234567, '0039MnYb0qxYhV')])
  assert.ok(legacyRequest(), '现代业务失败后应回退兼容接口')
})

test('两条路都失败时，错误信息同时说明两端原因', async() => {
  reset()
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: -1, message: 'modern bad' } } }
  state.legacyResult = { statusCode: 200, body: { code: -1, msg: 'invalid request' } }

  await assert.rejects(
    () => addPlaylistTracks(makeSession(), '101', '201', [makeTrack(1234567, '0039MnYb0qxYhV')]),
    (err) => {
      assert.match(err.message, /现代接口/, '应包含现代接口失败原因')
      assert.match(err.message, /兼容接口/, '应包含兼容接口失败原因')
      assert.match(err.message, /invalid request/, '应保留服务端原始错误')
      return true
    },
  )
})

test('缺少 MID 时，数字 songId 不会被当成 mid 发出去', async() => {
  reset()
  // 只有 songId，没有 songMid；同时让现代接口失败，逼出老接口路径
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: -1, message: 'boom' } } }

  await assert.rejects(
    () => addPlaylistTracks(makeSession(), '101', '5', [makeTrack(1234567, undefined)]),
    /缺少歌曲 MID/,
  )
  assert.equal(legacyRequest(), undefined, '缺少 MID 时不应发出老接口请求')
})

test('缺少 dirId 时明确报错', async() => {
  reset()
  await assert.rejects(
    () => addPlaylistTracks(makeSession(), 'p1', undefined, [makeTrack(1, 'AAA')]),
    /缺少目录 ID/,
  )
  assert.equal(state.requests.length, 0, '参数不完整时不应发出任何请求')
})

test('渲染层映射：QQ 音乐歌曲必须带出 songMid', async() => {
  const virtualStore = new Map([
    ['@common/utils/vueTools', 'export const ref = v => ({ value: v }); export const computed = f => ({ get value() { return f() } }); export const watch = () => {}'],
    ['@renderer/utils/ipc', 'export const getAccounts = async () => []; export const addAccountPlaylistTracks = async () => {}; export const removeAccountPlaylistTracks = async () => {}; export const getAccountPlaylists = async () => []; export const removeAccount = async () => {}'],
    ['@renderer/utils/musicSdk/bili/util', 'export const clearAccountCookieCache = () => {}'],
  ])

  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const virtual = virtualStore.get(specifier)
      if (virtual != null) {
        return { url: `data:text/javascript,${encodeURIComponent(virtual)}`, shortCircuit: true }
      }
      return nextResolve(specifier, context)
    },
  })

  try {
    const mod = await import(`../src/renderer/store/account.ts?issue21=${Date.now()}`)
    const track = mod.toPlaylistMutationTrack({
      id: 'x',
      source: 'tx',
      name: '测试歌曲',
      singer: '歌手',
      interval: '03:00',
      meta: {
        songId: 1234567,
        songmid: '0039MnYb0qxYhV',
        id: 1234567,
        strMediaMid: '0039MnYb0qxYhV',
        albumId: 99,
        qualitys: [],
        _qualitys: {},
      },
    })

    assert.equal(track.songId, '1234567', 'songId 保留数字 ID')
    assert.equal(track.songMid, '0039MnYb0qxYhV', 'songMid 必须带出，供老接口 midlist 使用')
    assert.equal(track.platformId, '1234567', 'platformId 供现代接口与删除使用')

    const normalizedTrack = mod.toPlaylistMutationTrack({
      id: 'tx_0039MnYb0qxYhV',
      source: 'tx',
      name: '测试歌曲',
      singer: '歌手',
      interval: '03:00',
      meta: {
        songId: '0039MnYb0qxYhV',
        id: 1234567,
        strMediaMid: '0039MnYb0qxYhV_01',
        albumId: 99,
        qualitys: [],
        _qualitys: {},
      },
    })
    assert.equal(normalizedTrack.songId, '1234567', '新歌曲结构应从 meta.id 取数字 songId')
    assert.equal(normalizedTrack.songMid, '0039MnYb0qxYhV', '新歌曲结构应从 meta.songId 取 MID')
  } finally {
    hooks?.deregister?.()
  }
})

test('扫码登录缺少网页凭证时，错误信息给出可执行的解决建议', async() => {
  reset()
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: 1000 } } }
  state.legacyResult = { statusCode: 200, body: { code: 403, msg: 'invalid request', title: 'no permit' } }

  await assert.rejects(
    () => addPlaylistTracks(makeSession(false), '101', '6', [makeTrack(1234567, 'AAA111')]),
    (err) => {
      assert.match(err.message, /没有网页版 skey\/p_skey/, '应解释权限不足的原因')
      assert.match(err.message, /参数校验前/, '应说明是在参数校验前被鉴权拦下')
      assert.match(err.message, /添加账号/, '应给出可执行的解决入口')
      assert.match(err.message, /粘贴 Cookie 登录/, '应给出可执行的解决方式')
      return true
    },
  )
})

test('已有网页凭证时不应出现 Cookie 登录建议', async() => {
  reset()
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: 1000 } } }
  state.legacyResult = { statusCode: 200, body: { code: 403, msg: 'invalid request', title: 'no permit' } }

  await assert.rejects(
    () => addPlaylistTracks(makeSession(true), '101', '6', [makeTrack(1234567, 'AAA111')]),
    (err) => {
      assert.ok(!err.message.includes('没有网页版 skey/p_skey'), '有凭证时不应提扫码登录问题')
      return true
    },
  )
})

test('现代接口响应缺少 retCode 时不能当作成功，也不能用扫码令牌调用旧接口', async() => {
  reset()
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: 0, data: {} } } }
  state.playlistResult = []

  await assert.rejects(
    () => addPlaylistTracks(makeSession(false), '101', '201', [makeTrack(1234567, 'AAA111')]),
    /结果待确认/,
  )
  assert.equal(legacyRequest(), undefined, '没有网页版凭证时不能回退旧接口')
})

test('删除歌曲优先使用现代 DelSonglist，并在重新读取后确认结果', async() => {
  reset()
  state.playlistResult = []
  await removePlaylistTracks(makeSession(), '101', '201', [makeTrack(1234567, '0039MnYb0qxYhV')])

  const req = modernRequest()
  assert.ok(req, '应当调用现代 musicu 接口')
  assert.equal(req.options.json.req_0.method, 'DelSonglist')
  assert.equal(req.options.json.req_0.param.tid, 101)
  assert.equal(req.options.json.req_0.param.dirId, 201)
  assert.deepEqual(req.options.json.req_0.param.v_songInfo, [{ songId: 1234567, songType: 0 }])
  assert.equal(legacyRequest(), undefined, '现代删除成功时不应调用旧接口')
})

test('现代接口返回成功但歌单未核对到歌曲时不会盲目回退旧接口', async() => {
  reset()
  state.playlistResult = []

  await assert.rejects(
    () => addPlaylistTracks(makeSession(), '101', '201', [makeTrack(1234567, '0039MnYb0qxYhV')]),
    /结果待确认/,
  )
  assert.equal(legacyRequest(), undefined, '结果不明时不能重复提交旧接口')
})

test('QQ 歌单详情分页在缺少 total/hasmore 时仍能读取满页后的下一页，并保留详情', async() => {
  reset()
  const firstPage = Array.from({ length: 500 }, (_, index) => ({
    mid: `mid-${index}`,
    id: index + 1,
    title: `song-${index}`,
  }))
  state.playlistPages = [firstPage, [{ mid: 'mid-500', id: 501, title: 'song-500' }]]

  const tracks = await getPlaylistTrackIds(makeSession(), '101', '201')
  assert.equal(tracks.length, 501)
  assert.equal(tracks[0].id, 'mid-0')
  assert.equal(tracks[0].detail.songmid, 'mid-0')
  assert.equal(tracks.at(-1).id, 'mid-500')
  assert.equal(state.requests.filter(request => request.options?.json?.req_0?.method === 'CgiGetDiss').length, 2)
})

test('QQ 歌单重复分页会停止，不会因为 hasmore 缺失陷入循环', async() => {
  reset()
  const page = Array.from({ length: 500 }, (_, index) => ({
    mid: `same-${index}`,
    id: index + 1,
    title: `song-${index}`,
  }))
  state.playlistPages = [page, page]

  const tracks = await getPlaylistTrackIds(makeSession(), '101', '201')
  assert.equal(tracks.length, 500)
  assert.equal(state.requests.filter(request => request.options?.json?.req_0?.method === 'CgiGetDiss').length, 2)
})

test('请求使用会话中明确的 QQ 音乐登录类型', async() => {
  reset()
  const session = makeSession()
  session.tokens.loginType = '1'
  await getPlaylistTrackIds(session, '101', '201')
  const request = state.requests.find(item => item.options?.json?.req_0?.method === 'CgiGetDiss')
  assert.equal(request.options.json.comm.tmeLoginType, 1)
})

test('QQ 扫码二次换票失败时不会把临时令牌保存为成功登录', async() => {
  reset()
  state.loginExchangeResult = {
    statusCode: 200,
    body: { code: 0, req_0: { code: 1000, message: 'exchange failed' } },
  }

  const qr = await createQrCode('qq')
  const create = state.requests.find(request => request.url.includes('musics.fcg') && request.body?.req_0?.method === 'CreateQRCode')
  assert.ok(create, '创建二维码应调用签名网关')
  assert.match(create.url, /_webcgikey=CreateQRCode/)
  assert.equal(create.body.req_0.param.ct, 11)
  assert.equal(create.body.req_0.param.cv, 20030508)
  const messageHandler = state.mqttHandlers?.message?.[0]
  assert.ok(messageHandler, '应注册 QQ 扫码消息处理器')
  messageHandler(
    'management.qrcode_login/test-qrcode',
    Buffer.from(JSON.stringify({
      cookies: { qqmusic_key: 'temporary', qqmusic_uin: '12345', qrcode_id: 'qid' },
    })),
    { properties: { userProperties: { type: 'cookies' } } },
  )

  await new Promise(resolve => setTimeout(resolve, 10))
  const status = await checkQrCodeStatus(qr.key)
  assert.equal(status.status, 'failed')
  assert.match(status.message, /票据交换失败/)
  assert.equal(status.session, undefined, '换票失败时不能返回临时会话')
})

test('QQ 扫码换票使用官方签名网关，并保留 HTTP 200 下的业务码', async() => {
  reset()
  state.loginExchangeResult = {
    statusCode: 200,
    body: { code: 0, req_0: { code: 104400, data: { errMsg: '' } } },
  }

  const qr = await createQrCode('qq')
  const messageHandler = state.mqttHandlers?.message?.[0]
  assert.ok(messageHandler, '应注册 QQ 扫码消息处理器')
  messageHandler(
    'management.qrcode_login/test-qrcode',
    Buffer.from(JSON.stringify({
      cookies: { qqmusic_key: 'temporary', qqmusic_uin: '12345', qrcode_id: 'qid' },
    })),
    { properties: { userProperties: { type: 'cookies' } } },
  )

  await new Promise(resolve => setTimeout(resolve, 10))
  const exchange = state.requests.find(request => request.url.includes('musics.fcg') && request.body?.req_0?.method === 'Login')
  assert.ok(exchange, '换票应调用 u6 musics.fcg')
  assert.match(exchange.url, /_webcgikey=Login/)
  assert.match(exchange.url, /[?&]sign=zzc/)
  assert.equal(exchange.options.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(exchange.body.comm.ct, 11)
  assert.equal(exchange.body.comm.cv, 20030508)
  assert.equal(exchange.body.req_0.param.token, 'temporary')

  const status = await checkQrCodeStatus(qr.key)
  assert.equal(status.status, 'failed')
  assert.match(status.message, /业务码 104400/)
  assert.doesNotMatch(status.message, /HTTP 200$/)
  assert.equal(status.session, undefined, '换票失败时不能返回临时会话')
})
