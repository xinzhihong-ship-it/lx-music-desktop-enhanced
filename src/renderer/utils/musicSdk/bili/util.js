import crypto from 'node:crypto'
import { httpFetch } from '../../request'
import { getAccountSourceCookie } from '@renderer/utils/ipc'

export const BILI_API = 'https://api.bilibili.com'
export const BILI_REFERER = 'https://www.bilibili.com/'
export const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'

// DASH 音频流 id -> 落雪音质标识
// 参考 https://github.com/SocialSisterYi/bilibili-API-collect
export const DASH_QUALITY_MAP = {
  30216: '128k',
  30232: '128k',
  30280: '192k',
  30250: 'atmos',
  30251: 'hires',
}

export const QUALITY_RANK = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k']
export const getQualityRank = quality => {
  const index = QUALITY_RANK.indexOf(quality)
  return index == -1 ? QUALITY_RANK.length : index
}

const WBI_MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]

let wbiKey = ''
let wbiKeyLoadedAt = 0
let wbiKeyPromise = null
const WBI_KEY_CACHE_DURATION = 60 * 60 * 1000

// 已登录账号的 Cookie：登录后搜索风控更宽松，且 playurl 才能返回高码率音频流
let accountCookie = ''
let accountCookieLoadedAt = 0
let accountCookiePromise = null
const ACCOUNT_COOKIE_CACHE_DURATION = 5 * 60 * 1000

export const getAccountCookie = async() => {
  if (Date.now() - accountCookieLoadedAt < ACCOUNT_COOKIE_CACHE_DURATION) return accountCookie
  if (accountCookiePromise) return accountCookiePromise
  accountCookiePromise = getAccountSourceCookie('bili').catch(() => '').then(cookie => {
    accountCookie = cookie
    accountCookieLoadedAt = Date.now()
    return cookie
  }).finally(() => {
    accountCookiePromise = null
  })
  return accountCookiePromise
}

// 播放取流等关键时刻强制使用最新登录态，避免登录后仍用到旧的空 Cookie 缓存
export const refreshAccountCookie = async() => {
  accountCookieLoadedAt = 0
  return getAccountCookie()
}

export const clearAccountCookieCache = () => {
  accountCookie = ''
  accountCookieLoadedAt = 0
  wbiKey = ''
  wbiKeyLoadedAt = 0
}

const getWbiKey = () => {
  if (wbiKey && Date.now() - wbiKeyLoadedAt < WBI_KEY_CACHE_DURATION) return Promise.resolve(wbiKey)
  if (wbiKeyPromise) return wbiKeyPromise
  wbiKeyPromise = httpFetch(`${BILI_API}/x/web-interface/nav`, {
    method: 'get',
    headers: { 'User-Agent': BILI_UA, Referer: BILI_REFERER },
  }).promise.then(({ statusCode, body }) => {
    if (statusCode != 200) throw new Error(`bili wbi key request failed (${statusCode})`)
    const data = typeof body == 'string' ? JSON.parse(body) : body
    const imgKey = String(data?.data?.wbi_img?.img_url || '').split('/').pop().split('.')[0]
    const subKey = String(data?.data?.wbi_img?.sub_url || '').split('/').pop().split('.')[0]
    if (!imgKey || !subKey) throw new Error('bili wbi key was not found')
    const raw = imgKey + subKey
    wbiKey = WBI_MIXIN_KEY_ENC_TAB.map(i => raw[i]).join('').slice(0, 32)
    wbiKeyLoadedAt = Date.now()
    return wbiKey
  }).finally(() => {
    wbiKeyPromise = null
  })
  return wbiKeyPromise
}

const buildQuery = params => Object.entries(params)
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  .join('&')

export const wbiSign = async params => {
  const key = await getWbiKey()
  const signedParams = { ...params, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(signedParams).sort()
    .map(k => `${k}=${encodeURIComponent(String(signedParams[k]).replace(/[!'()*]/g, ''))}`)
    .join('&')
  const wRid = crypto.createHash('md5').update(query + key).digest('hex')
  return `${query}&w_rid=${wRid}`
}

/**
 * B 站 GET 请求
 * @param {string} url 接口地址
 * @param {object} params query 参数
 * @param {{ signed?: boolean, raw?: boolean }} options signed 使用 wbi 签名；raw 用于非标准响应（如字幕文件）
 */
export const biliGet = async(url, params = {}, { signed = false, raw = false } = {}) => {
  const query = signed ? await wbiSign(params) : buildQuery(params)
  const fullUrl = query ? `${url}?${query}` : url
  const cookie = await getAccountCookie()
  const { statusCode, body } = await httpFetch(fullUrl, {
    method: 'get',
    headers: {
      'User-Agent': BILI_UA,
      Referer: BILI_REFERER,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  }).promise
  if (statusCode != 200) throw new Error(`bili request failed (${statusCode})`)
  const data = typeof body == 'string' ? JSON.parse(body) : body
  if (raw) return data
  if (data?.code !== 0) throw new Error(`bili api error (${data?.code}: ${data?.message || 'unknown'})`)
  return data?.data ?? data
}

export const stripHtml = text => String(text || '').replace(/<[^>]+>/g, '')

export const normalizePicUrl = url => {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  return url
}

export const parseDuration = duration => {
  if (!duration) return 0
  const parts = String(duration).split(':').map(n => parseInt(n, 10) || 0)
  if (parts.length == 2) return parts[0] * 60 + parts[1]
  if (parts.length == 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

/**
 * 并发受限的 map
 */
export const mapLimit = async(list, limit, handler) => {
  const results = new Array(list.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async() => {
    while (index < list.length) {
      const current = index++
      results[current] = await handler(list[current], current)
    }
  })
  await Promise.all(workers)
  return results
}
