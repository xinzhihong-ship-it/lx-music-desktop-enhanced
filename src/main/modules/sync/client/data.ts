import fs from 'node:fs'
import { File } from '../../../../common/constants_sync'
import { resolvePathWithin } from '@common/utils/nodejs'
import { exists } from '../utils'


let syncAuthKeys: Record<string, LX.Sync.ClientKeyInfo>


const syncClientDataPath = () => resolvePathWithin(global.lxDataPath, File.clientDataPath)
const syncAuthKeysPath = () => resolvePathWithin(syncClientDataPath(), File.syncAuthKeysJSON)

const saveSyncAuthKeys = async() => {
  return fs.promises.writeFile(syncAuthKeysPath(), JSON.stringify(syncAuthKeys), 'utf8')
}

export const initClientInfo = async() => {
  if (syncAuthKeys != null) return
  const syncAuthKeysFilePath = syncAuthKeysPath()
  if (await fs.promises.stat(syncAuthKeysFilePath).then(() => true).catch(() => false)) {
    // eslint-disable-next-line require-atomic-updates
    syncAuthKeys = JSON.parse((await fs.promises.readFile(syncAuthKeysFilePath)).toString())
  } else {
    // eslint-disable-next-line require-atomic-updates
    syncAuthKeys = {}
    const syncDataPath = syncClientDataPath()
    if (!await exists(syncDataPath)) {
      await fs.promises.mkdir(syncDataPath, { recursive: true })
    }
    void saveSyncAuthKeys()
  }
}

export const getSyncAuthKey = async(serverId: string) => {
  await initClientInfo()
  return syncAuthKeys[serverId] ?? null
}
export const setSyncAuthKey = async(serverId: string, info: LX.Sync.ClientKeyInfo) => {
  await initClientInfo()
  syncAuthKeys[serverId] = info
  void saveSyncAuthKeys()
}

// let syncHost: string
// export const getSyncHost = async() => {
//   if (syncHost === undefined) {
//     const store = getStore(STORE_NAMES.SYNC)
//     syncHost = (store.get('syncHost') as typeof syncHost | null) ?? ''
//   }
//   return syncHost
// }
// export const setSyncHost = async(host: string) => {
//   // let hostInfo = await getData(syncHostPrefix) || {}
//   // hostInfo.host = host
//   // hostInfo.port = port
//   syncHost = host
//   const store = getStore(STORE_NAMES.SYNC)
//   store.set('syncHost', syncHost)
// }
// let syncHostHistory: string[]
// export const getSyncHostHistory = async() => {
//   if (syncHostHistory === undefined) {
//     const store = getStore(STORE_NAMES.SYNC)
//     syncHostHistory = (store.get('syncHostHistory') as string[]) ?? []
//   }
//   return syncHostHistory
// }
// export const addSyncHostHistory = async(host: string) => {
//   let syncHostHistory = await getSyncHostHistory()
//   if (syncHostHistory.some(h => h == host)) return
//   syncHostHistory.unshift(host)
//   if (syncHostHistory.length > 20) syncHostHistory = syncHostHistory.slice(0, 20) // 最多存储20个
//   const store = getStore(STORE_NAMES.SYNC)
//   store.set('syncHostHistory', syncHostHistory)
// }
// export const removeSyncHostHistory = async(index: number) => {
//   syncHostHistory.splice(index, 1)
//   const store = getStore(STORE_NAMES.SYNC)
//   store.set('syncHostHistory', syncHostHistory)
// }
