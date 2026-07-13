import * as accountStore from './store'

const inMemorySessions = new Map<string, LX.Account.LoginSession>()

export const loadAccounts = () => {
  const accounts = accountStore.listAccounts()
  for (const account of accounts) {
    const session = accountStore.getSession(account.id)
    if (session) inMemorySessions.set(account.id, session)
  }
  return accounts
}

export const listAccounts = (): LX.Account.PlatformAccount[] => {
  return accountStore.listAccounts().map(account => ({
    ...account,
    isLogin: inMemorySessions.has(account.id),
  }))
}

export const saveAccount = (account: LX.Account.PlatformAccount, session: LX.Account.LoginSession) => {
  accountStore.saveAccount(account, session)
  inMemorySessions.set(account.id, session)
}

export const removeAccount = (id: string) => {
  accountStore.removeAccount(id)
  inMemorySessions.delete(id)
}

export const getSession = (id: string): LX.Account.LoginSession | null => {
  if (inMemorySessions.has(id)) return inMemorySessions.get(id)!
  const session = accountStore.getSession(id)
  if (session) inMemorySessions.set(id, session)
  return session
}

export const updateSession = (id: string, session: LX.Account.LoginSession) => {
  const accounts = accountStore.listAccounts()
  if (!accounts.some(a => a.id === id)) return
  accountStore.saveAccount(accounts.find(a => a.id === id)!, session)
  inMemorySessions.set(id, session)
}
