import { randomUUID } from 'node:crypto'
import { connect, type MqttClient } from 'mqtt'
import { httpFetch } from '@main/utils/request'

const LOGIN_ENDPOINT = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const LOGIN_TME_APP_ID = 'qqmusic'
const LOGIN_CLIENT_TYPE = 19
const LOGIN_CLIENT_VERSION = 11060000
const LOGIN_MQTT_ENDPOINT = 'wss://mu.y.qq.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const WEB_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 微信网页登录参数（与 y.qq.com 登录弹窗的「微信登录」标签一致）。
 *
 * 微信扫码走 open.weixin.qq.com 的 qrconnect，登录成功后重定向回
 * y.qq.com/portal/wx_redirect.html，由它用 code 调
 * music.login.LoginServer/Login 换取音乐凭证。
 *
 * 与 QQ 通道的差别：微信通道不经过 QQ 互联，因此拿不到 p_skey。
 * 但腾讯对微信登录的音乐写接口校验的是 musickey（TME 体系），
 * 所以微信扫码同样可以管理歌单。
 */
const WECHAT_APPID = 'wx48db31d50e334801'
const WECHAT_QRCONNECT = 'https://open.weixin.qq.com/connect/qrconnect'
const WECHAT_LONG_ENDPOINT = 'https://lp.open.weixin.qq.com/connect/l/qrconnect'
/** 微信登录成功后的回调页（y.qq.com 用它把 code 换成音乐凭证） */
const WECHAT_REDIRECT = 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https%3A%2F%2Fy.qq.com%2F'

