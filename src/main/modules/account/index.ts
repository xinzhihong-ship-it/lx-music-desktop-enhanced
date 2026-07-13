import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import * as sessions from './sessions'
import * as kgProvider from './providers/kg'
import * as txProvider from './providers/tx'
import * as wyProvider from './providers/wy'

let isInitialized = false

const providers = {
  kg: kgProvider,
  tx: txProvider,
  wy: wyProvider,
}

export default () => {
  if (isInitialized) return
  isInitialized = true

  sessions.loadAccounts()

  mainHandle<LX.Account.PlatformAccount[]>(WIN_MAIN_RENDERER_EVENT_NAME.account_list, async() => {
    return sessions.listAccounts()
  })

  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.account_remove, async({ params: id }) => {
    sessions.removeAccount(id)
  })

  mainHandle<LX.Account.LoginRequest, LX.Account.PlatformAccount>(WIN_MAIN_RENDERER_EVENT_NAME.account_login, async({ params }) => {
    if (params.method !== 'cookie' || !params.cookie) throw new Error('当前登录方式不可用')
    const result = await providers[params.source].loginByCookie(params.cookie)
    sessions.saveAccount(result.account, result.session)
    return result.account
  })

  mainHandle<LX.Account.Source, LX.Account.QrCodeLoginState>(WIN_MAIN_RENDERER_EVENT_NAME.account_qr_create, async({ params: source }) => {
    return providers[source].createQrCode()
  })

  mainHandle<{ source: LX.Account.Source, requestId: string }, LX.Account.QrCodeLoginResult>(WIN_MAIN_RENDERER_EVENT_NAME.account_qr_check, async({ params }) => {
    const result = await providers[params.source].checkQrCodeStatus(params.requestId)
    if (result.account && result.session) sessions.saveAccount(result.account, result.session)
    const { session, ...publicResult } = result
    return publicResult
  })

  mainHandle<string, LX.Account.PlaylistInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.account_playlists, async({ params: accountId }) => {
    const session = sessions.getSession(accountId)
    if (!session) throw new Error('账号登录状态不存在或已失效')
    return providers[session.source].getUserPlaylists(session)
  })

  mainHandle<{ accountId: string, playlistId: string, dirId?: string }, LX.Account.PlaylistTrackInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.account_playlist_tracks, async({ params }) => {
    const session = sessions.getSession(params.accountId)
    if (!session) throw new Error('账号登录状态不存在或已失效')
    return providers[session.source].getPlaylistTrackIds(session, params.playlistId, params.dirId)
  })

  mainHandle<LX.Account.PlaylistMutationRequest>(WIN_MAIN_RENDERER_EVENT_NAME.account_playlist_add_tracks, async({ params }) => {
    const session = sessions.getSession(params.accountId)
    if (!session) throw new Error('账号登录状态不存在或已失效')
    if (params.tracks.some(track => track.source !== session.source)) throw new Error('歌曲来源与目标平台不一致')
    await providers[session.source].addPlaylistTracks(session, params.playlistId, params.dirId, params.tracks)
  })

  mainHandle<LX.Account.PlaylistMutationRequest>(WIN_MAIN_RENDERER_EVENT_NAME.account_playlist_remove_tracks, async({ params }) => {
    const session = sessions.getSession(params.accountId)
    if (!session) throw new Error('账号登录状态不存在或已失效')
    if (params.tracks.some(track => track.source !== session.source)) throw new Error('歌曲来源与目标平台不一致')
    await providers[session.source].removePlaylistTracks(session, params.playlistId, params.dirId, params.tracks)
  })

  mainHandle<string, string[]>(WIN_MAIN_RENDERER_EVENT_NAME.account_daily_tracks, async({ params: accountId }) => {
    const session = sessions.getSession(accountId)
    if (!session) throw new Error('账号登录状态不存在或已失效')
    return providers[session.source].getDailyTrackIds(session)
  })
}
