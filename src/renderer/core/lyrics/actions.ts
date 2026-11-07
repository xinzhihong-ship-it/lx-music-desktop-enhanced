// 歌词绑定相关的用户操作：绑定 / 解绑 / 调整偏移后立即刷新当前播放歌曲的歌词。
import { getLyricInfo } from '@renderer/core/music'
import { playMusicInfo } from '@renderer/store/player/state'
import { setMusicInfo } from '@renderer/store/player/action'
import { bindLyric, setBindingOffset, unbindLyric } from './binding'
import type { LyricCandidate } from './search'

type AnyMusicInfo = LX.Music.MusicInfo | LX.Download.ListItem

const isCurrent = (musicInfo: AnyMusicInfo) => playMusicInfo.musicInfo?.id == musicInfo.id

/** 重新获取 musicInfo 的歌词；它仍是当前播放歌曲时更新播放器 */
export const reloadLyric = async(musicInfo: AnyMusicInfo, isRefresh = false) => {
  const lyricInfo = await getLyricInfo({ musicInfo, isRefresh })
  if (!isCurrent(musicInfo)) return
  setMusicInfo({
    lrc: lyricInfo.lyric,
    tlrc: lyricInfo.tlyric,
    lxlrc: lyricInfo.lxlyric,
    rlrc: lyricInfo.rlyric,
    rawlrc: lyricInfo.rawlrcInfo.lyric,
  })
  window.app_event.lyricUpdated()
}

export const applyLyricCandidate = async(musicInfo: AnyMusicInfo, candidate: LyricCandidate, offset = 0) => {
  await bindLyric(musicInfo, candidate, offset)
  await reloadLyric(musicInfo)
}

export const changeBoundLyricOffset = async(musicInfo: AnyMusicInfo, offset: number) => {
  if (await setBindingOffset(musicInfo, offset)) await reloadLyric(musicInfo)
}

/** 恢复自动匹配：删除绑定并重新获取 */
export const restoreAutoLyric = async(musicInfo: AnyMusicInfo) => {
  await unbindLyric(musicInfo)
  await reloadLyric(musicInfo, true)
}
