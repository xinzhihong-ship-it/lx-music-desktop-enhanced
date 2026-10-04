import type { PlatformPlaylistDestination } from '@renderer/store/account'

interface PlaylistChange {
  action: 'add' | 'remove'
  musicInfo: LX.Music.MusicInfoOnline
  revision: number
}

const playlistKey = (destination: PlatformPlaylistDestination) =>
  `${destination.account.id}:${destination.playlist.id}`

const trackKey = (musicInfo: LX.Music.MusicInfoOnline) => musicInfo.source === 'kg'
  ? String(musicInfo.meta.hash ?? '').trim().toLowerCase()
  : String(musicInfo.meta.songId ?? '')

// 只记录已经成功的云端写操作，在读取接口仍返回旧缓存时保留本地结果。
const pendingChanges = new Map<string, Map<string, PlaylistChange>>()

export const recordPlaylistChange = (
  destination: PlatformPlaylistDestination,
  musicList: LX.Music.MusicInfoOnline[],
  action: PlaylistChange['action'],
  revision: number,
) => {
  const key = playlistKey(destination)
  const changes = pendingChanges.get(key) ?? new Map<string, PlaylistChange>()
  for (const musicInfo of musicList) {
    const id = trackKey(musicInfo)
    if (id) changes.set(id, { action, musicInfo, revision })
  }
  pendingChanges.set(key, changes)
}

export const applyPlaylistChanges = (
  destination: PlatformPlaylistDestination,
  cloudSongs: LX.Music.MusicInfoOnline[],
  readRevision?: number,
): LX.Music.MusicInfoOnline[] => {
  const key = playlistKey(destination)
  const changes = pendingChanges.get(key)
  if (!changes?.size) return cloudSongs
  const cloudIds = new Set(cloudSongs.map(trackKey))
  // 读取开始之前的操作才可被该次结果确认，旧请求不能清掉刚完成的变更。
  if (readRevision != null) {
    for (const [id, change] of changes) {
      const confirmed = change.action === 'add' ? cloudIds.has(id) : !cloudIds.has(id)
      if (change.revision <= readRevision && confirmed) changes.delete(id)
    }
  }
  const additions = [...changes.entries()]
    .filter(([id, change]) => change.action === 'add' && !cloudIds.has(id))
    .reverse()
    .map(([, change]) => {
      const musicInfo: LX.Music.MusicInfoOnline = { ...change.musicInfo }
      musicInfo.meta = { ...musicInfo.meta }
      musicInfo.meta.accountTrackId = undefined
      return musicInfo
    })
  const songs = cloudSongs.filter(song => changes.get(trackKey(song))?.action !== 'remove')
  if (!changes.size) pendingChanges.delete(key)
  return [...additions, ...songs]
}
