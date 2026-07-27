import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { httpFetch } from '@main/utils/request'

const API_URL = 'https://api.bilibili.com'
const PASSPORT_URL = 'https://passport.bilibili.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
const REFERER = 'https://www.bilibili.com/'

const ignoredCookieKeys = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly'])

interface PendingQrLogin {
  key: string
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

const commonHeaders = (cookies: Record<string, string> = {}) => ({
  'User-Agent': USER_AGENT,
  Referer: REFERER,
  ...(Object.keys(cookies).length ? { Cookie: Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
})

const requireSession = (session: LX.Account.LoginSession | null): LX.Account.LoginSession => {
  if (!session) throw new Error('账号登录状态不存在或已失效')
  return session
}

const getRequestError = (body: any, fallback: string) => body?.message || fallback

const biliGet = async<T>(url: string, cookies: Record<string, string> = {}) => {
  const response = await httpFetch<T & { code: number, message?: string }>(url, {
    method: 'GET',
    headers: commonHeaders(cookies),
  })
  if (response.statusCode !== 200 || response.body?.code !== 0) {
    throw new Error(getRequestError(response.body, `请求失败（HTTP ${response.statusCode}）`))
  }
  return response.body
}

const getAccount = async(cookies: Record<string, string>) => {
  const response = await biliGet<{ data?: { isLogin?: boolean, mid?: number, uname?: string, face?: string } }>(
    `${API_URL}/x/web-interface/nav`,
    cookies,
  )
  const profile = response.data
  if (!profile?.isLogin || !profile.mid) throw new Error('登录失败，请检查 Cookie 是否有效')
  const account: LX.Account.PlatformAccount = {
    id: `bili_${profile.mid}`,
    source: 'bili',
    nickname: profile.uname ?? '',
    avatar: profile.face,
    isLogin: true,
  }
  const session: LX.Account.LoginSession = {
    source: 'bili',
    cookies,
    tokens: { userId: String(profile.mid) },
  }
  return { account, session }
}

export const loginByCookie = async(cookie: string) => {
  const cookies = parseCookieString(cookie)
  if (!cookies.SESSDATA) throw new Error('Cookie 中缺少 SESSDATA')
  return getAccount(cookies)
}

export const createQrCode = async(): Promise<LX.Account.QrCodeLoginState> => {
  const body = await biliGet<{ data?: { url?: string, qrcode_key?: string } }>(`${PASSPORT_URL}/x/passport-login/web/qrcode/generate`)
  const { url, qrcode_key: key } = body.data ?? {}
  if (!url || !key) throw new Error('获取哔哩哔哩二维码失败')

  const requestId = randomUUID()
  pendingQrLogins.set(requestId, { key })
  setTimeout(() => pendingQrLogins.delete(requestId), 3 * 60 * 1000).unref()
  return {
    key: requestId,
    qrUrl: await QRCode.toDataURL(url, { width: 220, margin: 2 }),
    status: 'waiting',
  }
}

const qrStatusMap: Record<number, LX.Account.QrCodeLoginState['status']> = {
  0: 'confirmed',
  86038: 'expired',
  86090: 'scanned',
  86101: 'waiting',
}

export const checkQrCodeStatus = async(requestId: string): Promise<LX.Account.QrCodeLoginResult & { session?: LX.Account.LoginSession }> => {
  const pending = pendingQrLogins.get(requestId)
  if (!pending) return { key: requestId, qrUrl: '', status: 'expired', message: '二维码已过期' }

  const response = await httpFetch<{ code: number, data?: { code?: number, message?: string, url?: string } }>(
    `${PASSPORT_URL}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(pending.key)}`,
    { method: 'GET', headers: commonHeaders() },
  )
  if (response.statusCode !== 200 || response.body?.code !== 0) {
    return { key: requestId, qrUrl: '', status: 'failed', message: getRequestError(response.body, '检查扫码状态失败') }
  }
  const data = response.body.data ?? {}
  const status = qrStatusMap[data.code ?? -1] ?? 'failed'
  if (status !== 'confirmed') {
    if (status === 'expired' || status === 'failed') pendingQrLogins.delete(requestId)
    return { key: requestId, qrUrl: '', status, message: data.message }
  }

  const cookies = {
    ...parseSetCookies(response.headers['set-cookie']),
    ...(data.url ? parseCookieString(new URL(data.url).search.replace(/^\?/, '').replaceAll('&', '; ')) : {}),
  }
  pendingQrLogins.delete(requestId)
  const result = await getAccount(cookies)
  return { key: requestId, qrUrl: '', status: 'confirmed', account: result.account, session: result.session }
}

export const getUserPlaylists = async(sessionValue: LX.Account.LoginSession | null): Promise<LX.Account.PlaylistInfo[]> => {
  const session = requireSession(sessionValue)
  const body = await biliGet<{ data?: { list?: any[] } }>(
    `${API_URL}/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(session.tokens.userId)}`,
    session.cookies,
  )
  return (body.data?.list ?? []).map(item => ({
    id: String(item.id),
    name: item.title ?? '',
    author: session.source == 'bili' ? '哔哩哔哩收藏夹' : '',
    play_count: '0',
    img: item.cover ?? '',
    desc: item.intro ?? null,
    source: 'bili' as const,
    total: String(item.media_count ?? 0),
    isEditable: true,
  }))
}

export const getPlaylistTrackIds = async(sessionValue: LX.Account.LoginSession | null, playlistId: string): Promise<LX.Account.PlaylistTrackInfo[]> => {
  const session = requireSession(sessionValue)
  const tracks: LX.Account.PlaylistTrackInfo[] = []
  let page = 1
  // 收藏夹内容接口返回完整媒体信息，id 用 bvid 便于详情构建，removeId 用 aid 便于取消收藏
  while (page <= 25) {
    const body = await biliGet<{ data?: { medias?: any[], has_more?: boolean } }>(
      `${API_URL}/x/v3/fav/resource/list?media_id=${encodeURIComponent(playlistId)}&pn=${page}&ps=40&platform=web`,
      session.cookies,
    )
    for (const media of body.data?.medias ?? []) {
      if (!media.bvid || !media.id) continue
      tracks.push({ id: String(media.bvid), removeId: String(media.id) })
    }
    if (!body.data?.has_more) break
    page++
  }
  return tracks
}

const mutateFavTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  tracks: LX.Account.PlaylistMutationTrack[],
  action: 'add' | 'del',
) => {
  const session = requireSession(sessionValue)
  const csrf = session.cookies.bili_jct
  if (!csrf) throw new Error('登录状态缺少 bili_jct，请重新登录')
  for (const track of tracks) {
    const rid = action == 'add' ? track.songId : (track.platformId ?? track.songId)
    if (!rid || !/^\d+$/.test(rid)) throw new Error(`歌曲「${track.name}」缺少视频 aid，无法操作收藏夹`)
    const response = await httpFetch<{ code: number, message?: string }>(`${API_URL}/x/v3/fav/resource/deal`, {
      method: 'POST',
      headers: commonHeaders(session.cookies),
      form: {
        rid,
        type: '2',
        ...(action == 'add' ? { add_media_ids: playlistId } : { del_media_ids: playlistId }),
        csrf,
      },
    })
    if (response.statusCode !== 200 || response.body?.code !== 0) {
      throw new Error(getRequestError(response.body, `收藏夹操作失败（HTTP ${response.statusCode}）`))
    }
  }
}

export const addPlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  _dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => mutateFavTracks(sessionValue, playlistId, tracks, 'add')

export const removePlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  _dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => mutateFavTracks(sessionValue, playlistId, tracks, 'del')

export const getDailyTrackIds = async(_sessionValue: LX.Account.LoginSession | null): Promise<string[]> => {
  throw new Error('哔哩哔哩暂不支持每日推荐')
}

const formatInterval = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`

export const getSimilarSongs = async(
  _session: LX.Account.LoginSession | null,
  songId: string,
  limit: number,
): Promise<LX.Music.MusicInfoOnline[]> => {
  const body = await biliGet<{ data?: any[] }>(`${API_URL}/x/web-interface/archive/related?bvid=${encodeURIComponent(songId)}`)
  return (body.data ?? [])
    .filter(item => item?.bvid && item?.aid)
    .slice(0, limit)
    .map(item => ({
      id: `bili_${item.bvid}`,
      name: String(item.title ?? ''),
      singer: item.owner?.name ?? '',
      source: 'bili' as const,
      interval: formatInterval(Number(item.duration) || 0),
      meta: {
        songId: String(item.bvid),
        albumName: item.tname ?? 'Bilibili',
        picUrl: item.pic ?? '',
        qualitys: [{ type: '128k' as const, size: null }],
        _qualitys: { '128k': { size: null } },
        platformData: {
          bvid: String(item.bvid),
          aid: item.aid,
          cid: 0,
          page: 1,
          upName: item.owner?.name ?? '',
          videoTitle: String(item.title ?? ''),
        },
      },
    }))
}
