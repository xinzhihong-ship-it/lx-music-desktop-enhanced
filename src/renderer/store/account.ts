import { ref, computed } from '@common/utils/vueTools'
import {
  addAccountPlaylistTracks,
  getAccountPlaylists,
  getAccounts,
  removeAccount as ipcRemoveAccount,
  removeAccountPlaylistTracks,
} from '@renderer/utils/ipc'
import { clearAccountCookieCache } from '@renderer/utils/musicSdk/bili/util'

export interface PlatformPlaylistDestination {
  account: LX.Account.PlatformAccount
  playlist: LX.Account.PlaylistInfo
}

export const accounts = ref<LX.Account.PlatformAccount[]>([])
export const currentAccountId = ref<string | null>(null)

export const currentAccount = computed(() =>
  accounts.value.find(a => a.id === currentAccountId.value) ?? null,
)

export const loadAccounts = async() => {
  accounts.value = await getAccounts()
  // 账号变化（登录/退出）后立即使 B 站请求用上新登录态
  clearAccountCookieCache()
}

export const removeAccount = async(id: string) => {
  await ipcRemoveAccount(id)
  if (currentAccountId.value === id) currentAccountId.value = null
  await loadAccounts()
}

export const setCurrentAccount = (id: string | null) => {
  currentAccountId.value = id
}

const isAccountSource = (source: LX.Source): source is LX.Account.Source => {
  return source == 'wy' || source == 'tx' || source == 'kg' || source == 'bili'
}

export const getEditablePlatformPlaylists = async(source: LX.Source): Promise<PlatformPlaylistDestination[]> => {
  if (!isAccountSource(source)) return []
  await loadAccounts()
  const sourceAccounts = accounts.value.filter(account => account.source == source && account.isLogin)
  const results = await Promise.allSettled(sourceAccounts.map(async account => {
    const playlists = await getAccountPlaylists(account.id)
    return playlists.filter(playlist => playlist.isEditable).map(playlist => ({ account, playlist }))
  }))
  return results.flatMap(result => result.status == 'fulfilled' ? result.value : [])
}

const toPlaylistMutationTrack = (musicInfo: LX.Music.MusicInfoOnline): LX.Account.PlaylistMutationTrack => {
  if (!isAccountSource(musicInfo.source)) throw new Error('不支持将该来源歌曲添加到平台歌单')
  // B 站收藏夹操作使用视频 aid（存于 platformData）
  const biliAid = musicInfo.source == 'bili'
    ? String(musicInfo.meta.platformData?.aid ?? musicInfo.meta.songId)
    : null
  return {
    source: musicInfo.source,
    songId: biliAid ?? String(musicInfo.meta.songId),
    platformId: musicInfo.source == 'tx'
      ? musicInfo.meta.id == null ? undefined : String(musicInfo.meta.id)
      : musicInfo.meta.accountTrackId,
    name: musicInfo.name,
    hash: musicInfo.source == 'kg' ? musicInfo.meta.hash : undefined,
    albumId: musicInfo.meta.albumId == null ? undefined : String(musicInfo.meta.albumId),
  }
}

const toMutationRequest = (
  destination: PlatformPlaylistDestination,
  musicList: LX.Music.MusicInfoOnline[],
): LX.Account.PlaylistMutationRequest => ({
  accountId: destination.account.id,
  playlistId: destination.playlist.id,
  dirId: destination.playlist.dirId,
  tracks: musicList.map(toPlaylistMutationTrack),
})

export const addToPlatformPlaylist = async(
  destination: PlatformPlaylistDestination,
  musicList: LX.Music.MusicInfoOnline[],
) => {
  await addAccountPlaylistTracks(toMutationRequest(destination, musicList))
}

export const removeFromPlatformPlaylist = async(
  destination: PlatformPlaylistDestination,
  musicList: LX.Music.MusicInfoOnline[],
) => {
  await removeAccountPlaylistTracks(toMutationRequest(destination, musicList))
}
