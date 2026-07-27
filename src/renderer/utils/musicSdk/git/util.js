import { appSetting } from '@renderer/store/setting'
import { httpFetch } from '../../request'

const DEFAULT_DATABASE_URL = 'https://api.gitcode.com/api/v5/repos/ikun_0014/music/raw/audio_database.json'

let database
let databasePromise
let loadedUrl = ''
const CACHE_DURATION = 60 * 60 * 1000
let loadedAt = 0

const getConfiguredUrl = () => {
  // 空配置回退到默认索引（部分旧配置的值为空字符串）
  const configuredUrl = appSetting['network.gitcodeMusicDatabaseUrl'].trim() || DEFAULT_DATABASE_URL
  if (!configuredUrl) throw new Error('GitCode music database URL is not configured')
  if (/[?&](?:access_token|private_token|token)=/i.test(configuredUrl)) {
    throw new Error('Configure the GitCode access token in the separate token field')
  }

  const url = new URL(configuredUrl)
  const token = appSetting['network.gitcodeMusicAccessToken'].trim()
  if (token) url.searchParams.set('access_token', token)
  return url.toString()
}

export const loadDatabase = (forceReload = false) => {
  const url = getConfiguredUrl()
  if (!forceReload && database && loadedUrl == url && Date.now() - loadedAt < CACHE_DURATION) {
    return Promise.resolve(database)
  }
  if (databasePromise && loadedUrl == url) return databasePromise

  loadedUrl = url
  databasePromise = httpFetch(url).promise.then(({ statusCode, body }) => {
    if (statusCode != 200) throw new Error(`GitCode database request failed (${statusCode})`)
    const list = typeof body == 'string' ? JSON.parse(body) : body
    if (!Array.isArray(list)) throw new Error('Invalid GitCode music database')
    database = list
    loadedAt = Date.now()
    return list
  }).finally(() => {
    databasePromise = null
  })
  return databasePromise
}

const hash = text => {
  let value = 0
  for (let i = 0; i < text.length; i++) value = ((value << 5) - value + text.charCodeAt(i)) | 0
  return Math.abs(value).toString(36)
}

export const getRelativePath = item => item.relative_path || item.path || item.filename || ''
export const generateSongId = relativePath => `gitcode_${hash(relativePath)}`

const normalizeBitrate = value => {
  const bitrate = Number(value) || 0
  return bitrate > 0 && bitrate < 1000 ? bitrate * 1000 : bitrate
}

export const getItemQuality = item => {
  const quality = String(item.quality || '').toLowerCase()
  if (['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k'].includes(quality)) return quality

  const format = String(item.format || item.ext || getRelativePath(item).split('.').pop() || '').toLowerCase()
  if (format == 'flac') return Number(item.bit_depth) > 16 ? 'flac24bit' : 'flac'
  const bitrate = normalizeBitrate(item.bitrate)
  if (bitrate >= 256000) return '320k'
  if (bitrate >= 160000) return '192k'
  return '128k'
}

export const findDatabaseItem = async songInfo => {
  const relativePath = songInfo.platformData?.relativePath
  const targetId = songInfo.songmid
  const list = await loadDatabase()
  return list.find(item => {
    const itemPath = getRelativePath(item)
    return relativePath ? itemPath == relativePath : generateSongId(itemPath) == targetId
  })
}

export const buildDownloadUrl = relativePath => {
  const databaseUrl = new URL(getConfiguredUrl())
  const marker = '/raw/'
  const index = databaseUrl.pathname.indexOf(marker)
  if (index < 0) throw new Error('GitCode database URL does not support relative download paths')
  databaseUrl.pathname = `${databaseUrl.pathname.slice(0, index + marker.length)}${relativePath.replace(/^[/\\]+/, '').split(/[\\/]/).map(encodeURIComponent).join('/')}`
  return databaseUrl.toString()
}
