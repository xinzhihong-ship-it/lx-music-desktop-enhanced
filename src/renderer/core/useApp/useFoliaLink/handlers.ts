// 「Folia 对接」在渲染进程里执行的接口：主进程（main/modules/foliaLink）校验过参数后转来，这里只调用本软件已有的
// 搜索、歌单、列表、播放函数，行为与在本软件界面里操作一致（例如在 Folia 里播放搜索结果，和在搜索页双击一样进「试听列表」）。
import { LIST_IDS } from '@common/constants'
import { similar, sortInsert } from '@common/utils/common'
import musicSdk from '@renderer/utils/musicSdk'
import { deduplicationList, toMD5, toNewMusicInfo } from '@renderer/utils'
import { assertApiSupport } from '@renderer/store/utils'
import { qualityList } from '@renderer/store'
import { appSetting, setTogglePlayMode, updateSetting } from '@renderer/store/setting'
import { tempListMeta, userLists } from '@renderer/store/list/state'
import { addListMusics, createUserList, getListMusics, setTempList } from '@renderer/store/list/action'
import { getListDetail, getListDetailAll } from '@renderer/store/songList/action'
import { isPlay, playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { addTempPlayList, getList } from '@renderer/store/player/action'
import { pause, play, playList, playListById, playNext, playPrev, setMusicUrl, setShouldPlayAfterLoad, togglePlay } from '@renderer/core/player'
import { setStop } from '@renderer/plugins/player'
import { getLyricInfo, getPicPath } from '@renderer/core/music'

/** 单个平台一页的条数，与本软件搜索页一致 */
const SEARCH_LIMIT = 30

class FoliaLinkError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

type AnyMusicInfo = LX.Music.MusicInfo | LX.Download.ListItem

/** 下载列表里的条目换成它对应的歌曲信息 */
export const toMusicInfo = (info: AnyMusicInfo | null | undefined): LX.Music.MusicInfo | null => {
  if (!info) return null
  return 'progress' in info ? info.metadata.musicInfo : info
}

const searchSources = (): LX.OnlineSource[] => musicSdk.sources
  .filter((source: { id: string }) => (musicSdk as any)[source.id]?.musicSearch)
  .map((source: { id: string }) => source.id as LX.OnlineSource)

/** 按与关键词的相似度排序（本软件「全部」搜索的做法） */
const sortByKeyword = (list: LX.Music.MusicInfo[], keyword: string) => {
  const arr: Array<{ num: number, data: LX.Music.MusicInfo }> = []
  for (const item of list) sortInsert(arr, { num: similar(keyword, `${item.name} ${item.singer}`), data: item })
  return arr.map(item => item.data).reverse()
}

const assertPlayable = (musicInfo: LX.Music.MusicInfo) => {
  if (musicInfo.source == 'local') return
  if (!assertApiSupport(musicInfo.source)) throw new FoliaLinkError('not-playable', `No playable source for ${musicInfo.source}`)
}

const songListKey = (id: string, source: string) => `${source}__${id}`

const handlers: Record<string, (params: any) => Promise<unknown> | unknown> = {
  info() {
    return {
      sources: musicSdk.sources.map((source: { id: string, name: string }) => ({
        id: source.id,
        name: source.name,
        search: !!(musicSdk as any)[source.id]?.musicSearch,
        songList: !!(musicSdk as any)[source.id]?.songList,
        playable: qualityList.value[source.id as LX.OnlineSource] != null,
      })),
      quality: appSetting['player.playQuality'],
    }
  },

  async search({ text, source, page }: { text: string, source: string, page: number }) {
    if (source == 'all') {
      const results = await Promise.all(searchSources().map(async id => (musicSdk as any)[id].musicSearch.search(text, page, SEARCH_LIMIT).catch((err: unknown) => {
        console.log('[FoliaLink] search failed', id, err)
        return { list: [], allPage: 0, total: 0, limit: SEARCH_LIMIT, source: id }
      })))
      let maxPage = 0
      let total = 0
      const list: any[] = []
      for (const result of results) {
        maxPage = Math.max(maxPage, result.allPage ?? 0)
        total = Math.max(total, result.total ?? 0)
        if ((result.allPage ?? 0) >= page) list.push(...result.list)
      }
      return { list: sortByKeyword(deduplicationList(list.map(item => toNewMusicInfo(item))), text), page, maxPage, total }
    }
    const sdk = (musicSdk as any)[source]
    if (!sdk?.musicSearch) throw new FoliaLinkError('invalid-params', `Cannot search ${source}`)
    const result = await sdk.musicSearch.search(text, page, SEARCH_LIMIT)
    return { list: deduplicationList(result.list.map((item: any) => toNewMusicInfo(item))), page, maxPage: result.allPage ?? 0, total: result.total ?? 0 }
  },

  async songlistDetail({ text, source, page }: { text: string, source: LX.OnlineSource, page: number }) {
    const result = await getListDetail(text, source, page)
    return { source, id: text, info: result.info, list: result.list, page: result.page, limit: result.limit, total: result.total }
  },

  async songlistAll({ text, source }: { text: string, source: LX.OnlineSource }) {
    return { source, id: text, list: await getListDetailAll(text, source) }
  },

  /** 收藏分享歌单：在我的列表里新建一个，照歌单详情页的「收藏」；已收藏过就回那个列表 */
  async songlistCollect({ text, source, name }: { text: string, source: LX.OnlineSource, name?: string }) {
    const listId = `${source}_${toMD5(songListKey(text, source))}`
    const existing = userLists.find(list => list.id == listId || (list.source == source && list.sourceListId == text))
    if (existing) return { listId: existing.id, name: existing.name, existed: true }
    const listName = name ?? (await getListDetail(text, source, 1)).info?.name ?? text
    const list = await getListDetailAll(text, source)
    await createUserList({ name: listName, id: listId, list, source, sourceListId: text })
    return { listId, name: listName, existed: false }
  },

  async lyric({ musicInfo }: { musicInfo: LX.Music.MusicInfo }) {
    const info = await getLyricInfo({ musicInfo })
    return { lyric: info.lyric ?? '', tlyric: info.tlyric ?? '', rlyric: info.rlyric ?? '', lxlyric: info.lxlyric ?? '' }
  },

  async pic({ musicInfo }: { musicInfo: LX.Music.MusicInfo }) {
    return { url: await getPicPath({ musicInfo }) }
  },

  async play(params: { target: 'list' | 'search' | 'songlist' | 'later', [key: string]: any }) {
    switch (params.target) {
      case 'list': {
        const list = await getListMusics(params.listId)
        const musicInfo = list.find(item => item.id == params.musicId)
        if (!musicInfo) throw new FoliaLinkError('not-found', 'The song is not in that list')
        assertPlayable(musicInfo)
        playListById(params.listId, params.musicId)
        return null
      }
      case 'search': {
        // 与搜索页双击一样：加进「试听列表」，从那里播放
        const musicInfo = params.musicInfo as LX.Music.MusicInfo
        assertPlayable(musicInfo)
        await addListMusics(LIST_IDS.DEFAULT, [musicInfo])
        const list = await getListMusics(LIST_IDS.DEFAULT)
        const index = list.findIndex(item => item.id == musicInfo.id)
        if (index < 0) throw new FoliaLinkError('not-found', 'The song could not be added')
        playList(LIST_IDS.DEFAULT, index)
        return null
      }
      case 'songlist':
        await playSongList(params.text, params.source, params.musicId)
        return null
      case 'later':
        // 「下一首播放」：排在稍后播放的最前面
        assertPlayable(params.musicInfo)
        addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo: params.musicInfo, isTop: true }])
        return null
    }
    return null
  },

  async control({ action, value }: { action: string, value?: any }) {
    switch (action) {
      case 'play': play(); break
      case 'pause': pause(); break
      case 'toggle': togglePlay(); break
      case 'next': await playNext(); break
      case 'prev': await playPrev(); break
      case 'seek': window.app_event.setProgress(Math.min(value as number, playProgress.maxPlayTime || (value as number))); break
      case 'volume': window.app_event.setVolume(value as number); break
      case 'mute': window.app_event.setVolumeIsMute(value as boolean); break
      case 'rate': window.app_event.setPlaybackRate(value as number); break
      case 'playMode': setTogglePlayMode(value); break
      case 'quality': await switchQuality(value as LX.Quality); break
    }
    return null
  },

  /** 正在播放的列表（Folia 的播放队列跟它一致）和稍后播放 */
  async queue() {
    const listId = playInfo.playerListId
    if (listId && listId != LIST_IDS.DOWNLOAD) await getListMusics(listId)
    return {
      listId,
      isTempPlay: playMusicInfo.isTempPlay,
      tempListId: listId == LIST_IDS.TEMP ? tempListMeta.id ?? null : null,
      list: getList(listId).map(toMusicInfo).filter(Boolean),
      playLater: tempPlayList.map(item => toMusicInfo(item.musicInfo)).filter(Boolean),
    }
  },
}

