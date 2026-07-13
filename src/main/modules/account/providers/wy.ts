import { randomBytes, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { eapi, linuxapi, weapi } from '@common/utils/neteaseCrypto'
import { httpFetch } from '@main/utils/request'

const BASE_URL = 'https://music.163.com'
const INTERFACE_URL = 'https://interface.music.163.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DESKTOP_USER_AGENT = 'NeteaseMusic/9.1.65.240927161425 CFNetwork/1496.0.7 Darwin/23.5.0'
const ignoredCookieKeys = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly'])

interface PendingQrLogin {
  key: string
  cookies: Record<string, string>
}

interface AccountResponse {
  code: number
  message?: string
  profile?: {
    userId: number
    nickname: string
    avatarUrl?: string
  }
}

const pendingQrLogins = new Map<string, PendingQrLogin>()

const parseCookieString = (value: string): Record<string, string> => {
  const cookies: Record<string, string> = {}
  for (const part of value.split(/;;|;/)) {
    const [rawKey, ...valueParts] = part.trim().split('=')
    const key = rawKey?.trim()
    if (!key || !valueParts.length || ignoredCookieKeys.has(key.toLowerCase())) continue
    cookies[key] = valueParts.join('=').trim()
  }
  return cookies
}

const parseSetCookies = (values?: string[]): Record<string, string> => {
  const cookies: Record<string, string> = {}
  for (const value of values ?? []) Object.assign(cookies, parseCookieString(value.split(';')[0]))
  return cookies
}

const cookieStringify = (cookies: Record<string, string>): string => {
  return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')
}

const commonHeaders = (cookies: Record<string, string> = {}) => ({
  'User-Agent': USER_AGENT,
  Referer: `${BASE_URL}/`,
  Cookie: cookieStringify(cookies),
})

const createAnonymousCookies = (): Record<string, string> => {
  const anonymousId = randomBytes(16).toString('hex')
  return {
    __remember_me: 'true',
    _ntes_nuid: anonymousId,
    _ntes_nnid: `${anonymousId},${Date.now()}`,
    deviceId: randomBytes(26).toString('hex').toUpperCase(),
    os: 'pc',
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    appver: '3.1.17.204416',
    channel: 'netease',
  }
}

const eapiPost = async<T>(uri: string, data: Record<string, unknown>, cookies: Record<string, string>) => {
  const header: Record<string, string> = {
    osver: cookies.osver ?? 'Microsoft-Windows-10-Professional-build-19045-64bit',
    deviceId: cookies.deviceId ?? randomBytes(26).toString('hex').toUpperCase(),
    os: cookies.os ?? 'pc',
    appver: cookies.appver ?? '3.1.17.204416',
    versioncode: cookies.versioncode ?? '140',
    mobilename: '',
    buildver: Date.now().toString().slice(0, 10),
    resolution: '1920x1080',
    __csrf: cookies.__csrf ?? '',
    channel: cookies.channel ?? 'netease',
    requestId: `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`,
  }
  if (cookies.MUSIC_U) header.MUSIC_U = cookies.MUSIC_U
  if (cookies.MUSIC_A) header.MUSIC_A = cookies.MUSIC_A
  const payload = { ...data, e_r: false, header }
  return httpFetch<T>(`${INTERFACE_URL}${uri.replace(/^\/api/, '/eapi')}`, {
    method: 'POST',
    headers: {
      'User-Agent': DESKTOP_USER_AGENT,
      Cookie: Object.entries(header).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('; '),
    },
    form: eapi(uri, payload),
  })
}

const formatPlayCount = (value: number): string => {
  if (value >= 100_000_000) return `${Math.floor(value / 10_000_000) / 10}亿`
  if (value >= 10_000) return `${Math.floor(value / 1_000) / 10}万`
  return String(value || 0)
}

const getAccount = async(cookies: Record<string, string>) => {
  const response = await httpFetch<AccountResponse>(`${BASE_URL}/api/nuser/account/get`, {
    method: 'GET',
    headers: commonHeaders(cookies),
  })
  if (response.statusCode !== 200 || response.body.code !== 200 || !response.body.profile?.userId) {
    throw new Error(response.body.message || '登录失败，请检查 Cookie 是否有效')
  }
  const profile = response.body.profile
  const account: LX.Account.PlatformAccount = {
    id: `wy_${profile.userId}`,
    source: 'wy',
    nickname: profile.nickname,
    avatar: profile.avatarUrl,
    isLogin: true,
  }
  const session: LX.Account.LoginSession = {
    source: 'wy',
    cookies,
    tokens: { userId: String(profile.userId) },
  }
  return { account, session }
}

export const loginByCookie = async(cookie: string) => {
  const cookies = parseCookieString(cookie)
  if (!cookies.MUSIC_U && !cookies.MUSIC_A) throw new Error('Cookie 中缺少 MUSIC_U 或 MUSIC_A')
  return getAccount(cookies)
}

export const createQrCode = async(): Promise<LX.Account.QrCodeLoginState> => {
  const cookies = createAnonymousCookies()
  const response = await eapiPost<{ code: number, data?: { unikey?: string }, unikey?: string, message?: string }>(
    '/api/login/qrcode/unikey',
    { type: 3 },
    cookies,
  )
  const key = response.body.data?.unikey ?? response.body.unikey
  if (response.statusCode !== 200 || response.body.code !== 200 || !key) {
    const rawBody = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
    const detail = response.body.message ?? `HTTP ${response.statusCode ?? 0}, code ${response.body.code ?? 0}, body ${rawBody.slice(0, 120)}`
    throw new Error(`获取二维码密钥失败：${detail}`)
  }
  Object.assign(cookies, parseSetCookies(response.headers['set-cookie']))
  const requestId = randomUUID()
  pendingQrLogins.set(requestId, { key, cookies })
  setTimeout(() => pendingQrLogins.delete(requestId), 10 * 60 * 1000).unref()
  return {
    key: requestId,
    qrUrl: await QRCode.toDataURL(`${BASE_URL}/login?codekey=${key}`, { width: 220, margin: 2 }),
    status: 'waiting',
  }
}

const qrStatusMap: Record<number, LX.Account.QrCodeLoginState['status']> = {
  800: 'expired',
  801: 'waiting',
  802: 'scanned',
  803: 'confirmed',
}

export const checkQrCodeStatus = async(requestId: string): Promise<LX.Account.QrCodeLoginResult & { session?: LX.Account.LoginSession }> => {
  const pending = pendingQrLogins.get(requestId)
  if (!pending) return { key: requestId, qrUrl: '', status: 'expired', message: '二维码已过期' }
  const response = await eapiPost<{ code: number, cookie?: string, message?: string }>(
    '/api/login/qrcode/client/login',
    { key: pending.key, type: 3 },
    pending.cookies,
  )
  const status = qrStatusMap[response.body.code] ?? 'failed'
  if (status !== 'confirmed') {
    if (status === 'expired' || status === 'failed') pendingQrLogins.delete(requestId)
    return { key: requestId, qrUrl: '', status, message: response.body.message }
  }
  const cookies = {
    ...pending.cookies,
    ...parseSetCookies(response.headers['set-cookie']),
    ...(response.body.cookie ? parseCookieString(response.body.cookie) : {}),
  }
  pendingQrLogins.delete(requestId)
  const result = await getAccount(cookies)
  return { key: requestId, qrUrl: '', status: 'confirmed', account: result.account, session: result.session }
}

const requireSession = (session: LX.Account.LoginSession | null): LX.Account.LoginSession => {
  if (!session || session.source !== 'wy') throw new Error('网易云登录状态不存在或已失效')
  return session
}

const getRequestError = (message: string | undefined, fallback: string, statusCode: number | undefined, code: number) => {
  return message ?? `${fallback}（HTTP ${statusCode ?? 0}，code ${code}）`
}

export const getUserPlaylists = async(sessionValue: LX.Account.LoginSession | null): Promise<LX.Account.PlaylistInfo[]> => {
  const session = requireSession(sessionValue)
  const response = await httpFetch<{ code: number, message?: string, playlist?: any[] }>(`${BASE_URL}/weapi/user/playlist`, {
    method: 'POST',
    headers: commonHeaders(session.cookies),
    form: weapi({ uid: session.tokens.userId, limit: 1000, offset: 0 }),
  })
  if (response.statusCode !== 200 || response.body.code !== 200) {
    throw new Error(getRequestError(response.body.message, '获取用户歌单失败', response.statusCode, response.body.code))
  }
  return (response.body.playlist ?? []).map(item => ({
    id: String(item.id),
    name: item.name ?? '',
    author: item.creator?.nickname ?? '',
    play_count: formatPlayCount(Number(item.playCount)),
    img: item.coverImgUrl ?? '',
    desc: item.description ?? null,
    source: 'wy' as const,
    total: String(item.trackCount ?? 0),
    isEditable: String(item.creator?.userId ?? '') === session.tokens.userId,
  }))
}

export const getPlaylistTrackIds = async(sessionValue: LX.Account.LoginSession | null, playlistId: string): Promise<LX.Account.PlaylistTrackInfo[]> => {
  const session = requireSession(sessionValue)
  const response = await httpFetch<{ code: number, message?: string, playlist?: { trackIds?: Array<{ id: number }> } }>(`${BASE_URL}/api/linux/forward`, {
    method: 'POST',
    headers: commonHeaders(session.cookies),
    form: linuxapi({
      method: 'POST',
      url: `${BASE_URL}/api/v3/playlist/detail`,
      params: { id: playlistId, n: 100000, s: 8 },
    }),
  })
  if (response.statusCode !== 200 || response.body.code !== 200) {
    throw new Error(getRequestError(response.body.message, '获取歌单歌曲失败', response.statusCode, response.body.code))
  }
  return (response.body.playlist?.trackIds ?? []).map(item => ({ id: String(item.id), removeId: String(item.id) }))
}

const mutatePlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  tracks: LX.Account.PlaylistMutationTrack[],
  op: 'add' | 'del',
) => {
  const session = requireSession(sessionValue)
  const trackIds = tracks.map(track => track.songId).filter(Boolean)
  if (!trackIds.length) return
  const response = await httpFetch<{ code: number, message?: string }>(`${BASE_URL}/weapi/playlist/manipulate/tracks`, {
    method: 'POST',
    headers: commonHeaders(session.cookies),
    form: weapi({ op, pid: playlistId, trackIds: JSON.stringify(trackIds), imme: 'true' }),
  })
  if (response.statusCode !== 200 || response.body.code !== 200) {
    throw new Error(getRequestError(response.body.message, op === 'add' ? '添加歌曲失败' : '删除歌曲失败', response.statusCode, response.body.code))
  }
}

export const addPlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  _dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => mutatePlaylistTracks(sessionValue, playlistId, tracks, 'add')

export const removePlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  _dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => mutatePlaylistTracks(sessionValue, playlistId, tracks, 'del')

export const getDailyTrackIds = async(sessionValue: LX.Account.LoginSession | null): Promise<string[]> => {
  const session = requireSession(sessionValue)
  const response = await httpFetch<{ code: number, message?: string, data?: { dailySongs?: Array<{ id: number }> } }>(`${BASE_URL}/weapi/v3/discovery/recommend/songs`, {
    method: 'POST',
    headers: commonHeaders(session.cookies),
    form: weapi({}),
  })
  if (response.statusCode !== 200 || response.body.code !== 200) {
    throw new Error(getRequestError(response.body.message, '获取每日推荐失败', response.statusCode, response.body.code))
  }
  return (response.body.data?.dailySongs ?? []).map(item => String(item.id))
}
