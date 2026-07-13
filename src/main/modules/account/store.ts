import { safeStorage } from 'electron'
import { STORE_NAMES } from '@common/constants'
import getStore from '@main/utils/store'

const ACCOUNTS_KEY = 'accounts'
let accountStore: ReturnType<typeof getStore> | null = null
const getAccountStore = () => {
  if (!accountStore) accountStore = getStore(STORE_NAMES.ACCOUNT_SESSIONS)
  return accountStore
}

const encrypt = (text: string): LX.Account.EncryptedSession => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用')
  const buffer = safeStorage.encryptString(text)
  return {
    data: buffer.toString('base64'),
  }
}

const decrypt = (encrypted: LX.Account.EncryptedSession): string => {
  return safeStorage.decryptString(Buffer.from(encrypted.data, 'base64'))
}

export const listAccounts = (): LX.Account.PlatformAccount[] => {
  return getAccountStore().get<LX.Account.PlatformAccount[]>(ACCOUNTS_KEY) ?? []
}

export const saveAccount = (account: LX.Account.PlatformAccount, session: LX.Account.LoginSession) => {
  const encryptedSession = encrypt(JSON.stringify(session))
  const accounts = listAccounts()
  const index = accounts.findIndex(a => a.id === account.id)
  if (index > -1) {
    accounts[index] = account
  } else {
    accounts.push(account)
  }
  const store = getAccountStore()
  store.set(ACCOUNTS_KEY, accounts)
  store.set(`session:${account.id}`, encryptedSession)
}

export const removeAccount = (id: string) => {
  const accounts = listAccounts().filter(a => a.id !== id)
  const store = getAccountStore()
  store.set(ACCOUNTS_KEY, accounts)
  store.delete(`session:${id}`)
}

export const getSession = (id: string): LX.Account.LoginSession | null => {
  const encrypted = getAccountStore().get<LX.Account.EncryptedSession>(`session:${id}`)
  if (!encrypted) return null
  try {
    return JSON.parse(decrypt(encrypted))
  } catch (err) {
    console.error('[accountStore] failed to decrypt session:', err)
    return null
  }
}
