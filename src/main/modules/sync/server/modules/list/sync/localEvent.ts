import { SYNC_CLOSE_CODE } from '@common/constants_sync'
import { registerListActionEvent } from '../../../../listEvent'
import { getUserSpace } from '../../../user'
import { primeDesktopOnlyListCache, toMobileListAction } from '../compatibility'

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
  // 发给各客户端的 remoteQueueList 按「调用先后」排队；sendListAction 内部有读库等异步步骤，
  // 若并发执行，后发生的操作可能先被调用、先发出。这里串成队列：上一个操作对所有客户端完成调用
  // （只等调用发出，不等对端响应）后才处理下一个，保证同一客户端收到的顺序与本地发生顺序一致。
  // 队列首项预热 B 站歌单缓存，保证启动后第一次删除 B 站歌单也能识别。
  let sendQueue: Promise<void> = primeDesktopOnlyListCache().catch(err => {
    console.log('prime desktop-only list cache failed:', err?.message ?? err)
  })
  unregisterLocalListAction = registerListActionEvent((action) => {
    sendQueue = sendQueue.then(async() => sendListAction(wss, action)).catch(err => {
      // 单个操作失败不能阻断后续操作的发送
      console.log('send list action failed:', err?.message ?? err)
    })
  })
}

export const unregisterEvent = () => {
  unregisterLocalListAction?.()
  unregisterLocalListAction = null
}
