import { randomUUID } from 'node:crypto'
import { connect, type MqttClient } from 'mqtt'
import { httpFetch } from '@main/utils/request'

const LOGIN_ENDPOINT = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const LOGIN_TME_APP_ID = 'qqmusic'
const LOGIN_CLIENT_TYPE = 19
const LOGIN_CLIENT_VERSION = 11060000
const LOGIN_MQTT_ENDPOINT = 'wss://mu.y.qq.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

interface PendingQrLogin {
  client: MqttClient | null
  status: LX.Account.QrCodeLoginState['status']
  cookies?: Record<string, string>
  message?: string
}

const pendingQrLogins = new Map<string, PendingQrLogin>()

const parseCookieString = (value: string) => {
  const cookies: Record<string, string> = {}
  for (const part of value.split(';')) {
    const [rawKey, ...parts] = part.trim().split('=')
    if (rawKey && parts.length) cookies[rawKey] = parts.join('=')
  }
  return cookies
}

const hash33 = (value: string, seed = 0) => {
  let hash = seed
  for (const char of value) hash += (hash << 5) + char.charCodeAt(0)
  return hash & 0x7fffffff
}

const getUin = (cookies: Record<string, string>) => String(
  cookies.qqmusic_uin ?? cookies.musicid ?? cookies.uin ?? cookies.p_uin ?? cookies.pt2gguin ?? '',
).replace(/^o/, '').replace(/\D/g, '')

const getMusicKey = (cookies: Record<string, string>) => cookies.qqmusic_key ?? cookies.qm_keyst ?? cookies.musickey ??
  cookies.psrf_musickey ?? cookies.p_skey ?? cookies.skey ?? ''

