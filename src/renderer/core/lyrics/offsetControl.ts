// 当前歌曲的歌词偏移：播放详情页右键菜单与桌面歌词工具栏共用。
// 偏移写在歌词原文的 [offset:] 标签里（各视图、桌面歌词、歌词岛、状态栏歌词都从原文读取）：
//   - 改写原文 / 翻译 / 罗马音 / 逐字歌词的标签，立即更新当前歌曲并同步给桌面歌词与歌词岛
//   - 持久化：已绑定歌词来源的歌曲写进绑定（绑定优先于已编辑歌词）；否则存为已编辑歌词，
//     回到原始偏移时删除已编辑歌词
import { debounce } from '@common/utils/common'
import { saveLyricEdited, removeLyricEdited } from '@renderer/utils/ipc'
import { musicInfo as playerMusicInfo, playMusicInfo } from '@renderer/store/player/state'
import { setMusicInfo } from '@renderer/store/player/action'
import { setLyricOffset } from '@renderer/core/lyric'
import { getBinding, setBindingOffset } from './binding'

const OFFSET_TAG_RXP = /(?:^|\n)\s*\[offset:\s*(\S+(?:\d+)*)\s*\]/
const OFFSET_TAG_ALL_RXP = /(^|\n)\s*\[offset:\s*(\S+(?:\d+)*)\s*\]/g

/** 歌词原文里的偏移（毫秒），没有标签为 0 */
export const getLyricOffset = (lrc: string | null | undefined) => {
  const match = (lrc ?? '').match(OFFSET_TAG_RXP)
  if (!match) return 0
  const offset = parseInt(match[1])
  return Number.isNaN(offset) ? 0 : offset
}

interface LyricTexts {
  lyric: string
  tlyric: string | null
  rlyric: string | null
  lxlyric: string | null
}

/** 把偏移写进各份歌词（原文已有标签就替换，没有就加在开头；空的保持为空） */
export const applyLyricOffset = (texts: LyricTexts, offset: number): LyricTexts => {
  const tag = `[offset:${offset}]`
  const hasTag = OFFSET_TAG_RXP.test(texts.lyric)
  const apply = (text: string | null) => {
    if (!text) return text
    return hasTag ? text.replace(OFFSET_TAG_ALL_RXP, `$1${tag}`) : `${tag}\n${text}`
  }
  return {
    lyric: apply(texts.lyric) ?? '',
    tlyric: apply(texts.tlyric),
    rlyric: apply(texts.rlyric),
    lxlyric: apply(texts.lxlyric),
  }
}

type SongInfo = LX.Music.MusicInfo | LX.Download.ListItem

const saveEdited = debounce((musicInfo: LX.Music.MusicInfo, lyricInfo: LyricTexts) => {
  void saveLyricEdited(musicInfo, lyricInfo as LX.Music.LyricInfo)
})
const removeEdited = debounce((musicInfo: LX.Music.MusicInfo) => {
  void removeLyricEdited(musicInfo)
})
const saveBound = debounce((musicInfo: SongInfo, offset: number) => {
  void setBindingOffset(musicInfo, offset)
})

const currentSong = (): LX.Music.MusicInfo | null => {
  const info = playMusicInfo.musicInfo
  if (!info) return null
  return 'progress' in info ? info.metadata.musicInfo : info
}

/** 当前歌曲的原始偏移（未经用户调整的歌词里的标签） */
export const getOriginLyricOffset = () => getLyricOffset(playerMusicInfo.rawlrc)

/** 把当前歌曲的歌词偏移设为 offset（毫秒）。没有歌词时不做任何事，返回 false */
export const setCurrentLyricOffset = async(offset: number): Promise<boolean> => {
  if (!playerMusicInfo.lrc) return false
  offset = Math.round(offset)
  const texts = applyLyricOffset({
    lyric: playerMusicInfo.lrc,
    tlyric: playerMusicInfo.tlrc,
    rlyric: playerMusicInfo.rlrc,
    lxlyric: playerMusicInfo.lxlrc,
  }, offset)
  // 先更新当前歌曲（各视图立即生效），再异步持久化
  setMusicInfo({ lrc: texts.lyric, tlrc: texts.tlyric, rlrc: texts.rlyric, lxlrc: texts.lxlyric })
  setLyricOffset(offset)

  const song = currentSong()
  if (song) {
    const bound = await getBinding(song).catch(() => null)
    if (bound) saveBound(song, offset)
    else if (offset == getOriginLyricOffset()) removeEdited(song)
    else saveEdited(song, texts)
  }
  return true
}

/** 在当前偏移上加减 delta（毫秒） */
export const adjustCurrentLyricOffset = async(delta: number) => setCurrentLyricOffset(getLyricOffset(playerMusicInfo.lrc) + delta)

/** 恢复原始偏移 */
export const resetCurrentLyricOffset = async() => setCurrentLyricOffset(getOriginLyricOffset())
