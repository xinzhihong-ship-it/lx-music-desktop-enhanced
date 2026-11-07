// 歌词来源绑定：用户在搜索面板里为某首歌选定的歌词（平台 + 歌曲），以及本首的偏移。
// 取词时绑定优先于一切其他来源（见 core/music/index.ts getLyricInfo）。
import { getLyricBinding, removeLyricBinding, saveLyricBinding } from '@renderer/utils/ipc'
import { parseDuration, setLrcOffsetTag, type MatchSubject } from '@common/utils/lyrics'
import { fetchCandidateLyric, isLyricPlatform, type LyricCandidate } from './search'

type AnyMusicInfo = LX.Music.MusicInfo | LX.Download.ListItem

/** 绑定按“歌曲本身”记录：下载列表项取它对应的在线歌曲 */
export const getSongMusicInfo = (musicInfo: AnyMusicInfo): LX.Music.MusicInfo => 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo

export const getSongKey = (musicInfo: AnyMusicInfo) => getSongMusicInfo(musicInfo).id

export const getMatchSubject = (musicInfo: AnyMusicInfo): MatchSubject => {
  const info = getSongMusicInfo(musicInfo)
  return {
    name: info.name ?? '',
    singer: info.singer ?? '',
    album: info.meta?.albumName ?? '',
    duration: parseDuration(info.interval),
  }
}

/** 歌曲所在的歌词平台（本地 / B 站等返回 undefined） */
export const getSongPlatform = (musicInfo: AnyMusicInfo) => {
  const source = getSongMusicInfo(musicInfo).source
  return isLyricPlatform(source) ? source : undefined
}

export const bindingToCandidate = (binding: LX.Music.LyricBinding) => ({
  key: `${binding.platform}_${binding.songmid}`,
  platform: binding.platform as LyricCandidate['platform'],
  musicInfo: binding.musicInfo,
})

/** 把偏移写进 [offset:] 标签（逐字歌词与普通歌词都写，显示层用哪个都生效） */
export const applyLyricOffset = (lyricInfo: LX.Music.LyricInfo, offset: number): LX.Music.LyricInfo => {
  if (!offset) return lyricInfo
  return {
    ...lyricInfo,
    lyric: setLrcOffsetTag(lyricInfo.lyric, offset),
    lxlyric: lyricInfo.lxlyric ? setLrcOffsetTag(lyricInfo.lxlyric, offset) : lyricInfo.lxlyric,
  }
}

/** 读取并加载绑定的歌词；没有绑定返回 null，绑定的歌词取不到时抛错（由调用方回退到常规来源） */
export const loadBoundLyric = async(musicInfo: AnyMusicInfo, isRefresh = false): Promise<{ binding: LX.Music.LyricBinding, lyricInfo: LX.Music.LyricInfo } | null> => {
  const binding = await getLyricBinding(getSongKey(musicInfo))
  if (!binding || !isLyricPlatform(binding.platform)) return null
  const lyricInfo = await fetchCandidateLyric(bindingToCandidate(binding), { useCache: !isRefresh })
  return { binding, lyricInfo: applyLyricOffset(lyricInfo, binding.offset) }
}

export const createBinding = (candidate: LyricCandidate, offset = 0): LX.Music.LyricBinding => ({
  platform: candidate.platform,
  songmid: candidate.songmid,
  name: candidate.name,
  singer: candidate.singer,
  album: candidate.album,
  interval: candidate.interval,
  musicInfo: candidate.musicInfo,
  offset: Math.round(offset),
  updatedAt: Date.now(),
})

export const bindLyric = async(musicInfo: AnyMusicInfo, candidate: LyricCandidate, offset = 0) => {
  await saveLyricBinding(getSongKey(musicInfo), createBinding(candidate, offset))
}

export const setBindingOffset = async(musicInfo: AnyMusicInfo, offset: number) => {
  const key = getSongKey(musicInfo)
  const binding = await getLyricBinding(key)
  if (!binding) return false
  await saveLyricBinding(key, { ...binding, offset: Math.round(offset), updatedAt: Date.now() })
  return true
}

export const getBinding = async(musicInfo: AnyMusicInfo) => getLyricBinding(getSongKey(musicInfo))

export const unbindLyric = async(musicInfo: AnyMusicInfo) => {
  await removeLyricBinding(getSongKey(musicInfo))
}
