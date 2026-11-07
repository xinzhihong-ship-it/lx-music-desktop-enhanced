export type WebDAVSyncDecision = 'upload' | 'download' | 'conflict' | 'none'

export const normalizeWebDAVPath = (path: string): string => {
  const segments = path.trim().split('/').filter(Boolean)
  if (segments.some(segment => segment == '.' || segment == '..' || segment.includes('\0'))) throw new Error('Invalid WebDAV path')
  return `/${segments.join('/')}`
}

export const getWebDAVFilePath = (basePath: string, fileName: string): string => {
  const path = normalizeWebDAVPath(basePath)
  return `${path == '/' ? '' : path}/${fileName}`
}

const sortSyncObjectKeys = (_key: string, value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]]))
}

export const hashSyncData = (value: unknown, legacy = false): string => {
  const text = legacy ? JSON.stringify(value) : JSON.stringify(value, sortSyncObjectKeys)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${legacy ? '' : 'v2:'}${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export const decideWebDAVSync = ({
  hasRemote,
  hasLocalData,
  lastHash,
  localHash,
  remoteHash,
}: {
  hasRemote: boolean
  hasLocalData: boolean
  lastHash: string
  localHash: string
  remoteHash: string
}): WebDAVSyncDecision => {
  if (!hasRemote) return 'upload'
  if (localHash == remoteHash) return 'none'
  if (!lastHash) return hasLocalData ? 'conflict' : 'download'

  const localChanged = localHash != lastHash
  const remoteChanged = remoteHash != lastHash
  if (localChanged && remoteChanged) return 'conflict'
  if (localChanged) return 'upload'
  if (remoteChanged) return 'download'
  return 'none'
}

/**
 * 平台专属设置：路径、播放引擎、输出设备等只在当前设备 / 操作系统上有意义，
 * 跨平台同步（如 macOS → Windows）会导致引擎不可用、路径失效，因此不参与 WebDAV 设置同步：
 * 上传时不写入云端，下载时即使云端（旧版本上传的）带有这些键也忽略。
 */
export const WEBDAV_PLATFORM_SETTING_KEYS = [
  'player.playEngine',
  'player.mpv.path',
  'player.mpv.extraArgs',
  'player.mpv.aoFallbackDevices',
  'player.mediaDeviceId',
  'player.vst3.directories',
  'player.vst3.chain',
  'download.savePath',
  // 歌词岛被拖到的位置是本机屏幕坐标，换一台电脑 / 显示器布局就不对了
  'island.x',
  'island.y',
] as const

/** 敏感信息与同步状态：不上传 */
const WEBDAV_UPLOAD_EXCLUDED_KEYS = [
  'network.gitcodeMusicAccessToken',
  'sync.webdav.password',
  'sync.webdav.lastListEtag',
  'sync.webdav.lastListHash',
  'sync.webdav.lastSyncTime',
  ...WEBDAV_PLATFORM_SETTING_KEYS,
]

/** 协议同意状态、WebDAV 连接配置与同步状态：下载时不覆盖本地 */
const WEBDAV_DOWNLOAD_PROTECTED_KEYS = new Set<string>([
  'common.isAgreePact',
  'network.gitcodeMusicAccessToken',
  'sync.webdav.password',
  'sync.webdav.enable',
  'sync.webdav.autoSync',
  'sync.webdav.url',
  'sync.webdav.username',
  'sync.webdav.path',
  'sync.webdav.lastListEtag',
  'sync.webdav.lastListHash',
  'sync.webdav.lastSyncTime',
  ...WEBDAV_PLATFORM_SETTING_KEYS,
])

/** 生成要上传到云端的设置（返回新对象，不修改入参） */
export const getWebDAVUploadSettings = <T extends object>(settings: T): Partial<T> => {
  const excluded = new Set<string>(WEBDAV_UPLOAD_EXCLUDED_KEYS)
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !excluded.has(key))) as Partial<T>
}

/** 从云端设置中挑出允许应用到本地的部分：只保留本地已知的键，并排除受保护 / 平台专属的键 */
export const pickWebDAVDownloadSettings = <T extends object>(remote: Record<string, unknown>, local: T): Partial<T> => {
  return Object.fromEntries(Object.entries(remote).filter(([key]) => key in local && !WEBDAV_DOWNLOAD_PROTECTED_KEYS.has(key))) as Partial<T>
}
