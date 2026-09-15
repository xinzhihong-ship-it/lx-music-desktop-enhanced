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

type KgPlaylistItem = Record<string, unknown>

interface KgPlaylistResponse {
  status: number
  error?: string
  msg?: string
  data?: { info?: KgPlaylistItem[], list?: KgPlaylistItem[] }
  info?: KgPlaylistItem[]
}

const pendingQrLogins = new Map<string, PendingQrLogin>()

const randomHex = (length: number) =>
  randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)

const signature = (params: Record<string, unknown>, key: string, data = '') => {
  const values = Object.keys(params)
    .sort()
    .map((name) => `${name}=${String(params[name])}`)
    .join('')
  return createHash('md5').update(`${key}${values}${data}${key}`).digest('hex')
}

const buildUrl = (
  baseUrl: string,
  params: Record<string, unknown>,
  key: string,
  data = '',
) => {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) { query.set(name, String(value)) }
  query.set('signature', signature(params, key, data))
  return `${baseUrl}?${query.toString()}`
}

const commonParams = (session?: LX.Account.LoginSession, mid?: string) => ({
  dfid: session?.cookies.dfid ?? '-',
  mid:
    mid ??
    session?.cookies.KUGOU_API_MID ??
    session?.cookies.mid ??
    randomHex(32),
  uuid: '-',
  appid: APP_ID,
  clientver: CLIENT_VERSION,
  clienttime: Math.floor(Date.now() / 1000),
})

