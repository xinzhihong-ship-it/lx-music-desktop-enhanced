import { createHash, randomBytes, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { httpFetch } from '@main/utils/request'

const APP_ID = 1005
const QR_APP_ID = 1014
const SRC_APP_ID = 2919
const CLIENT_VERSION = 20489
const WEB_KEY = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
const ANDROID_KEY = 'OIlwieks28dk2k092lksi2UIkp'
const USER_AGENT = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi'

interface PendingQrLogin {
  key: string
  mid: string
  dfid: string
}

const pendingQrLogins = new Map<string, PendingQrLogin>()

const randomHex = (length: number) => randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)

const signature = (params: Record<string, unknown>, key: string, data = '') => {
  const values = Object.keys(params).sort().map(name => `${name}=${String(params[name])}`).join('')
  return createHash('md5').update(`${key}${values}${data}${key}`).digest('hex')
}

const buildUrl = (baseUrl: string, params: Record<string, unknown>, key: string, data = '') => {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) query.set(name, String(value))
  query.set('signature', signature(params, key, data))
  return `${baseUrl}?${query.toString()}`
}

const commonParams = (session?: LX.Account.LoginSession) => ({
  dfid: session?.cookies.dfid ?? '-',
  mid: session?.cookies.KUGOU_API_MID ?? session?.cookies.mid ?? randomHex(32),
  uuid: '-',
  appid: APP_ID,
  clientver: CLIENT_VERSION,
  clienttime: Math.floor(Date.now() / 1000),
})

const commonHeaders = (params: { dfid: string, mid: string, clienttime: number, [key: string]: unknown }) => ({
  'User-Agent': USER_AGENT,
  dfid: params.dfid,
  mid: params.mid,
  clienttime: String(params.clienttime),
  'kg-rc': '1',
  'kg-thash': '5d816a0',
  'kg-rec': '1',
  'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
})

const parseCookieString = (value: string) => {
  const cookies: Record<string, string> = {}
  for (const part of value.split(';')) {
    const [rawKey, ...parts] = part.trim().split('=')
    if (rawKey && parts.length) cookies[rawKey] = parts.join('=')
  }
  return cookies
}

const buildLoginResult = (userid: string, token: string, cookies: Record<string, string>, nickname?: string) => ({
  account: {
    id: `kg_${userid}`,
    source: 'kg' as const,
    nickname: nickname?.trim() ? nickname : `酷狗用户 ${userid}`,
    isLogin: true,
  },
  session: {
    source: 'kg' as const,
    cookies: { ...cookies, userid, token },
    tokens: { userId: userid, token },
  },
})

export const loginByCookie = async(cookie: string) => {
  const cookies = parseCookieString(cookie)
  const userid = cookies.userid ?? cookies.KugooID ?? ''
  const token = cookies.token ?? cookies.t ?? ''
  if (!userid || !token) throw new Error('Cookie 中缺少 userid 或 token')
  const result = buildLoginResult(userid, token, cookies, cookies.nickname)
  await getUserPlaylists(result.session)
  return result
}