interface PendingQrLogin {
  client?: MqttClient | null
  status: LX.Account.QrCodeLoginState['status']
  cookies?: Record<string, string>
  message?: string
  wechat?: {
    uuid: string
    timer: NodeJS.Timeout | null
    stopped: boolean
  }
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
        tmeAppID: 'qqmusic',
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
    throw new Error(result?.message || result?.data?.msg || `QQ 音乐请求失败（${method}，HTTP ${response.statusCode ?? 0}，code ${response.body?.code ?? 'unknown'}，reqCode ${result?.code ?? 'unknown'}）`)
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

/**
 * QQ 音乐登录入口。
 *
 * @param mode 'qq' = 官网同款登录窗口（手机 QQ 扫码或点头像授权）；
 *             'wechat' = 微信扫码（标准 OAuth，扫码确认后直接回传 code）。
 *
 * 说明：QQ 通道**不**在主界面出二维码。原因是 QQ 的登录会话必须在它自己的域下
 * 真实建立，把二维码搬到主界面、登录后另开窗口补授权是行不通的（详见 qqLoginWindow.ts）。
 * 因此 QQ 模式直接打开官方登录窗口，让 QQ 自己的 JS 走完全程。
 */
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

const exchangeMqttLogin = async(uin: string, qrcodeId: string, token: string): Promise<Record<string, string>> => {
  try {
    const response = await httpFetch<any>(LOGIN_ENDPOINT, {
      method: 'POST',
      json: {
        comm: { ct: 11, cv: 20030508 },
        req_0: {
          module: 'music.login.LoginServer',
          method: 'Login',
          param: {
            loginType: 6,
            needCookie: 1,
            tmeAppID: LOGIN_TME_APP_ID,
            str_musicid: uin,
            qrCodeID: qrcodeId,
            token,
          },
        },
      },
      headers: {
        'User-Agent': USER_AGENT,
        Origin: 'https://y.qq.com',
        Referer: 'https://y.qq.com/m/client/qr_code_login/index.html',
      },
    })
    const data = response.body?.req_0?.data
    if (response.body?.req_0?.code === 0 && data) {
      const musickey = String(data.musickey || token)
      const musicid = String(data.musicid || uin)
      const encryptUin = String(data.encryptUin || '')
      const refreshKey = String(data.refresh_key || '')
      return {
        login_type: '2',
        tmeLoginMethod: '3',
        uin: musicid,
        qqmusic_uin: musicid,
        euin: encryptUin,
        tmeLoginType: String(data.loginType ?? '1'),
        qm_keyst: musickey,
        p_lskey: musickey,
        qqmusic_key: musickey,
        refresh_key: refreshKey,
      }
    }
  } catch {}
  return {
    uin,
    qqmusic_uin: uin,
    qqmusic_key: token,
    qm_keyst: token,
    p_lskey: token,
  }
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
      const mqttCookies = parseMqttCookies(payload?.cookies)
      const mqKey = mqttCookies.qqmusic_key || ''
      const mqUin = mqttCookies.qqmusic_uin || ''
      const mqQid = mqttCookies.qrcode_id || ''

      if (mqKey && mqUin) {
        // 第二步（参考开源项目 AcheBreeze/qqmusic_qr_login）：
        // 扫码仅拿到临时 token，需要调 LoginServer/Login 换取长效凭证 musickey 与 refresh_key
        void exchangeMqttLogin(mqUin, mqQid, mqKey).then((finalCookies) => {
          pending.cookies = finalCookies
          pending.status = 'confirmed'
        }).catch(() => {
          pending.cookies = mqttCookies
          pending.status = 'confirmed'
        }).finally(() => {
          client.end(true)
        })
      } else {
        pending.status = 'failed'
        pending.message = 'QQ 音乐登录成功，但未收到有效音乐凭证'
        client.end(true)
      }
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

const createQqAppQrCode = async(): Promise<LX.Account.QrCodeLoginState> => {
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

export const createQrCode = async(mode: 'qq' | 'wechat' = 'qq'): Promise<LX.Account.QrCodeLoginState> => {
  if (mode === 'wechat') return createWechatQrCode()
  return createQqAppQrCode()
}

const readRawBuffer = (response: unknown): Buffer => {
  const raw = (response as { raw?: unknown })?.raw
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return Buffer.alloc(0)
}

/** 取原始文本响应体（needRaw 模式下在 raw 字段）。 */
const readRawText = (response: unknown): string => {
  const raw = (response as { raw?: unknown })?.raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8')
  return String(raw ?? '')
}

/**
 * 微信扫码登录。
 *
 * 流程与 y.qq.com 登录弹窗切到「微信登录」标签完全一致：
 *   1. qrconnect 拿到 uuid，二维码图片在 /connect/qrcode/<uuid>（JPEG）
 *   2. 轮询 lp.open.weixin.qq.com/connect/l/qrconnect?uuid=...
 *      wx_errcode: 408=未扫码, 404=已扫码待确认, 405=已确认, 402=取消/失效
 *   3. 确认后拿到 wx_code，用它调 music.login.LoginServer/Login 换音乐凭证
 *
 * 微信通道不经过 QQ 互联，拿不到 p_skey；但微信登录的音乐写接口校验的是
 * TME 体系的 musickey，所以同样可以管理歌单。
 */
const createWechatQrCode = async(): Promise<LX.Account.QrCodeLoginState> => {
  const connectUrl = `${WECHAT_QRCONNECT}?appid=${WECHAT_APPID}` +
    `&redirect_uri=${encodeURIComponent(WECHAT_REDIRECT)}` +
    '&response_type=code&scope=snsapi_login&state=STATE'

  const pageResponse = await httpFetch<string>(connectUrl, {
    method: 'GET',
    headers: { 'User-Agent': WEB_USER_AGENT, Referer: 'https://y.qq.com/' },
    needRaw: true,
  })
  const html = readRawText(pageResponse)

  const uuid = /uuid=([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? ''
  if (!uuid) throw new Error('获取微信二维码失败：未解析到 uuid')

  // 二维码图片由 open.weixin.qq.com 直接提供（JPEG）
  const imagePath = /src="(\/connect\/qrcode\/[^"]+)"/.exec(html)?.[1] ?? `/connect/qrcode/${uuid}`
  const imageResponse = await httpFetch<ArrayBuffer>(`https://open.weixin.qq.com${imagePath}`, {
    method: 'GET',
    headers: { 'User-Agent': WEB_USER_AGENT, Referer: connectUrl },
    needRaw: true,
  })
  const image = readRawBuffer(imageResponse)
  if (!image.length) throw new Error('获取微信二维码失败：二维码图片为空')

  // 微信返回 JPEG，按魔数判断而不是写死 PNG
  const isJpeg = image[0] === 0xff && image[1] === 0xd8
  const mime = isJpeg ? 'image/jpeg' : 'image/png'
  const qrUrl = `data:${mime};base64,${image.toString('base64')}`

  const requestId = randomUUID()
  const pending: PendingQrLogin = {
    status: 'waiting',
    wechat: { uuid, timer: null, stopped: false },
  }
  pendingQrLogins.set(requestId, pending)

  const startedAt = Date.now()
  const isFinished = () => {
    const status: LX.Account.QrCodeLoginState['status'] = pending.status
    return status !== 'waiting' && status !== 'scanned'
  }
  const tick = async() => {
    // stopped 是布尔值，必须用 ||；用 ?? 会因 false 非空而短路掉 isFinished。
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    if (pending.wechat?.stopped === true || isFinished()) return
    if (Date.now() - startedAt > 120_000) {
      pending.status = 'expired'
      return
    }
    try {
      await pollWechatQrStatus(pending)
    } catch (err) {
      pending.message = err instanceof Error ? err.message : String(err)
    }
    if (!isFinished()) {
      pending.wechat!.timer = setTimeout(() => { void tick() }, 1500)
      pending.wechat!.timer.unref?.()
    }
  }
  void tick()

  return { key: requestId, qrUrl, status: 'waiting' }
}

/** 轮询一次微信扫码状态。 */
const pollWechatQrStatus = async(pending: PendingQrLogin) => {
  const wechat = pending.wechat
  if (!wechat) return
  const pollUrl = `${WECHAT_LONG_ENDPOINT}?uuid=${encodeURIComponent(wechat.uuid)}&_=${Date.now()}`
  const response = await httpFetch<string>(pollUrl, {
    method: 'GET',
    headers: { 'User-Agent': WEB_USER_AGENT, Referer: 'https://open.weixin.qq.com/' },
    needRaw: true,
  })
  const text = readRawText(response)
  // 形如 window.wx_errcode=408;window.wx_code='';
  const errcode = Number(/wx_errcode=(\d+)/.exec(text)?.[1] ?? 0)
  const wxCode = /wx_code='([^']*)'/.exec(text)?.[1] ?? ''

  if (errcode === 408) return // 未扫码
  if (errcode === 404) {
    pending.status = 'scanned'
    return
  }
  if (errcode === 405) {
    if (!wxCode) {
      pending.status = 'failed'
      pending.message = '微信登录未返回授权码'
      return
    }
    wechat.stopped = true
    await completeWechatLogin(pending, wxCode)
    return
  }
  // 402=取消/失效，403=拒绝
  if (errcode === 402 || errcode === 403) {
    pending.status = 'expired'
  }
}

/** 用微信回调 code 换取音乐凭证。 */
const completeWechatLogin = async(pending: PendingQrLogin, wxCode: string) => {
  const cookies: Record<string, string> = {}

  // 微信登录成功后，y.qq.com 的这个页面负责把 code 换成音乐凭证
  const response = await httpFetch<any>(LOGIN_ENDPOINT, {
    method: 'POST',
    json: {
      comm: { tmeAppID: 'qqmusic', tmeLoginType: '1' },
      req_0: {
        module: 'music.login.LoginServer',
        method: 'Login',
        param: { strAppid: WECHAT_APPID, code: wxCode },
      },
    },
    headers: {
      'User-Agent': WEB_USER_AGENT,
      Origin: 'https://y.qq.com',
      Referer: 'https://y.qq.com/portal/wx_redirect.html',
    },
  })

  const result = response.body?.req_0
  if (response.statusCode !== 200 || response.body?.code !== 0 || result?.code !== 0) {
    pending.status = 'failed'
    pending.message = result?.data?.errMsg || result?.message || '微信登录票据交换失败'
    return
  }

  const data = result.data ?? {}
  const musicKey = String(data.musickey ?? '')
  const uin = String(data.musicid ?? data.str_musicid ?? '')
  if (!uin || !musicKey) {
    pending.status = 'failed'
    pending.message = data.errMsg || '微信登录成功但未返回音乐凭证'
    return
  }

  cookies.qqmusic_key = musicKey
  cookies.qm_keyst = musicKey
  cookies.qqmusic_uin = uin
  cookies.uin = uin
  cookies.login_type = '2'
  if (data.refresh_token) cookies.qqmusic_key_refresh = String(data.refresh_token)
  if (data.encryptUin) cookies.euin = String(data.encryptUin)
  if (data.keyExpiresIn) cookies.qqmusic_key_expiresIn = String(data.keyExpiresIn)

  pending.cookies = cookies
  pending.status = 'confirmed'
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

/**
 * 排查写入类接口的授权问题时使用：只输出 cookie 的【键名】与 g_tk 来源，
 * 绝不输出任何 cookie 的值。QQ 的写接口（加歌）比读接口对凭证要求更严，
 * 出现 "no permit" 时首先要确认 p_skey / skey 是否真的存在。
 */
const describeSessionAuth = (session: LX.Account.LoginSession) => {
  const cookieKeys = Object.keys(session.cookies ?? {})
  const gtkSource = session.cookies?.p_skey
    ? 'p_skey'
    : session.cookies?.skey ? 'skey' : 'musicKey(回退)'
  return {
    cookieKeys,
    gtkSource,
    uin: session.tokens?.uin ?? '',
    hasPskey: Boolean(session.cookies?.p_skey),
    hasSkey: Boolean(session.cookies?.skey),
    musicKeyLen: String(session.tokens?.musicKey ?? '').length,
  }
}

const requestLegacyPlaylist = async(
  session: LX.Account.LoginSession,
  endpoint: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
) => {
  const url = new URL(endpoint)
  const gtk = String(getGtk(session))
  url.searchParams.set('g_tk', gtk)

  let response: any
  if (method === 'POST') {
    response = await httpFetch<any>(url.toString(), {
      method: 'POST',
      form: { ...params, g_tk: gtk },
      headers: {
        ...commonHeaders(session),
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://y.qq.com/',
        Origin: 'https://y.qq.com',
      },
    })
  } else {
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
    response = await httpFetch<any>(url.toString(), { method: 'GET', headers: commonHeaders(session) })
  }
  if (response.statusCode !== 200 || Number(response.body?.code) !== 0) {
    // 只报 "invalid request" 无法定位是哪个参数不对，这里把状态码与原始响应一并带上。
    const detail = typeof response.body === 'string'
      ? response.body.slice(0, 200)
      : JSON.stringify(response.body ?? {}).slice(0, 200)
    throw new Error(
      `${response.body?.msg || response.body?.message || 'QQ 音乐歌单操作失败'}` +
      `（HTTP ${response.statusCode ?? 0}，code ${response.body?.code ?? 'unknown'}，原始响应：${detail}）`,
    )
  }
}

export const addPlaylistTracks = async(
  sessionValue: LX.Account.LoginSession | null,
  _playlistId: string,
  dirId: string | undefined,
  tracks: LX.Account.PlaylistMutationTrack[],
) => {
  const session = requireSession(sessionValue)
  if (!dirId) throw new Error('QQ 音乐歌单缺少目录 ID')
  if (!tracks.length) return

  // 加歌是写操作，QQ 对凭证的要求比读歌单严格得多。失败时把授权诊断打进主进程日志，
  // 便于定位是 p_skey/skey 缺失导致的 g_tk 无效，还是接口本身的权限问题。
  // eslint-disable-next-line no-console
  console.log('[tx-add] 授权诊断', JSON.stringify({
    dirId,
    trackCount: tracks.length,
    ...describeSessionAuth(session),
  }))

  // 现代接口要求数字 songId；老接口要求字符串 mid。两者都备齐，缺哪条就少一条退路。
  const songIds = tracks
    .map(track => Number(track.platformId ?? track.songId))
    .filter(songId => Number.isFinite(songId) && songId > 0)
  const mids = tracks.map(track => track.songMid).filter((mid): mid is string => Boolean(mid))

  const failures: string[] = []

  // 路径一：现代 musicu 接口。与读取歌单走同一套鉴权通道（requestMusicU），最可靠。
  if (songIds.length === tracks.length) {
    try {
      await requestMusicU(session, 'music.musicasset.PlaylistDetailWrite', 'AddSonglist', {
        dirId: Number(dirId),
        v_songInfo: songIds.map(songId => ({ songId, songType: 0 })),
      })
      return
    } catch (err: any) {
      failures.push(`现代接口：${err?.message ?? err}`)
    }
  } else {
    failures.push('现代接口：部分歌曲缺少数字 songId')
  }

  // 路径二：老版 CGI 接口。midlist 要的是歌曲 mid（字符串，如 0039MnYb0qxYhV），
  // 不是数字 songId —— 历史上这里误传过 songId。该接口还需要完整的上下文参数
  // （loginUin/uin/platform/format 等），否则服务端会直接返回 "invalid request"。
  if (mids.length === tracks.length && mids.length) {
    try {
      await requestLegacyPlaylist(session, 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg', {
        loginUin: session.tokens.uin,
        hostUin: '0',
        hostuin: session.tokens.uin,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
        uin: session.tokens.uin,
        midlist: mids.join(','),
        typelist: mids.map(() => '13').join(','),
        dirid: dirId,
        addtype: '',
        formsender: '4',
        source: '103',
        r2: '0',
        r3: '1',
        utf8: '1',
      }, 'POST')
      return
    } catch (err: any) {
      failures.push(`兼容接口：${err?.message ?? err}`)
    }
  } else {
    failures.push('兼容接口：部分歌曲缺少歌曲 MID')
  }

  // QQ 的写接口要求网页版会话凭证（p_skey/skey，用于计算 g_tk）。
  // 扫码登录走的是 TME 令牌流程，只拿到 qqmusic_key，读接口可用、写接口一律被拒。
  //
  // 已实测确认这不是参数问题：把 AddSonglist 的参数清空，服务端返回的仍是 1000，
  // 而同一模块家族在参数错误时返回 10004（用 CgiGetDiss 空参数验证过）。
  // 也就是说写操作在「参数校验之前」就被鉴权层拦掉了，调参数没有任何意义。
  const { hasPskey, hasSkey } = describeSessionAuth(session)
  const hint = (!hasPskey && !hasSkey)
    ? '。原因：扫码登录只得到 TME 令牌（qqmusic_key），没有网页版 skey/p_skey，' +
      'QQ 会在参数校验前直接拒绝这类凭证的写操作。' +
      '解决：在浏览器登录 y.qq.com 后复制该站点的 Cookie，' +
      '到「设置 → 平台账号管理 → 添加账号」，平台选 QQ音乐，粘贴 Cookie 登录'
    : ''

  throw new Error(`QQ 音乐添加歌曲到歌单失败 —— ${failures.join('；')}${hint}`)
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
  }, 'POST')
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

