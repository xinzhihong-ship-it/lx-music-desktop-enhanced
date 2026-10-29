import { reactive, shallowReactive, ref } from '@common/utils/vueTools'

export interface PlayerMusicInfo {
  id: string | null
  pic: string | null
  lrc: string | null
  tlrc: string | null
  rlrc: string | null
  lxlrc: string | null
  rawlrc: string | null
  // url: string | null
  name: string
  singer: string
  album: string
}

export const musicInfo = window.lxData.musicInfo = reactive<PlayerMusicInfo>({
  id: null,
  pic: null,
  lrc: null,
  tlrc: null,
  rlrc: null,
  lxlrc: null,
  rawlrc: null,
  // url: null,
  name: '',
  singer: '',
  album: '',
})

export const isPlay = ref(false)

export const status = window.lxData.status = ref('')

export const statusText = ref('')

export const isShowPlayerDetail = ref(false)

export const isShowPlayComment = ref(false)

export const isShowLrcSelectContent = ref(false)

// 当前请求的播放音质（如 128k / 320k / flac / 本地 / 下载）
export const playQuality = ref('')

// 探测到的实际播放档位，为空时显示请求档位。实测不改写请求档位，
// 确认降质时由播放器触发恢复，继续尝试原目标音质的其他组合。
export const playQualityActual = ref('')

// Temporary playback source, independent of the song stored in the playlist.
export const playSource = ref<LX.Source | null>(null)

export const playMusicInfo = shallowReactive<{
  /**
   * 当前播放歌曲的列表 id
   */
  musicInfo: LX.Player.PlayMusicInfo['musicInfo'] | null
  /**
   * 当前播放歌曲的列表 id
   */
  listId: LX.Player.PlayMusicInfo['listId'] | null
  /**
   * 是否属于 “稍后播放”
   */
  isTempPlay: boolean
}>({
  listId: null,
  musicInfo: null,
  isTempPlay: false,
})
export const playInfo = shallowReactive<LX.Player.PlayInfo>({
  playIndex: -1,
  playerListId: null,
  playerPlayIndex: -1,
})


export const playedList = window.lxData.playedList = shallowReactive<LX.Player.PlayMusicInfo[]>([])

export const tempPlayList = shallowReactive<LX.Player.PlayMusicInfo[]>([])

window.lxData.playInfo = playInfo
window.lxData.playMusicInfo = playMusicInfo