const commonHeaders = (params: {
  dfid: string
  mid: string
  clienttime: number
  [key: string]: unknown
}) => ({
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

const normalizeImageUrl = (value: unknown, size = 240) => {
  return typeof value === 'string'
    ? value.replace(/\{size\}/g, String(size)).replace(/^http:/, 'https:')
    : ''
}

const buildLoginResult = (
  userid: string,
  token: string,
  cookies: Record<string, string>,
  nickname?: string,
  avatar?: unknown,
) => ({
  account: {
    id: `kg_${userid}`,
    source: 'kg' as const,
    nickname: nickname?.trim() ? nickname : `酷狗用户 ${userid}`,
    avatar: normalizeImageUrl(avatar, 165),
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
  result.account.avatar = await getAccountAvatar(result.session)
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
  const response = await httpFetch<{
    status: number
    error?: string
    data?: { qrcode?: string }
  }>(buildUrl('https://login-user.kugou.com/v2/qrcode', params, WEB_KEY), {
    method: 'GET',
    headers: commonHeaders({ ...params, appid: APP_ID, plat: 1 }),
  })
  const key = response.body.data?.qrcode
  if (response.statusCode !== 200 || response.body.status !== 1 || !key) {
    throw new Error(response.body.error || '获取酷狗二维码失败')
  }
  const requestId = randomUUID()
  pendingQrLogins.set(requestId, { key, mid, dfid })
  setTimeout(() => pendingQrLogins.delete(requestId), 10 * 60 * 1000).unref()
  const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`
  return {
    key: requestId,
    qrUrl: await QRCode.toDataURL(url, { width: 220, margin: 2 }),
    status: 'waiting',
  }
}

export const checkQrCodeStatus = async(
  requestId: string,
): Promise<
LX.Account.QrCodeLoginResult & { session?: LX.Account.LoginSession }
> => {
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
  const response = await httpFetch<{
    status: number
    error?: string
    data?: Record<string, unknown>
  }>(
    buildUrl(
      'https://login-user.kugou.com/v2/get_userinfo_qrcode',
      params,
      WEB_KEY,
    ),
    { method: 'GET', headers: commonHeaders({ ...params, plat: 1 }) },
  )
  const data = response.body.data ?? {}
  const code = Number(data.status ?? response.body.status)
  const statusMap: Record<number, LX.Account.QrCodeLoginState['status']> = {
    0: 'expired',
    1: 'waiting',
    2: 'scanned',
    4: 'confirmed',
  }
  const status = statusMap[code] ?? 'failed'
  if (status !== 'confirmed') {
    if (status === 'expired' || status === 'failed') { pendingQrLogins.delete(requestId) }
    return { key: requestId, qrUrl: '', status, message: response.body.error }
  }
  const userid = String(data.userid ?? '')
  const token = String(data.token ?? '')
  if (!userid || !token) {
    return {
      key: requestId,
      qrUrl: '',
      status: 'failed',
      message: '登录成功但未获取到凭证',
    }
  }
  pendingQrLogins.delete(requestId)
  const result = buildLoginResult(
    userid,
    token,
    {
      userid,
      token,
      KUGOU_API_MID: pending.mid,
      mid: pending.mid,
      dfid: pending.dfid,
    },
    String(data.nickname ?? data.username ?? ''),
    data.user_pic ?? data.user_avatar ?? data.avatar ?? data.pic,
  )
  result.account.avatar ||= await getAccountAvatar(result.session).catch(
    () => '',
  )
  return { key: requestId, qrUrl: '', status: 'confirmed', ...result }
}

const requireSession = (session: LX.Account.LoginSession | null) => {
  if (!session || session.source !== 'kg') { throw new Error('酷狗登录状态不存在或已失效') }
  return session
}

const getPlaylistItems = async(
  sessionValue: LX.Account.LoginSession | null,
): Promise<KgPlaylistItem[]> => {
  const session = requireSession(sessionValue)
  const userid = session.tokens.userId
  const token = session.tokens.token
  const params = { ...commonParams(session), plat: 1, userid, token }
  const body = JSON.stringify({
    userid,
    token,
    total_ver: 979,
    type: 2,
    page: 1,
    pagesize: 1000,
  })
  const response = await httpFetch<KgPlaylistResponse>(
    buildUrl(
      'https://gateway.kugou.com/v7/get_all_list',
      params,
      ANDROID_KEY,
      body,
    ),
    {
      method: 'POST',
      headers: {
        ...commonHeaders(params),
        'Content-Type': 'application/json',
        'x-router': 'cloudlist.service.kugou.com',
      },
      text: body,
    },
  )
  if (response.statusCode !== 200 || response.body.status !== 1) {
    throw new Error(
      response.body.error || response.body.msg || '获取酷狗歌单失败',
    )
  }
  return (
    response.body.data?.info ??
    response.body.data?.list ??
    response.body.info ??
    []
  )
}

export const getAccountAvatar = async(
  sessionValue: LX.Account.LoginSession | null,
): Promise<string> => {
  const list = await getPlaylistItems(sessionValue)
  const profile = list.find(
    (item) => item.create_user_pic || item.user_avatar || item.user_pic,
  )
  return normalizeImageUrl(
    profile?.create_user_pic ?? profile?.user_avatar ?? profile?.user_pic,
    165,
  )
}

export const getUserPlaylists = async(
  sessionValue: LX.Account.LoginSession | null,
): Promise<LX.Account.PlaylistInfo[]> => {
  const list = await getPlaylistItems(sessionValue)
  return list
    .map((item) => ({
      id: String(
        item.global_collection_id ?? item.listid ?? item.specialid ?? '',
      ),
      name: String(item.listname ?? item.specialname ?? item.name ?? ''),
      author: String(
        item.list_create_username ?? item.nickname ?? item.username ?? '',
      ),
      play_count: String(item.playcount ?? item.total_play_count ?? 0),
      img: normalizeImageUrl(item.pic ?? item.img ?? item.imgurl),
      desc: typeof item.intro === 'string' ? item.intro : null,
      source: 'kg' as const,
      total: String(
        item.count ?? item.m_count ?? item.songcount ?? item.trackcount ?? 0,
      ),
      dirId: String(item.listid ?? ''),
      isEditable: Boolean(item.listid),
    }))
    .filter((item: LX.Account.PlaylistInfo) => item.id)
}

const normalizeKgTrackId = (value: unknown) => String(value ?? '').trim().toLowerCase()

const getKgPlaylistSongs = (body: any): any[] => {
  const roots = [body?.data, body]
  for (const root of roots) {
    if (Array.isArray(root)) return root
    for (const key of ['songs', 'info', 'list', 'files', 'data']) {
      if (Array.isArray(root?.[key])) return root[key]
    }
  }
  return []
}

const getKgPlaylistTotal = (body: any) => {
  const roots = [body?.data, body]
  for (const root of roots) {
    for (const key of ['count', 'total', 'song_count', 'songcount', 'total_count']) {
      const value = Number(root?.[key])
      if (Number.isFinite(value) && value >= 0) return value
    }
  }
  return undefined
}

const getKgTrackHash = (song: any) => String(
  song?.hash ??
    song?.Hash ??
    song?.FileHash ??
    song?.filehash ??
    song?.audio_info?.hash ??
    '',
).trim()

// The listid endpoint returns the cloud-list rows in storage order.  Its
// display rank counts down toward zero for the newest row, so use it to
// match the order shown by the official client when it is available.
const getKgPlaylistSort = (song: any) => {
  for (const key of ['sort', 'list_sort', 'listSort']) {
    const rawValue = song?.[key]
    if (rawValue == null || rawValue === '') continue
    const value = Number(rawValue)
    if (Number.isFinite(value)) return value
  }
  return undefined
}

const getKgFileId = (song: any) => {
  const value = song?.fileid ?? song?.file_id ?? song?.FileID
  if (value == null || !/^\d+$/.test(String(value).trim())) return undefined
  const fileId = Number(value)
  return Number.isSafeInteger(fileId) && fileId > 0 ? String(fileId) : undefined
}

const getKgMutationFileIds = (body: any) => {
  const roots = [body?.data, body]
  const values: unknown[] = []
  for (const root of roots) {
    for (const key of ['del_fileids', 'deleted_fileids', 'fileids', 'file_ids']) {
      const value = root?.[key]
      if (Array.isArray(value)) values.push(...value)
      else if (typeof value === 'string') values.push(...value.split(','))
      else if (value != null) values.push(value)
    }
  }
  return [...new Set(values.map(value => getKgFileId({ fileid: value })).filter(Boolean))] as string[]
}

export const getPlaylistTrackIds = async(
  sessionValue: LX.Account.LoginSession | null,
  playlistId: string,
  dirId?: string,
): Promise<LX.Account.PlaylistTrackInfo[]> => {
  const session = requireSession(sessionValue)
  const pageSize = 300
  const trackRows: Array<{
    track: LX.Account.PlaylistTrackInfo
    sort?: number
    order: number
  }> = []
  let beginIndex = 0
  let page = 1
  let pageCount = 0
  let rowOrder = 0
  const listId = Number(dirId)
  const useOwnListEndpoint = Boolean(
    dirId && Number.isSafeInteger(listId) && listId > 0,
  )

  while (true) {
    const common = {
      ...commonParams(session),
      token: session.tokens.token,
      userid: session.tokens.userId,
    }
    let response: any
    if (useOwnListEndpoint) {
      const params = { ...common, plat: 1 }
      const body = JSON.stringify({
        listid: listId,
        userid: session.tokens.userId,
        area_code: 1,
        show_relate_goods: 0,
        pagesize: pageSize,
        allplatform: 1,
        show_cover: 1,
        type: 0,
        token: session.tokens.token,
        page,
      })
      response = await httpFetch<any>(
        buildUrl(
          'https://gateway.kugou.com/v4/get_list_all_file',
          params,
          ANDROID_KEY,
          body,
        ),
        {
          method: 'POST',
          headers: {
            ...commonHeaders(params),
            'Content-Type': 'application/json',
            'x-router': 'cloudlist.service.kugou.com',
          },
          text: body,
        },
      )
    } else {
      const params = {
        ...common,
        area_code: 1,
        begin_idx: beginIndex,
        plat: 1,
        type: 1,
        mode: 1,
        personal_switch: 1,
        extend_fields: 'abtags,hot_cmt,popularization',
        pagesize: pageSize,
        global_collection_id: playlistId,
        module: 'CloudMusic',
        need_sort: 1,
        need_rd: 0,
      }
      response = await httpFetch<any>(
        buildUrl(
          'https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt',
          params,
          ANDROID_KEY,
        ),
        {
          method: 'GET',
          headers: commonHeaders(params),
        },
      )
    }
    if (response.statusCode !== 200 || Number(response.body?.status) !== 1) {
      const status = response.body?.status == null ? '缺失' : String(response.body.status)
      const reason = response.body?.error || response.body?.errmsg || response.body?.msg
      throw new Error(
        `获取酷狗歌单歌曲失败（HTTP ${response.statusCode ?? 0}，status ${status}${reason ? `：${reason}` : ''}）`,
      )
    }
    const songs = getKgPlaylistSongs(response.body)
    const pageRows = songs
      .map((song: any) => {
        const id = getKgTrackHash(song)
        if (!id) return null
        return {
          track: { id, removeId: getKgFileId(song) },
          sort: getKgPlaylistSort(song),
          order: rowOrder++,
        }
      })
      .filter(Boolean) as Array<{
      track: LX.Account.PlaylistTrackInfo
      sort?: number
      order: number
    }>
    const previousCount = trackRows.length
    trackRows.push(...pageRows)
    pageCount++
    const total = getKgPlaylistTotal(response.body)
    const uniqueCount = new Set(trackRows.map(({ track }) => normalizeKgTrackId(track.id))).size
    const noProgress = !songs.length || pageRows.length === 0 || uniqueCount <= previousCount
    const reachedTotal = total != null && total > 0 && uniqueCount >= total
    if (
      noProgress ||
      songs.length < pageSize ||
      reachedTotal ||
      pageCount >= 200
    ) { break }
    if (useOwnListEndpoint) page++
    else beginIndex += songs.length
  }

  const seen = new Set<string>()
  const uniqueRows = trackRows.filter(({ track }) => {
    const key = normalizeKgTrackId(track.id)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (useOwnListEndpoint && uniqueRows.length > 1 && uniqueRows.every(({ sort }) => sort != null)) {
    uniqueRows.sort((a, b) => (a.sort! - b.sort!) || (a.order - b.order))
  }
  return uniqueRows.map(({ track }) => track)
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
  const response = await httpFetch<any>(
    buildUrl(endpoint, params, ANDROID_KEY, body),
    {
      method: 'POST',
      headers: {
        ...commonHeaders(params),
        'Content-Type': 'application/json',
        ...headers,
      },
      text: body,
    },
  )
  if (response.statusCode !== 200) {
    throw new Error(`酷狗歌单操作 HTTP ${response.statusCode ?? 0}`)
  }
  const status = response.body?.status
  if (status == null) {
    throw new Error('酷狗歌单操作响应缺少明确成功状态')
  }
  if (Number(status) !== 1) {
    throw new Error(
      response.body?.error ||
        response.body?.errmsg ||
        response.body?.msg ||
        `酷狗歌单操作失败（status ${String(status)}）`,
    )
  }
  const nestedStatus = response.body?.data?.status
  if (nestedStatus != null && Number(nestedStatus) !== 1) {
    throw new Error(
      response.body?.data?.error ||
        response.body?.data?.errmsg ||
        response.body?.data?.msg ||
        `酷狗歌单操作失败（data.status ${String(nestedStatus)}）`,
    )
  }
  for (const key of ['retCode', 'ret_code', 'error_code', 'err_code']) {
    if (response.body?.data?.[key] != null && Number(response.body.data[key]) !== 0) {
      throw new Error(
        response.body?.data?.error ||
          response.body?.data?.errmsg ||
          response.body?.data?.msg ||
          `酷狗歌单操作失败（data.${key} ${String(response.body.data[key])}）`,
      )
    }
  }
  for (const key of ['error_code', 'err_code', 'retCode', 'ret_code']) {
    if (response.body?.[key] != null && Number(response.body[key]) !== 0) {
      throw new Error(
        response.body?.error ||
          response.body?.errmsg ||
          response.body?.msg ||
          `酷狗歌单操作失败（${key} ${String(response.body[key])}）`,
      )
    }
  }
  return response.body
}

const isKgUncertainMutationError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /超时|timeout|timed out|socket|连接|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed|aborted|HTTP 5\d\d|网络|缺少明确成功状态/i.test(message)
}

const describeKgMutationError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (isKgUncertainMutationError(error)) return `网络错误或结果待确认：${message}`
  if (/HTTP 401|HTTP 403|登录状态|token|userid|鉴权|未授权/i.test(message)) return `鉴权失败：${message}`
  if (/list|歌单|fileid|Hash|hash|参数/i.test(message)) return `参数错误：${message}`
  return message
}

const KG_MUTATION_CONFIRM_DELAYS = [0, 350, 900]

const waitForKgMutationConfirm = async(delay: number) => {
  if (!delay) return Promise.resolve()
  return new Promise<void>((resolve) => setTimeout(resolve, delay))
}

/**
 * The cloud-list mutation endpoints return the committed rows/version even
 * while get_list_all_file is still serving the previous snapshot. Use that
 * explicit result as the fast confirmation path; the renderer will re-read
 * the playlist after the IPC call completes.
 */
const isKgMutationResponseConfirmed = (
  body: any,
  tracks: LX.Account.PlaylistMutationTrack[],
  action: 'add' | 'remove',
  fileIds: string[],
) => {
  const data = body?.data
  if (!data || Number(data.status) !== 1) return false
  if (action === 'add') {
    const returnedHashes = new Set(
      getKgPlaylistSongs(body)
        .map(song => normalizeKgTrackId(getKgTrackHash(song)))
        .filter(Boolean),
    )
    return returnedHashes.size > 0 && tracks.every(track => {
      const hash = normalizeKgTrackId(track.hash)
      return Boolean(hash) && returnedHashes.has(hash)
    })
  }
  const returnedFileIds = getKgMutationFileIds(body)
  // v4/delete_songs currently reports the new count/list version rather than
  // echoing del_fileids. A successful data.status with a numeric count is the
  // server's committed result for the exact fileids sent in this request.
  return (
    (returnedFileIds.length > 0 && fileIds.every(fileId => returnedFileIds.includes(fileId))) ||
    (Number.isSafeInteger(Number(data.count)) && Number(data.count) >= 0)
  )
}

const confirmKgPlaylistMutation = async(
  session: LX.Account.LoginSession,
  playlistId: string,
  dirId: string,
  tracks: LX.Account.PlaylistMutationTrack[],
  action: 'add' | 'remove',
  fileIds: string[] = [],
  mutationBody?: any,
) => {
  if (isKgMutationResponseConfirmed(mutationBody, tracks, action, fileIds)) return
  let lastReadError: unknown
  for (const delay of KG_MUTATION_CONFIRM_DELAYS) {
    await waitForKgMutationConfirm(delay)
    let current: LX.Account.PlaylistTrackInfo[]
    try {
      current = await getPlaylistTrackIds(session, playlistId, dirId)
    } catch (error) {
      lastReadError = error
      continue
    }
    if (action === 'add') {
      const currentHashes = new Set(current.map(track => normalizeKgTrackId(track.id)))
      const applied = tracks.every(track => {
        const hash = normalizeKgTrackId(track.hash)
        return Boolean(hash) && currentHashes.has(hash)
      })
      if (applied) return
    } else {
      const currentFileIds = new Set(current.map(track => track.removeId).filter(Boolean))
      if (fileIds.length === tracks.length && fileIds.every(fileId => !currentFileIds.has(fileId))) return
    }
  }
  if (lastReadError) {
    throw new Error(
      `酷狗音乐${action === 'add' ? '添加' : '删除'}结果待确认：无法重新读取歌单（${lastReadError instanceof Error ? lastReadError.message : String(lastReadError)}）`,
    )
  }
  throw new Error(
    `酷狗音乐${action === 'add' ? '添加' : '删除'}结果待确认：接口返回成功，但重新读取歌单后未${action === 'add' ? '找到歌曲' : '确认目标条目已删除'}`,
  )
}

const resolveKgFileIds = async(
  session: LX.Account.LoginSession,
  playlistId: string,
  dirId: string,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const knownFileIds = tracks.map(track => getKgFileId({ fileid: track.platformId }))
  if (knownFileIds.every(Boolean)) return knownFileIds as string[]
  const current = await getPlaylistTrackIds(session, playlistId, dirId)
  const filesByHash = new Map<string, string>()
  for (const track of current) {
    if (track.removeId) filesByHash.set(normalizeKgTrackId(track.id), track.removeId)
  }
  return tracks.map((track, index) => {
    if (knownFileIds[index]) return knownFileIds[index]
    const hash = normalizeKgTrackId(track.hash)
    const fileId = filesByHash.get(hash)
    if (!hash || !fileId) throw new Error(`歌曲「${track.name}」缺少已确认的酷狗歌单 fileid`)
    return fileId
  })
}

export const addPlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  _playlistId: string,
  dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const session = requireSession(sessionValue)
  if (!dirId) throw new Error('酷狗歌单缺少列表 ID')
  if (!tracks.length) return
  const data = tracks.map((track) => ({
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
  if (data.some((track) => !track.hash)) { throw new Error('部分歌曲缺少酷狗歌曲 Hash') }
  const now = Math.floor(Date.now() / 1000)
  let mutationBody: any
  try {
    mutationBody = await requestPlaylistMutation(
      session,
      'https://gateway.kugou.com/cloudlist.service/v6/add_song',
      {
        userid: session.tokens.userId,
        token: session.tokens.token,
        listid: dirId,
        list_ver: 0,
        type: 0,
        slow_upload: 1,
        scene: 'false;null',
        data,
      },
      { last_time: now, last_area: 'gztx' },
    )
  } catch (error) {
    if (isKgUncertainMutationError(error)) {
      await confirmKgPlaylistMutation(session, _playlistId, dirId, tracks, 'add')
      return
    }
    throw new Error(`酷狗音乐添加歌曲失败：${describeKgMutationError(error)}`)
  }
  await confirmKgPlaylistMutation(session, _playlistId, dirId, tracks, 'add', [], mutationBody)
}

export const removePlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  _playlistId: string,
  dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const session = requireSession(sessionValue)
  if (!dirId) throw new Error('酷狗歌单缺少列表 ID')
  if (!tracks.length) return
  let ids: string[]
  try {
    ids = await resolveKgFileIds(session, _playlistId, dirId, tracks)
  } catch (error) {
    throw new Error(`酷狗音乐删除歌曲失败：${describeKgMutationError(error)}`)
  }
  let mutationBody: any
  try {
    mutationBody = await requestPlaylistMutation(
      session,
      'https://gateway.kugou.com/v4/delete_songs',
      {
        listid: dirId,
        userid: session.tokens.userId,
        data: ids.map((fileid) => ({ fileid: Number(fileid) })),
        type: 0,
        token: session.tokens.token,
        list_ver: 0,
      },
      {},
      { 'x-router': 'cloudlist.service.kugou.com' },
    )
  } catch (error) {
    if (isKgUncertainMutationError(error)) {
      await confirmKgPlaylistMutation(session, _playlistId, dirId, tracks, 'remove', ids)
      return
    }
    throw new Error(`酷狗音乐删除歌曲失败：${describeKgMutationError(error)}`)
  }
  await confirmKgPlaylistMutation(session, _playlistId, dirId, tracks, 'remove', ids, mutationBody)
}

export const getDailyTrackIds = async(
  sessionValue: LX.Account.LoginSession | null,
): Promise<string[]> => {
  const session = requireSession(sessionValue)
  const params = {
    ...commonParams(session),
    token: session.tokens.token,
    userid: session.tokens.userId,
    platform: 'ios',
  }
  const response = await httpFetch<any>(
    buildUrl(
      'https://gateway.kugou.com/everyday_song_recommend',
      params,
      ANDROID_KEY,
    ),
    {
      method: 'POST',
      headers: {
        ...commonHeaders(params),
        'x-router': 'everydayrec.service.kugou.com',
      },
    },
  )
  if (response.statusCode !== 200 || response.body?.status !== 1) {
    throw new Error(
      response.body?.error || response.body?.msg || '获取酷狗每日推荐失败',
    )
  }
  const songs =
    response.body.data?.song_list ??
    response.body.data?.info ??
    response.body.info ??
    response.body.data?.list ??
    []
  return songs.map((song: any) => String(song.hash ?? '')).filter(Boolean)
}

const signParamsKey = (data: string | number) =>
  createHash('md5')
    .update(`${APP_ID}${ANDROID_KEY}${CLIENT_VERSION}${data}`)
    .digest('hex')

const formatInterval = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`

const fmSongToMusicInfo = (item: any): LX.Music.MusicInfoOnline | null => {
  const hash = String(item.hash ?? item.FileHash ?? '')
  const audioId = String(
    item.mixsongid ??
      item.audio_id ??
      item.Audioid ??
      item.album_audio_id ??
      item.songid ??
      '',
  )
  const name = String(
    item.songname ?? item.official_songname ?? item.SongName ?? item.name ?? '',
  ).trim()
  if (!hash || !name) return null
  const singers = item.Singers ?? item.singers ?? item.authors ?? []
  const singer =
    Array.isArray(singers) && singers.length
      ? singers
        .map((singer: any) => singer.name ?? singer.author_name)
        .filter(Boolean)
        .join('、')
      : String(item.author_name ?? item.SingerName ?? item.singer ?? '')
  const timelength = Number(item.timelength)
  const duration = Number(item.Duration)
  const durationSeconds =
    Number.isFinite(timelength) && timelength > 0
      ? timelength / 1000
      : Number.isFinite(duration) && duration > 0
        ? duration
        : null
  const qualitys: LX.Music.MusicQualityTypeKg[] = []
  const _qualitys: LX.Music._MusicQualityTypeKg = {}
  const addQuality = (
    type: LX.Quality,
    qualityHash: unknown,
    qualitySize: unknown,
  ) => {
    const value = String(qualityHash ?? '')
    if (!value) return
    const bytes = Number(qualitySize ?? 0)
    const size =
      bytes > 0 ? `${Math.round((bytes / 1024 / 1024) * 100) / 100}M` : null
    qualitys.push({ type, size, hash: value })
    _qualitys[type] = { size, hash: value }
  }
  addQuality(
    '128k',
    item.hash_128 ?? hash,
    item.filesize_128 ?? item.file_size,
  )
  addQuality('320k', item.hash_320 ?? item.HQFileHash, item.filesize_320)
  addQuality(
    'flac',
    item.hash_flac ?? item.sqhash ?? item.SQFileHash,
    item.filesize_flac,
  )
  addQuality('ape', item.hash_ape, item.filesize_ape)
  addQuality(
    'hires',
    item.hash_high ?? item.ResFileHash,
    item.filesize_high ?? item.ResFileSize,
  )
  return {
    id: `${audioId || hash}_${hash}`,
    name,
    singer,
    source: 'kg',
    interval: durationSeconds == null ? null : formatInterval(durationSeconds),
    meta: {
      songId: audioId || hash,
      hash,
      albumId: String(item.album_id ?? item.AlbumID ?? ''),
      albumName: String(item.album_name ?? item.AlbumName ?? ''),
      picUrl: null,
      qualitys,
      _qualitys,
    },
  }
}

export const getSimilarSongs = async(
  sessionValue: LX.Account.LoginSession | null,
  seedHash: string,
  seedSongId: string,
  limit = 50,
): Promise<LX.Music.MusicInfoOnline[]> => {
  // 两个推荐接口均支持匿名请求，未登录时使用游客身份（结果仅缺少个性化权重）
  const session = sessionValue?.source === 'kg' ? sessionValue : null
  const recommendationMid =
    session?.cookies.KUGOU_API_MID ?? session?.cookies.mid ?? randomHex(32)

  // 首选官方 AI 相似推荐（songlistairec）：以 mixsongid 为种子，匿名可用
  const requestAiRecommend = async() => {
    const dateTime = Date.now()
    const body = JSON.stringify({
      platform: 'ios',
      clientver: CLIENT_VERSION,
      clienttime: dateTime,
      userid: session?.tokens.userId ?? 0,
      client_playlist: [],
      source_type: 2,
      playlist_ver: 2,
      area_code: 1,
      appid: APP_ID,
      key: signParamsKey(dateTime),
      mid: recommendationMid,
      recommend_source: [{ ID: Number(seedSongId) }],
    })
    const url = buildUrl(
      'https://gateway.kugou.com/recommend',
      {},
      ANDROID_KEY,
      body,
    )
    const response = await httpFetch<any>(url, {
      method: 'POST',
      headers: {
        ...commonHeaders({
          dfid: session?.cookies.dfid ?? '-',
          mid: recommendationMid,
          clienttime: Math.floor(dateTime / 1000),
        }),
        'Content-Type': 'application/json',
        'x-router': 'songlistairec.kugou.com',
      },
      text: body,
    })
    if (response.statusCode !== 200 || response.body?.status !== 1) {
      throw new Error(
        response.body?.error ||
          response.body?.msg ||
          `酷狗 AI 相似推荐请求失败（HTTP ${response.statusCode ?? 0}，status ${response.body?.status ?? 'unknown'}）`,
      )
    }
    return response.body.data?.song_list ?? []
  }

  // 备选私人 FM（按风格推荐）：以 hash/songid 为种子，需登录态
  const requestFmBatch = async() => {
    const dateTime = Date.now()
    const bodyObj: Record<string, unknown> = {
      appid: APP_ID,
      clienttime: dateTime,
      mid: recommendationMid,
      action: 'play',
      recommend_source_locked: 0,
      song_pool_id: 1,
      callerid: 0,
      m_type: 1,
      platform: 'ios',
      area_code: 1,
      remain_songcnt: 0,
      clientver: CLIENT_VERSION,
      is_overplay: 0,
      mode: 'normal',
      fakem: 'ca981cfc583a4c37f28d2d49000013c16a0a',
      key: signParamsKey(dateTime),
      hash: seedHash,
      songid: seedSongId,
      playtime: 0,
    }
    if (session) {
      bodyObj.userid = session.tokens.userId
      bodyObj.kguid = session.tokens.userId
      bodyObj.token = session.tokens.token
    }
    const body = JSON.stringify(bodyObj)
    const params = {
      ...commonParams(session ?? undefined, recommendationMid),
      ...(session
        ? { token: session.tokens.token, userid: session.tokens.userId }
        : {}),
    }
    const response = await httpFetch<any>(
      buildUrl(
        'https://gateway.kugou.com/v2/personal_recommend',
        params,
        ANDROID_KEY,
        body,
      ),
      {
        method: 'POST',
        headers: {
          ...commonHeaders(params),
          'Content-Type': 'application/json',
          'x-router': 'persnfm.service.kugou.com',
        },
        text: body,
      },
    )
    if (response.statusCode !== 200 || response.body?.status !== 1) {
      throw new Error(
        response.body?.error ||
          response.body?.msg ||
          `酷狗相似歌曲请求失败（HTTP ${response.statusCode ?? 0}，status ${response.body?.status ?? 'unknown'}）`,
      )
    }
    return (
      response.body.data?.songs ??
      response.body.data?.song_list ??
      response.body.data?.info ??
      response.body.songs ??
      []
    )
  }

  const result: LX.Music.MusicInfoOnline[] = []
  const seen = new Set<string>()
  const collect = (songs: any[]) => {
    for (const item of songs) {
      const info = fmSongToMusicInfo(item)
      if (!info || seen.has(info.id)) continue
      seen.add(info.id)
      result.push(info)
    }
  }

  const aiSongs = await requestAiRecommend().catch((error) => {
    console.warn(
      '[KG similar] AI recommend failed, fallback to personal FM:',
      error,
    )
    return null
  })
  if (aiSongs?.length) collect(aiSongs)
  if (result.length) return result.slice(0, limit)

  // 私人 FM 每批返回数量较少（通常 5 首），循环拉取多批直到凑满上限
  for (let batch = 0; batch < 6 && result.length < limit; batch++) {
    const songs = await requestFmBatch()
    collect(songs)
    if (!songs.length) break
  }
  return result.slice(0, limit)
}
