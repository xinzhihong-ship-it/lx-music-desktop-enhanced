import { SYNC_CLOSE_CODE } from '@common/constants_sync'
import { registerListActionEvent } from '../../../../listEvent'
import { getUserSpace } from '../../../user'
import { toMobileListAction } from '../compatibility'

// let socket: LX.Sync.Server.Socket | null
let unregisterLocalListAction: (() => void) | null


const sendListAction = async(wss: LX.Sync.Server.SocketServer, action: LX.Sync.List.ActionList) => {
  // console.log('sendListAction', action.action)
  const userSpace = getUserSpace()
  let key = ''
  // 只在存在移动端时计算一次（位置换算需要读取本地列表）
  let mobileAction: Promise<LX.Sync.List.ActionList | null> | null = null
  for (const client of wss.clients) {
    if (!client.moduleReadys?.list) continue
    // eslint-disable-next-line require-atomic-updates
    if (!key) key = await userSpace.listManage.createSnapshot()
    mobileAction ??= client.keyInfo.isMobile ? toMobileListAction(action) : null
    const clientAction = client.keyInfo.isMobile ? await mobileAction : action
    if (!clientAction) {
      void userSpace.listManage.updateDeviceSnapshotKey(client.keyInfo.clientId, key)
      continue
    }
    void client.remoteQueueList.onListSyncAction(clientAction).then(async() => {
      return userSpace.listManage.updateDeviceSnapshotKey(client.keyInfo.clientId, key)
    }).catch(err => {
      // TODO send status
      client.close(SYNC_CLOSE_CODE.failed)
      // client.moduleReadys.list = false
      console.log(err.message)
    })
  }
}

export const registerEvent = (wss: LX.Sync.Server.SocketServer) => {
  // socket = _socket
  // socket.onClose(() => {
  //   unregisterLocalListAction?.()
  //   unregisterLocalListAction = null
  // })
  unregisterEvent()
  unregisterLocalListAction = registerListActionEvent((action) => {
    void sendListAction(wss, action)
  })
}

export const unregisterEvent = () => {
  unregisterLocalListAction?.()
  unregisterLocalListAction = null
}
