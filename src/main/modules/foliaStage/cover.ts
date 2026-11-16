// 当前歌曲封面 → Folia Stage API 的封面字段。
// 落雪的封面有三种：在线歌曲是 http(s) 地址；本地歌曲内嵌封面是 data: URI，大于 400KB 时写成临时文件、给本机路径。
// Folia 页面读不到本机文件，所以 data: 和本机文件都读成字节、按 base64 上传（`cover`），http(s) 直接给地址（`coverUrl`）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type FoliaCover =
  | { coverUrl: string }
  | { cover: { mimeType: string, data: string } }

/** Stage API 请求体上限 2 MiB，歌词也在里面；封面原始字节超过这个就不传 */
export const MAX_COVER_BYTES = 1_200_000
const MAX_COVER_URL_LENGTH = 4096
const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** 按文件头判断图片类型（临时文件的扩展名来自标签里的 MIME，不一定准） */
export const sniffImageMime = (bytes: Uint8Array): string | null => {
  if (bytes.length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e && bytes[3] == 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46) return 'image/gif'
  if (bytes.length >= 12 &&
    bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46 &&
    bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50) return 'image/webp'
  return null
}

const fromBytes = (bytes: Uint8Array): FoliaCover | null => {
  if (!bytes.length || bytes.length > MAX_COVER_BYTES) return null
  const mimeType = sniffImageMime(bytes)
  if (!mimeType) return null
  return { cover: { mimeType, data: Buffer.from(bytes).toString('base64') } }
}

const DATA_URI_RXP = /^data:([^;,]+)?(;base64)?,/i

const readLocalFile = async(filePath: string) => {
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile() || stat.size > MAX_COVER_BYTES) return null
  return fs.promises.readFile(filePath)
}

/** 封面地址 → Folia 封面字段；不认识、读不到或太大时返回 null（不传封面） */
export const resolveFoliaCover = async(picUrl: string | null | undefined, readFile: (filePath: string) => Promise<Uint8Array | null> = readLocalFile): Promise<FoliaCover | null> => {
  const pic = picUrl?.trim()
  if (!pic) return null

  if (/^https?:\/\//i.test(pic)) return pic.length <= MAX_COVER_URL_LENGTH ? { coverUrl: pic } : null

  const dataMatch = DATA_URI_RXP.exec(pic)
  if (dataMatch) {
    if (!dataMatch[2]) return null
    const declared = (dataMatch[1] ?? '').toLowerCase().replace('image/jpg', 'image/jpeg')
    const bytes = Buffer.from(pic.slice(dataMatch[0].length).replace(/\s+/g, ''), 'base64')
    const result = fromBytes(bytes)
    // 文件头认不出时信任声明的类型
    if (!result && SUPPORTED_MIME.has(declared) && bytes.length && bytes.length <= MAX_COVER_BYTES) {
      return { cover: { mimeType: declared, data: bytes.toString('base64') } }
    }
    return result
  }

  let filePath: string | null = null
  if (/^file:\/\//i.test(pic)) {
    try {
      filePath = fileURLToPath(pic)
    } catch {
      return null
    }
  } else if (path.isAbsolute(pic)) filePath = pic
  if (!filePath) return null

  try {
    const bytes = await readFile(filePath)
    return bytes ? fromBytes(bytes) : null
  } catch {
    return null
  }
}
