// 「Folia 对接」在渲染进程里执行的接口：主进程（main/modules/foliaLink）校验过参数后转来，这里只调用本软件已有的
// 搜索、歌单、列表、播放函数，行为与在本软件界面里操作一致（例如在 Folia 里播放搜索结果，和在搜索页双击一样进「试听列表」）。
import { LIST_IDS } from '@common/constants'
import { similar, sortInsert } from '@common/utils/common'
import musicSdk from '@renderer/utils/musicSdk'
import { deduplicationList, toMD5, toNewMusicInfo } from '@renderer/utils'
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
import { TRY_QUALITYS_LIST } from '@renderer/core/music/utils'
import { getAccountPlaylists, getAccounts } from '@renderer/utils/ipc'
import { readAccountDailyMusics, readAccountPlaylistMusics, sortPlatformAccounts } from '@renderer/utils/platformPlaylistMusic'

/** 单个平台一页的条数，与本软件搜索页一致 */
const SEARCH_LIMIT = 30
/** 搜歌单时单个平台一页的条数（本软件搜索页「全部」的条数） */
const SONGLIST_SEARCH_LIMIT = 15

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

/** 能按关键词搜歌单的平台 */
const songListSearchSources = (): LX.OnlineSource[] => musicSdk.sources
  .filter((source: { id: string }) => (musicSdk as any)[source.id]?.songList?.search)
  .map((source: { id: string }) => source.id as LX.OnlineSource)

/** 搜到的一张歌单（只交 Folia 用得到的字段）；id 和 source 交回 songlistDetail 就能打开它 */
const toSongListItem = (item: any, source: string) => ({
  id: String(item.id),
  source: typeof item.source == 'string' && item.source ? item.source : source,
  name: String(item.name ?? ''),
  img: typeof item.img == 'string' ? item.img : '',
  author: typeof item.author == 'string' ? item.author : '',
  desc: typeof item.desc == 'string' ? item.desc : '',
  total: item.total ?? null,
  play_count: item.play_count ?? null,
})

/** 按与关键词的相似度排序（本软件「全部」搜索的做法） */
const sortByKeyword = (list: LX.Music.MusicInfo[], keyword: string) => {
  const arr: Array<{ num: number, data: LX.Music.MusicInfo }> = []
  for (const item of list) sortInsert(arr, { num: similar(keyword, `${item.name} ${item.singer}`), data: item })
  return arr.map(item => item.data).reverse()
}

const songListKey = (id: string, source: string) => `${source}__${id}`
/** Folia 交来的队列在临时列表里的名字 */
const FOLIA_QUEUE_LIST_KEY = 'folia__queue'