export const createQrCode = async(): Promise<LX.Account.QrCodeLoginState> => {
  const mid = randomHex(32)
  const dfid = randomHex(16)
  const params = {
    dfid,
    mid,
    uuid: '-',
    appid: QR_APP_ID,
    clientver: CLIENT_VERSION,
    clienttime: Math.floor(Date.now() / 1000),
    type: 1,
    plat: 4,
    qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${APP_ID}&`,
    srcappid: SRC_APP_ID,
  }
  const response = await httpFetch<{ status: number, error?: string, data?: { qrcode?: string } }>(
    buildUrl('https://login-user.kugou.com/v2/qrcode', params, WEB_KEY),
    { method: 'GET', headers: commonHeaders({ ...params, appid: APP_ID, plat: 1 }) },
  )
  const key = response.body.data?.qrcode
  if (response.statusCode !== 200 || response.body.status !== 1 || !key) {
    throw new Error(response.body.error || '获取酷狗二维码失败')
  }
  const requestId = randomUUID()
  pendingQrLogins.set(requestId, { key, mid, dfid })
  setTimeout(() => pendingQrLogins.delete(requestId), 10 * 60 * 1000).unref()
  const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`
  return { key: requestId, qrUrl: await QRCode.toDataURL(url, { width: 220, margin: 2 }), status: 'waiting' }
}

export const checkQrCodeStatus = async(requestId: string): Promise<LX.Account.QrCodeLoginResult & { session?: LX.Account.LoginSession }> => {
  const pending = pendingQrLogins.get(requestId)
  if (!pending) return { key: requestId, qrUrl: '', status: 'expired' }
  const params = {
    dfid: pending.dfid,
    mid: pending.mid,
    uuid: '-',
    appid: APP_ID,
    clientver: CLIENT_VERSION,
    clienttime: Math.floor(Date.now() / 1000),
    plat: 4,
    srcappid: SRC_APP_ID,
    qrcode: pending.key,
  }
  const response = await httpFetch<{ status: number, error?: string, data?: Record<string, unknown> }>(
    buildUrl('https://login-user.kugou.com/v2/get_userinfo_qrcode', params, WEB_KEY),
    { method: 'GET', headers: commonHeaders({ ...params, plat: 1 }) },
  )
  const data = response.body.data ?? {}
  const code = Number(data.status ?? response.body.status)
  const statusMap: Record<number, LX.Account.QrCodeLoginState['status']> = { 0: 'expired', 1: 'waiting', 2: 'scanned', 4: 'confirmed' }
  const status = statusMap[code] ?? 'failed'
  if (status !== 'confirmed') {
    if (status === 'expired' || status === 'failed') pendingQrLogins.delete(requestId)
    return { key: requestId, qrUrl: '', status, message: response.body.error }
  }
  const userid = String(data.userid ?? '')
  const token = String(data.token ?? '')
  if (!userid || !token) return { key: requestId, qrUrl: '', status: 'failed', message: '登录成功但未获取到凭证' }
  pendingQrLogins.delete(requestId)
  const result = buildLoginResult(userid, token, {
    userid,
    token,
    KUGOU_API_MID: pending.mid,
    mid: pending.mid,
    dfid: pending.dfid,
  }, String(data.nickname ?? data.username ?? ''))
  return { key: requestId, qrUrl: '', status: 'confirmed', ...result }
}

const requireSession = (session: LX.Account.LoginSession | null) => {
  if (!session || session.source !== 'kg') throw new Error('酷狗登录状态不存在或已失效')
  return session
}

export const getUserPlaylists = async(sessionValue: LX.Account.LoginSession | null): Promise<LX.Account.PlaylistInfo[]> => {
  const session = requireSession(sessionValue)
  const userid = session.tokens.userId
  const token = session.tokens.token
  const params = { ...commonParams(session), plat: 1, userid, token }
  const body = JSON.stringify({ userid, token, total_ver: 979, type: 2, page: 1, pagesize: 1000 })
  const response = await httpFetch<any>(buildUrl('https://gateway.kugou.com/v7/get_all_list', params, ANDROID_KEY, body), {
    method: 'POST',
    headers: { ...commonHeaders(params), 'Content-Type': 'application/json', 'x-router': 'cloudlist.service.kugou.com' },
    text: body,
  })
  if (response.statusCode !== 200 || response.body?.status !== 1) throw new Error(response.body?.error || response.body?.msg || '获取酷狗歌单失败')
  const list = response.body.data?.info ?? response.body.data?.list ?? response.body.info ?? []
  return list.map((item: any) => ({
    id: String(item.global_collection_id ?? item.listid ?? item.specialid ?? ''),
    name: item.listname ?? item.specialname ?? item.name ?? '',
    author: item.list_create_username ?? item.nickname ?? item.username ?? '',
    play_count: String(item.playcount ?? item.total_play_count ?? 0),
    img: item.pic ?? item.img ?? item.imgurl ?? '',
    desc: item.intro ?? null,
    source: 'kg' as const,
    total: String(item.count ?? item.m_count ?? item.songcount ?? item.trackcount ?? 0),
    dirId: String(item.listid ?? ''),
    isEditable: Boolean(item.listid),
  })).filter((item: LX.Account.PlaylistInfo) => item.id)
}

export const getPlaylistTrackIds = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  dirId?: string,
): Promise<LX.Account.PlaylistTrackInfo[]> => {
  const session = requireSession(sessionValue)
  const pageSize = 300
  const tracks: LX.Account.PlaylistTrackInfo[] = []
  let beginIndex = 0

  while (true) {
    const params = {
      ...commonParams(session),
      token: session.tokens.token,
      userid: session.tokens.userId,
      area_code: 1,
      begin_idx: beginIndex,
      plat: 1,
      type: 1,
      mode: 1,
      personal_switch: 1,
      extend_fields: 'abtags,hot_cmt,popularization',
      pagesize: pageSize,
      global_collection_id: playlistId,
    }
    const response = await httpFetch<any>(buildUrl('https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt', params, ANDROID_KEY), {
      method: 'GET',
      headers: commonHeaders(params),
    })
    if (response.statusCode !== 200 || response.body?.status !== 1) {
      throw new Error(response.body?.error || response.body?.errmsg || response.body?.msg || '获取酷狗歌单歌曲失败')
    }
    const songs = response.body.data?.songs ?? []
    tracks.push(...songs.map((song: any) => ({
      id: String(song.hash ?? song.audio_info?.hash ?? ''),
      removeId: String(song.fileid ?? song.audio_id ?? song.audio_info?.audio_id ?? ''),
    })).filter((track: LX.Account.PlaylistTrackInfo) => track.id))
    const total = Number(response.body.data?.count) || 0
    if (!songs.length || songs.length < pageSize || (total > 0 && tracks.length >= total)) break
    beginIndex += songs.length
  }

  return [...new Map(tracks.map(track => [track.id, track])).values()]
}

