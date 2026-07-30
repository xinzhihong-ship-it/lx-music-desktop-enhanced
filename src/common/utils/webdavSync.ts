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

export const hashSyncData = (value: unknown): string => {
  const text = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
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
  if (!lastHash) {
    if (localHash == remoteHash) return 'none'
    return hasLocalData ? 'conflict' : 'download'
  }

  const localChanged = localHash != lastHash
  const remoteChanged = remoteHash != lastHash
  if (localChanged && remoteChanged) return 'conflict'
  if (localChanged) return 'upload'
  if (remoteChanged) return 'download'
  return 'none'
}