/** 播放分享歌单里的一首：先放第一页，整张歌单读完再换成全部（照歌单详情页的「播放」） */
const playSongList = async(text: string, source: LX.OnlineSource, musicId?: string) => {
  const key = songListKey(text, source)
  const start = (list: LX.Music.MusicInfo[]) => {
    const index = musicId ? list.findIndex(item => item.id == musicId) : 0
    if (index < 0) return false
    assertPlayable(list[index])
    playList(LIST_IDS.TEMP, index)
    return true
  }
  // 已经在放这张歌单：直接换歌
  if (tempListMeta.id == key && musicId) {
    const list = await getListMusics(LIST_IDS.TEMP)
    if (list.some(item => item.id == musicId)) {
      playListById(LIST_IDS.TEMP, musicId)
      return
    }
  }
  const firstPage = (await getListDetail(text, source, 1)).list
  if (!firstPage.length) throw new FoliaLinkError('not-found', 'The song list is empty')
  await setTempList(key, [...firstPage])
  const started = start(firstPage)
  void getListDetailAll(text, source).then(async fullList => {
    if (!fullList.length || tempListMeta.id != key) return
    await setTempList(key, [...fullList])
    if (!started) start(fullList)
  }).catch(err => { console.log('[FoliaLink] could not read the whole song list', err) })
}

/** 换音质：改播放音质设置，当前在放的在线歌曲按新音质重新取地址，从原来的位置接着放 */
const switchQuality = async(quality: LX.Quality) => {
  updateSetting({ 'player.playQuality': quality })
  const current = toMusicInfo(playMusicInfo.musicInfo)
  if (!current || current.source == 'local' || 'progress' in (playMusicInfo.musicInfo ?? {})) return
  const position = playProgress.nowPlayTime
  const maxTime = playProgress.maxPlayTime
  const wasPlaying = isPlay.value
  await setStop()
  window.app_event.pause()
  setShouldPlayAfterLoad(wasPlaying)
  setMusicUrl(current, true)
  setImmediate(() => {
    if (toMusicInfo(playMusicInfo.musicInfo)?.id != current.id || position <= 0) return
    window.app_event.setProgress(position, maxTime)
  })
}

export const handleFoliaLinkRequest = async(op: string, params: any) => {
  const handler = handlers[op]
  if (!handler) throw new FoliaLinkError('unknown-op', `Unknown op: ${op}`)
  return handler(params)
}