const handlers: Record<string, (params: any) => Promise<unknown> | unknown> = {
  info() {
    // 播放音质能选的档，顺序与「设置 → 播放设置」里一样（低到高）；现在的设置是不在其中的旧值（如 flac24bit）时也列上，名字照样用本软件的
    const qualityIds: string[] = [...TRY_QUALITYS_LIST, '128k'].reverse()
    const quality = appSetting['player.playQuality']
    if (quality && !qualityIds.includes(quality)) qualityIds.push(quality)
    return {
      sources: musicSdk.sources.map((source: { id: string, name: string }) => ({
        id: source.id,
        name: source.name,
        search: !!(musicSdk as any)[source.id]?.musicSearch,
        songList: !!(musicSdk as any)[source.id]?.songList,
        playable: qualityList.value[source.id as LX.OnlineSource] != null,
      })),
      quality,
      // Folia 的音质选择列这些档
      qualities: qualityIds.map(id => ({ id, name: window.i18n.t(`setting__play_quality_${id}` as any) })),
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

  /** 按关键词搜歌单（本软件搜索页的「歌单」）：一个平台，或 all 时各平台合并、按名字与关键词的相似度排 */
  async songlistSearch({ text, source, page }: { text: string, source: string, page: number }) {
    const available = songListSearchSources()
    if (source != 'all' && !available.includes(source as LX.OnlineSource)) throw new FoliaLinkError('invalid-params', `Cannot search song lists on ${source}`)
    const ids = source == 'all' ? available : [source as LX.OnlineSource]
    const results = await Promise.all(ids.map(async id => {
      const search = (musicSdk as any)[id].songList.search(text, page, SONGLIST_SEARCH_LIMIT) as Promise<any>
      // 「全部」里一个平台搜不到不算失败；只搜一个平台时把错交回去
      if (source != 'all') return { id, result: await search }
      const result = await search.catch((err: unknown) => {
        console.log('[FoliaLink] song list search failed', id, err)
        return null
      })
      return { id, result }
    }))
    let maxPage = 0
    let total = 0
    const list: Array<ReturnType<typeof toSongListItem>> = []
    for (const { id, result } of results) {
      if (!result) continue
      const sourceTotal = Number(result.total) || 0
      const pages = Math.ceil(sourceTotal / (Number(result.limit) || SONGLIST_SEARCH_LIMIT))
      maxPage = Math.max(maxPage, pages)
      total = Math.max(total, sourceTotal)
      // 「全部」翻到某个平台的最后一页之后不再要它的（照本软件搜索页；有的平台超出页数时会再回最后一页）
      if (source == 'all' && sourceTotal > 0 && page > pages) continue
      for (const item of Array.isArray(result.list) ? result.list : []) {
        if (item?.id != null && item.id !== '') list.push(toSongListItem(item, id))
      }
    }
    if (source != 'all') return { list, page, maxPage, total }
    const sorted: Array<{ num: number, data: typeof list[number] }> = []
    for (const item of list) sortInsert(sorted, { num: similar(text, item.name), data: item })
    return { list: sorted.map(item => item.data).reverse(), page, maxPage, total }
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

  async play(params: { target: 'list' | 'search' | 'songlist' | 'later' | 'queue', [key: string]: any }) {
    switch (params.target) {
      case 'list': {
        const list = await getListMusics(params.listId)
        const musicInfo = list.find(item => item.id == params.musicId)
        if (!musicInfo) throw new FoliaLinkError('not-found', 'The song is not in that list')
        // 不先查音源：与在本软件里双击一样，取链接时音源不支持会自动换源
        playListById(params.listId, params.musicId)
        return null
      }
      case 'search': {
        // 与搜索页双击一样：加进「试听列表」，从那里播放
        const musicInfo = params.musicInfo as LX.Music.MusicInfo
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
      case 'queue': {
        // Folia 打乱、筛过或加过歌的队列：照「播放分享歌单」放进临时列表，从这首开始，按这个顺序往下放
        const musicInfos = params.musicInfos as LX.Music.MusicInfo[]
        const index = musicInfos.findIndex(item => item.id == params.musicId)
        if (index < 0) throw new FoliaLinkError('not-found', 'The song is not in that queue')
        // 临时列表与其他列表一样放得下本地歌曲（overwriteListMusics 不分），setTempList 的类型只是按分享歌单写的
        await setTempList(FOLIA_QUEUE_LIST_KEY, [...musicInfos] as LX.Music.MusicInfoOnline[])
        playList(LIST_IDS.TEMP, index)
        return null
      }
      case 'later': {
        // 「下一首播放」排在稍后播放的最前面（top），「加入队列」排在最后；几首按给的顺序。
        // now：排到最前并马上放第一首（稍后播放的歌先放，playNext 取的就是它），不换正在播放的列表
        const musicInfos = params.musicInfos as LX.Music.MusicInfo[]
        const hadMusic = playMusicInfo.musicInfo != null
        addTempPlayList(musicInfos.map(musicInfo => ({ listId: LIST_IDS.PLAY_LATER, musicInfo, isTop: params.top as boolean })))
        // 没有在放的歌时 addTempPlayList 自己会开始放
        if (params.now && hadMusic) await playNext()
        return null
      }
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
      // 不按 maxPlayTime 截：刚起播时它还是上一首的时长；位置超过时长由播放器自己处理
      case 'seek': window.app_event.setProgress(value as number); break
      case 'volume': window.app_event.setVolume(value as number); break
      case 'mute': window.app_event.setVolumeIsMute(value as boolean); break
      case 'rate': window.app_event.setPlaybackRate(value as number); break
      case 'playMode': setTogglePlayMode(value); break
      case 'quality': await switchQuality(value as LX.Quality); break
    }
    return null
  },

  /** 已登录的平台账号和各自的歌单（本软件「平台音乐」左边那一列）；一个账号读不出来只影响它自己 */
  async accountLists() {
    const accounts = sortPlatformAccounts((await getAccounts()).filter(account => account.isLogin))
    return Promise.all(accounts.map(async account => {
      const base = {
        id: account.id,
        source: account.source,
        sourceName: window.i18n.t(`account__source_${account.source}` as any),
        nickname: account.nickname,
        // 每日推荐的名字；B 站没有每日推荐（null）
        daily: account.source != 'bili' ? window.i18n.t('account__playlist_tab_daily') : null,
      }
      try {
        const playlists = await getAccountPlaylists(account.id)
        return {
          ...base,
          playlists: playlists.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            img: playlist.img,
            desc: playlist.desc,
            author: playlist.author,
            total: playlist.total ?? null,
            dirId: playlist.dirId ?? null,
          })),
        }
      } catch (err: any) {
        console.log('[FoliaLink] could not read the playlists of an account', account.source, err)
        return { ...base, playlists: [], error: err?.message ?? String(err) }
      }
    }))
  },

  /** 平台账号一张歌单（或每日推荐）里的歌，和「平台音乐」页面从平台读到的一样（页面上刚增删、平台还没反映出来的那几首不在内） */
  async accountListMusics({ accountId, playlistId, dirId, daily }: { accountId: string, playlistId?: string, dirId?: string, daily?: boolean }) {
    const account = (await getAccounts()).find(item => item.id == accountId && item.isLogin)
    if (!account) throw new FoliaLinkError('not-found', 'That platform account is not signed in')
    const list = daily ? await readAccountDailyMusics(account) : await readAccountPlaylistMusics(account, playlistId!, dirId)
    return { list }
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
  // 要放的歌不在第一页：读完整张再起播，起播之后才回答（Folia 等着这一首，不跟回上一首；读失败 Folia 会知道）
  if (musicId && !firstPage.some(item => item.id == musicId)) {
    const fullList = await getListDetailAll(text, source)
    await setTempList(key, [...fullList])
    if (!start(fullList)) throw new FoliaLinkError('not-found', 'The song is not in that song list')
    return
  }
  await setTempList(key, [...firstPage])
  start(firstPage)
  void getListDetailAll(text, source).then(async fullList => {
    if (!fullList.length || tempListMeta.id != key) return
    await setTempList(key, [...fullList])
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
