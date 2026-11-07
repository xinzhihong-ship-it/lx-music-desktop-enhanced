// if (targetSong.key) { // 如果是已下载的歌曲
//   const filePath = path.join(appSetting['download.savePath'], targetSong.metadata.fileName)
//   // console.log(filePath)

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getMusicUrl as getDownloadMusicUrl,
  getPicUrl as getDownloadPicUrl,
  getLyricInfo as getDownloadLyricInfo,
} from './download'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'
import { buildLyricInfo } from './utils'
import { saveLyric } from '@renderer/utils/ipc'
import { hasTimedLyric } from '@common/utils/lyrics'
import { getMatchSubject, getSongKey, getSongMusicInfo, getSongPlatform, loadBoundLyric } from '@renderer/core/lyrics/binding'
import { autoMatchLyric } from '@renderer/core/lyrics/search'


export const getMusicUrl = async({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  allowToggleSource,
  forceToggleSource,
  strictQuality,
  onResolvedQuality,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
  forceToggleSource?: boolean
  strictQuality?: boolean
  onResolvedQuality?: (quality: LX.Quality) => void
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return getDownloadMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  } else {
    return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, allowToggleSource, forceToggleSource, strictQuality, onResolvedQuality })
  }
}

export const getPicPath = async({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return getDownloadPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else {
    return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  }
}

const getSourceLyricInfo = async({
  musicInfo,
  isRefresh,
  onToggleSource,
  allowToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<LX.Player.LyricInfo> => {
  if ('progress' in musicInfo) {
    return getDownloadLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else {
    return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  }
}

// 本次运行中自动跨平台匹配也没找到歌词的歌曲，避免每次播放都重新搜索五个平台
const autoMatchMissed = new Set<string>()

/** 原有来源都没有带时间戳的歌词时，按歌名 / 歌手 / 时长在其他平台自动匹配（≥ AUTO_MATCH_SCORE 才采用） */
const autoMatchLyricInfo = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh: boolean): Promise<LX.Player.LyricInfo | null> => {
  const songKey = getSongKey(musicInfo)
  if (!isRefresh && autoMatchMissed.has(songKey)) return null
  const matched = await autoMatchLyric(getMatchSubject(musicInfo), getSongPlatform(musicInfo)).catch((err: unknown) => {
    console.warn('lyric auto match failed', err)
    return null
  })
  if (!matched) {
    autoMatchMissed.add(songKey)
    return null
  }
  autoMatchMissed.delete(songKey)
  // 按歌曲本身缓存，下次直接命中，不再搜索
  void saveLyric(getSongMusicInfo(musicInfo), matched.lyricInfo).catch(() => {})
  return buildLyricInfo(matched.lyricInfo)
}

/**
 * 取歌词。优先级：用户绑定 → 原有来源（已编辑 / 缓存 / 本平台 / 文件 / 原有换源）→ 自动跨平台匹配。
 */
/**
 * 歌曲的歌词：用户绑定的歌词 → 歌曲所属来源 → 跨平台自动匹配。播放与下载写词共用。
 * allowToggleSource：所属来源取不到时是否允许换源（下载按“使用其他源”设置）
 */
export const getLyricInfo = async({
  musicInfo,
  isRefresh = false,
  onToggleSource,
  allowToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<LX.Player.LyricInfo> => {
  try {
    const bound = await loadBoundLyric(musicInfo, isRefresh)
    if (bound) return await buildLyricInfo(bound.lyricInfo)
  } catch (err) {
    // 绑定的歌词暂时取不到（网络 / 接口变动）：本次回退到常规来源，绑定保留
    console.warn('bound lyric unavailable, falling back', err)
  }

  let lyricInfo: LX.Player.LyricInfo | null = null
  let error: unknown = null
  try {
    lyricInfo = await getSourceLyricInfo({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  } catch (err) {
    error = err
  }
  if (lyricInfo && hasTimedLyric(lyricInfo.lyric)) return lyricInfo

  const matched = await autoMatchLyricInfo(musicInfo, isRefresh)
  if (matched) return matched
  if (lyricInfo) return lyricInfo
  throw error instanceof Error ? error : new Error(error == null ? 'lyric not found' : String(error))
}
