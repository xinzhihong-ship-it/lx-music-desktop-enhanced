import { normalizeWebDAVPath } from '@common/utils/webdavSync'
import { request as httpRequest, type Options } from '@common/utils/request'
import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_FILE_SIZE = 64 * 1024 * 1024

const normalizeConfig = (config: LX.WebDAVSync.Config) => {
  const url = new URL(config.url.trim())
  if (url.protocol != 'http:' && url.protocol != 'https:') throw new Error('WebDAV address must use HTTP or HTTPS')
  url.username = ''
  url.password = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return { url, username: config.username, password: config.password }
}

const getHeaders = (username: string, password: string, headers: Record<string, string> = {}) => ({
  ...headers,
  ...(username ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` } : {}),
})

const getFileUrl = (baseUrl: URL, filePath: string) => {
  const path = normalizeWebDAVPath(filePath).split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return new URL(path, baseUrl).toString()
}

const request = async(config: LX.WebDAVSync.Config, method: Options['method'], path = '', body?: string, headers: Record<string, string> = {}) => {
  const { url, username, password } = normalizeConfig(config)
  return httpRequest(path ? getFileUrl(url, path) : url.toString(), {
    method,
    headers: getHeaders(username, password, headers),
    text: body,
    timeout: 30_000,
    needRaw: true,
  })
}

const assertSuccess = (response: Awaited<ReturnType<typeof request>>, expected: number[] = []) => {
  const status = response.statusCode ?? 0
  if ((status >= 200 && status < 300) || expected.includes(status)) return
  const message = Buffer.from(response.raw).toString('utf8').trim().substring(0, 300)
  throw new Error(`WebDAV ${status}${message ? `: ${message}` : ''}`)
}

const ensureDirectory = async(config: LX.WebDAVSync.Config, filePath: string) => {
  const segments = normalizeWebDAVPath(filePath).split('/').filter(Boolean)
  segments.pop()
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    const response = await request(config, 'MKCOL', current)
    assertSuccess(response, [405])
  }
}

export const testConnection = async(config: LX.WebDAVSync.Config) => {
  const response = await request(config, 'PROPFIND', '', undefined, { Depth: '0' })
  assertSuccess(response, [207])
}

export const downloadFile = async(config: LX.WebDAVSync.Config, path: string): Promise<LX.WebDAVSync.RemoteFile | null> => {
  const response = await request(config, 'GET', path)
  if (response.statusCode == 404) return null
  assertSuccess(response)
  const contentLength = Number(response.headers['content-length'])
  if (contentLength > MAX_FILE_SIZE || response.raw.byteLength > MAX_FILE_SIZE) throw new Error('WebDAV file is too large')
  return {
    content: Buffer.from(response.raw).toString('utf8'),
    etag: response.headers.etag ?? '',
    lastModified: response.headers['last-modified'] ?? '',
  }
}

export const createLocalBackup = async(content: string) => {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) throw new Error('WebDAV backup is too large')
  const dir = path.join(global.lxDataPath, 'webdav-backups')
  await fs.mkdir(dir, { recursive: true })
  const backupPath = path.join(dir, `lx_webdav_backup_${Date.now()}.json`)
  await fs.writeFile(backupPath, content, 'utf8')
  const backups = (await fs.readdir(dir)).filter(name => name.startsWith('lx_webdav_backup_')).sort().reverse()
  await Promise.all(backups.slice(10).map(async name => fs.unlink(path.join(dir, name))))
  return backupPath
}

export const uploadFile = async(
  config: LX.WebDAVSync.Config,
  path: string,
  content: string,
  { etag, createOnly }: { etag?: string, createOnly?: boolean } = {},
): Promise<LX.WebDAVSync.RemoteFile> => {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) throw new Error('WebDAV file is too large')
  await ensureDirectory(config, path)
  const response = await request(config, 'PUT', path, content, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(etag ? { 'If-Match': etag } : {}),
    ...(createOnly ? { 'If-None-Match': '*' } : {}),
  })
  if (response.statusCode == 412) throw new Error('WebDAV data changed on another device; sync again before uploading')
  assertSuccess(response)
  return {
    content: '',
    etag: response.headers.etag ?? '',
    lastModified: response.headers['last-modified'] ?? '',
  }
}
