import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { createLocalBackup, downloadFile, testConnection, uploadFile } from '@main/modules/webdav'

export default () => {
  mainHandle<LX.WebDAVSync.ServiceAction, LX.WebDAVSync.ServiceResult>(WIN_MAIN_RENDERER_EVENT_NAME.webdav_action, async({ params }) => {
    switch (params.action) {
      case 'test':
        await testConnection(params.data.config)
        return null
      case 'download':
        return downloadFile(params.data.config, params.data.path)
      case 'upload':
        return uploadFile(params.data.config, params.data.path, params.data.content, params.data)
      case 'backup':
        return { backupPath: await createLocalBackup(params.data.content) }
    }
  })
}