const buildLoginResult = (uin: string, musicKey: string, cookies: Record<string, string>, nickname?: string) => ({
  account: {
    id: `tx_${uin}`,
    source: 'tx' as const,
    nickname: nickname?.trim() ? nickname : `QQ用户 ${uin}`,
    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`,
    isLogin: true,
  },
  session: {
    source: 'tx' as const,
    cookies,
    tokens: { uin, musicKey },
  },
})

const commonHeaders = (session: LX.Account.LoginSession) => ({
  Cookie: Object.entries(session.cookies).map(([name, value]) => `${name}=${value}`).join('; '),
  'User-Agent': USER_AGENT,
  Referer: 'https://y.qq.com/portal/profile.html',
})

const getGtk = (session: LX.Account.LoginSession) => hash33(
  session.cookies.p_skey ?? session.cookies.skey ?? session.tokens.musicKey ?? '',
  5381,
)

const requestMusicU = async(session: LX.Account.LoginSession, module: string, method: string, param: Record<string, unknown>) => {
  const uin = session.tokens.uin
  const musicKey = session.tokens.musicKey
  const response = await httpFetch<any>(LOGIN_ENDPOINT, {
    method: 'POST',
    json: {
      comm: {
        ct: 11,
        cv: 14090008,
        v: 14090008,
        chid: '10003505',
        uid: uin,
        qq: uin,
        authst: musicKey,
        tmeAppID: LOGIN_TME_APP_ID,
        tmeLoginType: musicKey.startsWith('W_X') ? 1 : 2,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
      },
      req_0: { module, method, param },
    },
    headers: { ...commonHeaders(session), Origin: 'https://y.qq.com', 'Content-Type': 'application/json' },
  })
  const result = response.body?.req_0
  if (response.statusCode !== 200 || response.body?.code !== 0 || result?.code !== 0) {
    throw new Error(result?.message || result?.data?.msg || `QQ 音乐请求失败（${method}）`)
  }
  return result.data ?? {}
}

export const loginByCookie = async(cookie: string) => {
  const cookies = parseCookieString(cookie)
  const uin = getUin(cookies)
  const musicKey = getMusicKey(cookies)
  if (!uin || !musicKey) throw new Error('Cookie 中缺少 QQ 账号或音乐凭证')
  const result = buildLoginResult(uin, musicKey, cookies)
  const playlists = await getUserPlaylists(result.session)
  if (playlists[0]?.author) result.account.nickname = playlists[0].author
  return result
}

export const createQrCode = async(): Promise<LX.Account.QrCodeLoginState> => {
  const response = await requestLogin('CreateQRCode', {
    tmeAppID: LOGIN_TME_APP_ID,
    ct: LOGIN_CLIENT_TYPE,
    cv: LOGIN_CLIENT_VERSION,
  })
  const qrcodeID = String(response.qrcodeID ?? '')
  const qrUrl = String(response.qrcode ?? '')
  if (!qrcodeID || !qrUrl.startsWith('data:image/png;base64,')) throw new Error('获取 QQ 音乐二维码失败')

  const requestId = randomUUID()
  const pending: PendingQrLogin = { client: null, status: 'waiting' }
  pendingQrLogins.set(requestId, pending)
  try {
    pending.client = await connectQrMqtt(qrcodeID, pending)
  } catch (err) {
    pendingQrLogins.delete(requestId)
    throw err
  }
  const expiresIn = Number(response.expiresIn) || 900
  setTimeout(() => {
    if (pending.status === 'waiting' || pending.status === 'scanned') pending.status = 'expired'
    pending.client?.end(true)
  }, expiresIn * 1000).unref()
  return { key: requestId, qrUrl, status: 'waiting' }
}

const requestLogin = async(method: string, param: Record<string, unknown>) => {
  const response = await httpFetch<any>(LOGIN_ENDPOINT, {
    method: 'POST',
    json: {
      comm: {},
      req_0: { module: 'music.login.LoginServer', method, param },
    },
    headers: { Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/', 'User-Agent': USER_AGENT },
  })
  const result = response.body?.req_0
  if (response.statusCode !== 200 || response.body?.code !== 0 || result?.code !== 0) {
    throw new Error(result?.data?.errMsg || result?.message || `QQ 音乐登录请求失败（${method}）`)
  }
  return result.data ?? {}
}

const readUserProperty = (value: unknown, name: string) => {
  if (!value || typeof value !== 'object') return ''
  const property = (value as Record<string, unknown>)[name]
  return Array.isArray(property) ? String(property[0] ?? '') : String(property ?? '')
}

const parseMqttCookies = (value: unknown) => {
  if (!value || typeof value !== 'object') return {}
  const cookies: Record<string, string> = {}
  for (const [name, cookie] of Object.entries(value as Record<string, unknown>)) {
    const raw = cookie && typeof cookie === 'object' && 'value' in cookie
      ? (cookie as { value?: unknown }).value
      : cookie
    if (raw != null && String(raw)) cookies[name] = String(raw)
  }
  return cookies
}

const bindQrMqttEvents = (client: MqttClient, pending: PendingQrLogin) => {
  client.on('message', (_topic, message, packet) => {
    let payload: any
    try {
      payload = JSON.parse(message.toString('utf8'))
    } catch {
      return
    }
    const event = readUserProperty(packet.properties?.userProperties, 'type')
    if (event === 'scanned') {
      pending.status = 'scanned'
      return
    }
    if (event === 'cookies') {
      const cookies = parseMqttCookies(payload?.cookies)
      if (getUin(cookies) && getMusicKey(cookies)) {
        pending.cookies = cookies
        pending.status = 'confirmed'
      } else {
        pending.status = 'failed'
        pending.message = 'QQ 音乐登录成功，但未收到有效音乐凭证'
      }
      client.end(true)
      return
    }
    if (event === 'timeout') pending.status = 'expired'
    if (event === 'canceled' || event === 'loginFailed') pending.status = 'failed'
    if (pending.status === 'expired' || pending.status === 'failed') client.end(true)
  })
}

const connectQrMqtt = async(qrcodeID: string, pending: PendingQrLogin, serverReference = '', redirectCount = 0): Promise<MqttClient> => {
  const path = `/ws/handshake${serverReference ? `/${serverReference}` : ''}`
  const client = connect(`${LOGIN_MQTT_ENDPOINT}${path}`, {
    protocolVersion: 5,
    clean: true,
    keepalive: 45,
    reconnectPeriod: 0,
    connectTimeout: 15_000,
    clientId: `${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`,
    properties: {
      authenticationMethod: 'pass',
      userProperties: {
        tmeAppID: LOGIN_TME_APP_ID,
        business: 'management',
        hashTag: qrcodeID,
        clientTag: 'management.user',
        userID: qrcodeID,
      },
    },
    wsOptions: { headers: { Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/' } },
  })
  bindQrMqttEvents(client, pending)

  return new Promise((resolve, reject) => {
    let settled = false
    let redirect = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      client.end(true)
      reject(new Error('连接 QQ 音乐扫码服务超时'))
    }, 20_000)
    timer.unref()

    client.on('packetreceive', packet => {
      if (packet.cmd === 'connack') redirect = packet.properties?.serverReference ?? ''
    })
    client.once('connect', () => {
      client.subscribe(`management.qrcode_login/${qrcodeID}`, {
        qos: 0,
        properties: { userProperties: { authorization: 'tmelogin', pubsub: 'unicast' } },
      }, err => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) {
          client.end(true)
          reject(new Error(`订阅 QQ 音乐扫码状态失败：${err.message}`))
        } else {
          resolve(client)
        }
      })
    })
    client.on('error', err => {
      if (settled) {
        if (pending.status === 'waiting' || pending.status === 'scanned') {
          pending.status = 'failed'
          pending.message = `QQ 音乐扫码连接异常：${err.message}`
        }
        return
      }
      settled = true
      clearTimeout(timer)
      client.end(true)
      const code = (err as Error & { code?: number }).code
      if ((code === 156 || code === 157) && redirect && redirectCount < 3) {
        void connectQrMqtt(qrcodeID, pending, redirect, redirectCount + 1).then(resolve, reject)
      } else {
        reject(new Error(`连接 QQ 音乐扫码服务失败：${err.message}`))
      }
    })
  })
}

export const checkQrCodeStatus = async(requestId: string): Promise<LX.Account.QrCodeLoginResult & { session?: LX.Account.LoginSession }> => {
  const pending = pendingQrLogins.get(requestId)
  if (!pending) return { key: requestId, qrUrl: '', status: 'expired' }
  if (pending.status !== 'confirmed' || !pending.cookies) {
    return { key: requestId, qrUrl: '', status: pending.status, message: pending.message }
  }
  const uin = getUin(pending.cookies)
  const musicKey = getMusicKey(pending.cookies)
  if (!uin || !musicKey) return { key: requestId, qrUrl: '', status: 'failed', message: '登录成功但未获取到 QQ 音乐凭证' }
  pendingQrLogins.delete(requestId)
  const result = buildLoginResult(uin, musicKey, pending.cookies)
  try {
    const playlists = await getUserPlaylists(result.session)
    if (playlists[0]?.author) result.account.nickname = playlists[0].author
  } catch {}
  return { key: requestId, qrUrl: '', status: 'confirmed', ...result }
}

const requireSession = (session: LX.Account.LoginSession | null) => {
  if (!session || session.source !== 'tx') throw new Error('QQ 音乐登录状态不存在或已失效')
  return session
}

export const getUserPlaylists = async(sessionValue: LX.Account.LoginSession | null): Promise<LX.Account.PlaylistInfo[]> => {
  const session = requireSession(sessionValue)
  const uin = session.tokens.uin
  const url = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss')
  const params = { hostUin: 0, hostuin: uin, sin: 0, size: 1000, g_tk: getGtk(session), loginUin: uin, format: 'json', platform: 'yqq.json' }
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value))
  const response = await httpFetch<any>(url.toString(), { method: 'GET', headers: commonHeaders(session) })
  if (response.statusCode !== 200 || response.body?.code !== 0) throw new Error(response.body?.message || '获取 QQ 音乐歌单失败')
  const data = response.body.data ?? {}
  return (data.disslist ?? []).map((item: any) => ({
    id: String(item.tid ?? item.disstid ?? item.dissid ?? ''),
    name: item.diss_name ?? item.dissname ?? '',
    author: data.hostname ?? '',
    play_count: String(item.listen_num ?? item.visitnum ?? 0),
    img: item.diss_cover ?? item.diss_pic ?? item.logo ?? '',
    desc: null,
    source: 'tx' as const,
    total: String(item.song_cnt ?? item.songnum ?? 0),
    dirId: String(item.dirid ?? ''),
    isEditable: true,
  })).filter((item: LX.Account.PlaylistInfo) => item.id)
}

export const getPlaylistTrackIds = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  dirId?: string,
): Promise<LX.Account.PlaylistTrackInfo[]> => {
  const session = requireSession(sessionValue)
  if (playlistId === '0') return []
  const pageSize = 500
  const tracks: LX.Account.PlaylistTrackInfo[] = []
  let songBegin = 0

  while (true) {
    const data = await requestMusicU(session, 'music.srfDissInfo.DissInfo', 'CgiGetDiss', {
      disstid: Number(playlistId),
      dirid: Number(dirId) || 0,
      tag: true,
      song_begin: songBegin,
      song_num: pageSize,
      userinfo: true,
      orderlist: true,
      onlysonglist: false,
    })
    const songs = data.songlist ?? []
    tracks.push(...songs.map((song: any) => ({
      id: String(song.mid ?? song.songmid ?? ''),
      removeId: String(song.id ?? song.songid ?? ''),
    })).filter((track: LX.Account.PlaylistTrackInfo) => track.id))
    if (!songs.length || songs.length < pageSize || data.hasmore === 0 || tracks.length >= Number(data.total_song_num || 0)) break
    songBegin += songs.length
  }

  return [...new Map(tracks.map(track => [track.id, track])).values()]
}

const requestLegacyPlaylist = async(
  session: LX.Account.LoginSession,
  endpoint: string,
  params: Record<string, string>,
) => {
  const url = new URL(endpoint)
  url.searchParams.set('g_tk', String(getGtk(session)))
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  const response = await httpFetch<any>(url.toString(), { method: 'GET', headers: commonHeaders(session) })
  if (response.statusCode !== 200 || Number(response.body?.code) !== 0) {
    throw new Error(response.body?.msg || response.body?.message || 'QQ 音乐歌单操作失败')
  }
}

export const addPlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  _playlistId: string,
  dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const session = requireSession(sessionValue)
  const mids = tracks.map(track => track.songId).filter(Boolean)
  if (!dirId) throw new Error('QQ 音乐歌单缺少目录 ID')
  if (!mids.length) return
  await requestLegacyPlaylist(session, 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg', {
    midlist: mids.join(','),
    typelist: mids.map(() => '13').join(','),
    dirid: dirId,
    addtype: '',
    formsender: '4',
    r2: '0',
    r3: '1',
    utf8: '1',
  })
}

export const removePlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  _playlistId: string,
  dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const session = requireSession(sessionValue)
  const ids = tracks.map(track => track.platformId).filter((id): id is string => Boolean(id))
  if (!dirId) throw new Error('QQ 音乐歌单缺少目录 ID')
  if (ids.length !== tracks.length) throw new Error('部分歌曲缺少 QQ 音乐歌曲 ID')
  await requestLegacyPlaylist(session, 'https://c.y.qq.com/qzone/fcg-bin/fcg_music_delbatchsong.fcg', {
    loginUin: session.tokens.uin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.post',
    needNewCode: '0',
    uin: session.tokens.uin,
    dirid: dirId,
    ids: ids.join(','),
    source: '103',
    types: ids.map(() => '3').join(','),
    formsender: '4',
    flag: '2',
    utf8: '1',
    from: '3',
  })
}

export const getDailyTrackIds = async(sessionValue: LX.Account.LoginSession | null): Promise<string[]> => {
  const session = requireSession(sessionValue)
  const ids: string[] = []
  for (let page = 1; page <= 3; page++) {
    const data = await requestMusicU(session, 'music.recommend.TrackRelationServer', 'GetRadarSong', {
      Page: page,
      ReqType: 0,
      FavSongs: [],
      EntranceSongs: [],
    })
    const songs = data.VecSongs ?? []
    ids.push(...songs.map((item: any) => String(item.Track?.mid ?? item.mid ?? '')).filter(Boolean))
    if (!data.HasMore || !songs.length) break
  }
  return [...new Set(ids)]
}
