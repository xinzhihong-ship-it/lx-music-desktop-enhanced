declare namespace LX {
  namespace WebDAVSync {
    interface Config {
      url: string
      username: string
      password: string
    }

    interface RemoteFile {
      content: string
      etag: string
      lastModified: string
    }

    type ServiceAction =
      | { action: 'test', data: { config: Config } }
      | { action: 'download', data: { config: Config, path: string } }
      | { action: 'upload', data: { config: Config, path: string, content: string, etag?: string, createOnly?: boolean } }
      | { action: 'backup', data: { content: string } }

    type ServiceResult = RemoteFile | { backupPath: string } | null

    interface UserApiData {
      list: UserApi.UserApiInfo[]
      scripts: Record<string, string>
    }
  }
}
