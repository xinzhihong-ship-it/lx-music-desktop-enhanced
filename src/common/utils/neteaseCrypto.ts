import { constants, createCipheriv, createDecipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto'

const iv = Buffer.from('0102030405060708')
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud')
const linuxapiKey = Buffer.from('rFgB&h#%2?^eDg:Q')
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const actualPublicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const eapiKey = 'e82ckenh8dichen8'

const aesEncrypt = (buffer: Buffer, mode: string, key: Buffer | string, initializationVector: Buffer | string) => {
  const cipher = createCipheriv(mode, key, initializationVector)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
}

const aesDecrypt = (buffer: Buffer, mode: string, key: Buffer | string, initializationVector: Buffer | string) => {
  const decipher = createDecipheriv(mode, key, initializationVector)
  return Buffer.concat([decipher.update(buffer), decipher.final()])
}

const rsaEncrypt = (buffer: Buffer) => {
  const padded = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
  return publicEncrypt({ key: actualPublicKey, padding: constants.RSA_NO_PADDING }, padded)
}

export const weapi = (value: Record<string, unknown>): Record<string, string> => {
  const text = JSON.stringify(value)
  const secretKey = Buffer.from(randomBytes(16).map(byte => base62.charAt(byte % 62).charCodeAt(0)))
  const firstPass = aesEncrypt(Buffer.from(text), 'aes-128-cbc', presetKey, iv).toString('base64')
  return {
    params: aesEncrypt(Buffer.from(firstPass), 'aes-128-cbc', secretKey, iv).toString('base64'),
    encSecKey: rsaEncrypt(secretKey.reverse()).toString('hex'),
  }
}

export const linuxapi = (value: Record<string, unknown>): Record<string, string> => ({
  eparams: aesEncrypt(Buffer.from(JSON.stringify(value)), 'aes-128-ecb', linuxapiKey, '').toString('hex').toUpperCase(),
})

export const eapi = (url: string, value: Record<string, unknown> | string): Record<string, string> => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const digest = createHash('md5').update(`nobody${url}use${text}md5forencrypt`).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return {
    params: aesEncrypt(Buffer.from(data), 'aes-128-ecb', eapiKey, '').toString('hex').toUpperCase(),
  }
}

export const eapiDecrypt = (buffer: Buffer): string => {
  return aesDecrypt(buffer, 'aes-128-ecb', eapiKey, '').toString()
}