const formatInterval = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`

const formatSize = (size: number) => size > 0 ? `${Math.round(size / 1024 / 1024 * 100) / 100}M` : null

const radarTrackToMusicInfo = (item: any): LX.Music.MusicInfoOnline | null => {
  const track = item.Track ?? item.track ?? item
  const mid = String(track.mid ?? '')
  const name = String(track.title ?? track.name ?? '')
  if (!mid || !name) return null
  const file = track.file ?? {}
  const qualitys: LX.Music.MusicQualityType[] = []
  const _qualitys: LX.Music._MusicQualityType = {}
  const addQuality = (type: LX.Quality, size: number) => {
    const value = formatSize(size)
    if (!value) return
    qualitys.push({ type, size: value })
    _qualitys[type] = { size: value }
  }
  addQuality('128k', Number(file.size_128mp3 ?? 0))
  addQuality('320k', Number(file.size_320mp3 ?? 0))
  addQuality('flac', Number(file.size_flac ?? 0))
  addQuality('flac24bit', Number(file.size_hires ?? 0))
  const albumMid = String(track.album?.mid ?? '')
  return {
    id: `tx_${mid}`,
    name,
    singer: (track.singer ?? []).map((singer: any) => singer.name).filter(Boolean).join('、'),
    source: 'tx',
    interval: formatInterval(Number(track.interval ?? 0)),
    meta: {
      songId: mid,
      id: Number(track.id) || undefined,
      strMediaMid: String(file.media_mid ?? mid),
      albumId: albumMid,
      albumMid,
      albumName: String(track.album?.name ?? ''),
      picUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : null,
      qualitys,
      _qualitys,
    },
  }
}

const getNumericSongId = async(session: LX.Account.LoginSession, seedMid: string) => {
  const data = await requestMusicU(session, 'music.trackInfo.UniformRuleCtrl', 'GetTrackInfo', { songMid: [seedMid] })
  return Number(data.tracks?.[0]?.id ?? data.track_info?.id ?? 0)
}

const createGuestSession = (): LX.Account.LoginSession => ({
  source: 'tx',
  cookies: {},
  // 电台接口只校验 uid 为合法数字，匿名时给一个固定的游客 uid 即可，无需真实账号凭证
  tokens: { uin: '12345678', musicKey: '' },
})

export const getSimilarSongs = async(
  sessionValue: LX.Account.LoginSession | null,
  seedMid: string,
  seedSongId: string | number | undefined,
  limit = 50,
): Promise<LX.Music.MusicInfoOnline[]> => {
  // 推荐接口支持匿名请求，未登录时使用游客身份（结果仅缺少个性化权重）
  const session = sessionValue?.source === 'tx' ? sessionValue : createGuestSession()
  const resolvedSongId = /^\d+$/.test(seedMid) ? 0 : await getNumericSongId(session, seedMid).catch(() => 0)
  const songId = resolvedSongId || Number(seedSongId) || Number(seedMid)
  if (!Number.isInteger(songId) || songId <= 0) throw new Error('QQ 音乐歌曲缺少数字 ID')
  const body = {
    comm: {
      g_tk: 5381,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'h5',
      needNewCode: 1,
    },
    simsongs: {
      module: 'rcmusic.similarSongRadioServer',
      method: 'get_simsongs',
      param: { songid: songId },
    },
  }
  let legacySongs: any[] | null = null
  try {
    const response = await httpFetch<any>('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      json: body,
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://y.qq.com/', 'Content-Type': 'application/json' },
    })
    const responseResult = response.body?.simsongs
    if (response.statusCode !== 200 || response.body?.code !== 0 || responseResult?.code !== 0) {
      throw new Error(responseResult?.message || `QQ 音乐相似歌曲请求失败（HTTP ${response.statusCode ?? 0}，code ${responseResult?.code ?? 'unknown'}）`)
    }
    const data = responseResult.data ?? {}
    const songs = data.songInfoList ?? data.vecSong ?? data.tracks ?? data.songlist ?? []
    if (!songs.length) throw new Error('QQ 音乐旧相似歌曲接口返回空列表')
    legacySongs = songs
  } catch {
    console.warn('[QQ similar] legacy request unavailable, fallback to radio')
  }
  const mappedLegacySongs = legacySongs
    ?.map(radarTrackToMusicInfo)
    .filter((item: LX.Music.MusicInfoOnline | null): item is LX.Music.MusicInfoOnline => item != null) ?? []
  if (mappedLegacySongs.length) return mappedLegacySongs.slice(0, limit)

  const radioData = await requestMusicU(session, 'music.radioProxy.MbTrackRadioSvr', 'get_radio_track', {
    id: 99,
    num: limit,
    from: 0,
    scene: 0,
    song_ids: [songId],
    ext: { bluetooth: '' },
    should_count_down: 1,
  })
  const radioSongs = radioData.tracks ?? radioData.songlist ?? []
  const result: LX.Music.MusicInfoOnline[] = []
  const seen = new Set<string>()
  for (const item of radioSongs) {
    const info = radarTrackToMusicInfo(item)
    if (!info || seen.has(info.id)) continue
    seen.add(info.id)
    result.push(info)
  }
  return result.slice(0, limit)
}
