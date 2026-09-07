import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'


export const createDirSync = (path: string) => {
  if (!fs.existsSync(path)) {
    try {
      fs.mkdirSync(path, { recursive: true })
    } catch (e: any) {
      if (e.code !== 'EEXIST') {
        console.error('Could not set up log directory, error was: ', e)
        process.exit(1)
      }
    }
  }
}

const fileNameRxp = /[\\/:*?#"<>|]/g
export const filterFileName = (name: string): string => name.replace(fileNameRxp, '')

export const resolvePathWithin = (basePath: string, ...paths: string[]): string => {
  const base = path.resolve(basePath)
  const target = path.resolve(base, ...paths)
  const relative = path.relative(base, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes the permitted directory')
  }
  return target
}

/**
 * Legacy MD5 digest used for sync protocol snapshot keys and user directory IDs.
 * This is not password hashing or an integrity/authentication primitive.
 * @param {*} str
 */
export const toMD5 = (str: string) => crypto.createHash('md5').update(str).digest('hex')

/** Use this for new non-protocol fingerprints that need a modern digest. */
export const toSHA256 = (str: string) => crypto.createHash('sha256').update(str).digest('hex')

export const checkAndCreateDirSync = (path: string) => {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true })
  }
}
