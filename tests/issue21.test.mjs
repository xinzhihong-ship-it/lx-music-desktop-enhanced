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
 * 现在两条路都走：现代接口优先，失败再回退老接口，并且各用各的正确标识符。
 */

const state = globalThis.__issue21 = {
  requests: [],
  modernResult: null, // 覆盖现代接口响应；null 表示成功
  legacyResult: null, // 覆盖老接口响应；null 表示成功
  loginCookies: null, // 覆盖 QQ 登录窗口返回的 cookies
}

const virtualModules = new Map([
  ['@main/utils/request', `
    export const httpFetch = async (url, options) => {
      const entry = { url: String(url), options }
      globalThis.__issue21.requests.push(entry)
      if (entry.url.includes('musicu.fcg')) {
        return globalThis.__issue21.modernResult
          ?? { statusCode: 200, body: { code: 0, req_0: { code: 0, data: {} } } }
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

const { addPlaylistTracks } = await import('../src/main/modules/account/providers/tx.ts')

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
}

const modernRequest = () => state.requests.find(r => r.url.includes('musicu.fcg'))
const legacyRequest = () => state.requests.find(r => r.url.includes('fcg_music_add2songdir'))

test('优先使用现代接口，并用数字 songId 组装 v_songInfo', async() => {
  reset()
  await addPlaylistTracks(makeSession(), 'p1', '201', [
    makeTrack(1234567, '0039MnYb0qxYhV'),
    makeTrack(7654321, '004Zb7Tt2vGaCC'),
  ])

  const req = modernRequest()
  assert.ok(req, '应当调用现代 musicu 接口')

  const body = req.options.json
  assert.equal(body.req_0.module, 'music.musicasset.PlaylistDetailWrite')
  assert.equal(body.req_0.method, 'AddSonglist')
  assert.equal(body.req_0.param.dirId, 201, 'dirId 必须是数字')
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

  await addPlaylistTracks(makeSession(), 'p1', '201', [
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

test('两条路都失败时，错误信息同时说明两端原因', async() => {
  reset()
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: -1, message: 'modern bad' } } }
  state.legacyResult = { statusCode: 200, body: { code: -1, msg: 'invalid request' } }

  await assert.rejects(
    () => addPlaylistTracks(makeSession(), 'p1', '201', [makeTrack(1234567, '0039MnYb0qxYhV')]),
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
    () => addPlaylistTracks(makeSession(), 'p1', '5', [makeTrack(1234567, undefined)]),
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
  } finally {
    hooks?.deregister?.()
  }
})

test('扫码登录缺少网页凭证时，错误信息给出可执行的解决建议', async() => {
  reset()
  state.modernResult = { statusCode: 200, body: { code: 0, req_0: { code: 1000 } } }
  state.legacyResult = { statusCode: 200, body: { code: 403, msg: 'invalid request', title: 'no permit' } }

  await assert.rejects(
    () => addPlaylistTracks(makeSession(false), 'p1', '6', [makeTrack(1234567, 'AAA111')]),
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
    () => addPlaylistTracks(makeSession(true), 'p1', '6', [makeTrack(1234567, 'AAA111')]),
    (err) => {
      assert.ok(!err.message.includes('没有网页版 skey/p_skey'), '有凭证时不应提扫码登录问题')
      return true
    },
  )
})