const requestPlaylistMutation = async(
  session: LX.Account.LoginSession,
  endpoint: string,
  bodyData: Record<string, unknown>,
  extraParams: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) => {
  const params = {
    ...commonParams(session),
    userid: session.tokens.userId,
    token: session.tokens.token,
    ...extraParams,
  }
  const body = JSON.stringify(bodyData)
  const response = await httpFetch<any>(buildUrl(endpoint, params, ANDROID_KEY, body), {
    method: 'POST',
    headers: { ...commonHeaders(params), 'Content-Type': 'application/json', ...headers },
    text: body,
  })
  if (response.statusCode !== 200 || response.body?.status === 0 || Number(response.body?.error_code ?? 0) !== 0) {
    throw new Error(response.body?.error || response.body?.errmsg || response.body?.msg || '酷狗歌单操作失败')
  }
}

export const addPlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  _playlistId: string,
  dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const session = requireSession(sessionValue)
  if (!dirId) throw new Error('酷狗歌单缺少列表 ID')
  const data = tracks.map(track => ({
    number: 1,
    name: track.name,
    hash: track.hash ?? '',
    size: 0,
    sort: 0,
    timelen: 0,
    bitrate: 0,
    album_id: Number(track.albumId) || 0,
    mixsongid: Number(track.songId) || 0,
  }))
  if (data.some(track => !track.hash)) throw new Error('部分歌曲缺少酷狗歌曲 Hash')
  const now = Math.floor(Date.now() / 1000)
  await requestPlaylistMutation(session, 'https://gateway.kugou.com/cloudlist.service/v6/add_song', {
    userid: session.tokens.userId,
    token: session.tokens.token,
    listid: dirId,
    list_ver: 0,
    type: 0,
    slow_upload: 1,
    scene: 'false;null',
    data,
  }, { last_time: now, last_area: 'gztx' })
}

export const removePlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  _playlistId: string,
  dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const session = requireSession(sessionValue)
  if (!dirId) throw new Error('酷狗歌单缺少列表 ID')
  const ids = tracks.map(track => track.platformId).filter((id): id is string => Boolean(id))
  if (ids.length !== tracks.length) throw new Error('部分歌曲缺少酷狗歌单条目 ID')
  await requestPlaylistMutation(session, 'https://gateway.kugou.com/v4/delete_songs', {
    listid: dirId,
    userid: session.tokens.userId,
    data: ids.map(fileid => ({ fileid: Number(fileid) })),
    type: 0,
    token: session.tokens.token,
    list_ver: 0,
  }, {}, { 'x-router': 'cloudlist.service.kugou.com' })
}

export const getDailyTrackIds = async(sessionValue: LX.Account.LoginSession | null): Promise<string[]> => {
  const session = requireSession(sessionValue)
  const params = {
    ...commonParams(session),
    token: session.tokens.token,
    userid: session.tokens.userId,
    platform: 'ios',
  }
  const response = await httpFetch<any>(buildUrl('https://gateway.kugou.com/everyday_song_recommend', params, ANDROID_KEY), {
    method: 'POST',
    headers: { ...commonHeaders(params), 'x-router': 'everydayrec.service.kugou.com' },
  })
  if (response.statusCode !== 200 || response.body?.status !== 1) throw new Error(response.body?.error || response.body?.msg || '获取酷狗每日推荐失败')
  const songs = response.body.data?.song_list ?? response.body.data?.info ?? response.body.info ?? response.body.data?.list ?? []
  return songs.map((song: any) => String(song.hash ?? '')).filter(Boolean)
}
