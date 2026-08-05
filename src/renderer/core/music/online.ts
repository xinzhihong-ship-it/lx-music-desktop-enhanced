import { updateListMusics } from '@renderer/store/list/action'
import { appSetting } from '@renderer/store/setting'
import { qualityList } from '@renderer/store'
import {
  saveLyric,
  saveMusicUrl,
  getMusicUrl as getStoreMusicUrl,
} from '@renderer/utils/ipc'
import {
  buildLyricInfo,
  getPlayQuality,
  handleGetOnlineLyricInfo,
  handleGetOnlineMusicUrl,
  handleGetOnlinePicUrl,
  getCachedLyricInfo,
  getOnlineOtherSourceMusicUrl,
  getOtherSource,
} from './utils'
import musicSdk from '@renderer/utils/musicSdk'
import { toOldMusicInfo } from '@renderer/utils'

const detailQualitys = new Set<LX.Quality>(['master', 'atmos_plus', 'atmos', 'hires', '192k'])
interface QualityDetail {
  types: LX.Music.MusicInfoOnline['meta']['qualitys']
  _types: LX.Music.MusicInfoOnline['meta']['_qualitys']
}
const qualityDetailRequests = new Map<string, Promise<QualityDetail | null>>()

const hasPreferredQuality = (musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  if (quality == 'hires') return !!(musicInfo.meta._qualitys.hires ?? musicInfo.meta._qualitys.flac24bit)
  return !!musicInfo.meta._qualitys[quality]
}

const loadDetailedQuality = async(musicInfo: LX.Music.MusicInfoOnline) => {
  const preferredQuality = appSetting['player.playQuality']
  if (!detailQualitys.has(preferredQuality) || hasPreferredQuality(musicInfo, preferredQuality)) return
  const getMusicQualityInfo = (musicSdk[musicInfo.source] as any)?.getMusicQualityInfo
  if (typeof getMusicQualityInfo != 'function') return

  const requestKey = `${musicInfo.source}:${musicInfo.id}`
  let request = qualityDetailRequests.get(requestKey)
  if (!request) {
    request = Promise.resolve(getMusicQualityInfo(toOldMusicInfo(musicInfo)).promise).then(({ types, _types }) => {
      return types?.length ? { types, _types } : null
    }).catch(err => {
      console.warn('[music quality] detailed quality request failed:', err)
      return null
    }).finally(() => {
      qualityDetailRequests.delete(requestKey)
    })
    qualityDetailRequests.set(requestKey, request)
  }
  const detail = await request
  if (!detail) return
  const qualitys = new Map(musicInfo.meta.qualitys.map(item => [item.type, item]))
  for (const item of detail.types) qualitys.set(item.type, item)
  musicInfo.meta.qualitys = [...qualitys.values()]
  musicInfo.meta._qualitys = { ...musicInfo.meta._qualitys, ...detail._types }
}

export const getMusicUrl = async({ musicInfo, quality, isRefresh, allowToggleSource = true, forceToggleSource = false, onToggleSource = () => {}, onResolvedQuality = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource?: boolean
  forceToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  onResolvedQuality?: (quality: LX.Quality) => void
}): Promise<string> => {
  if (!quality) await loadDetailedQuality(musicInfo)
  if (forceToggleSource) {
    const otherSource = await getOtherSource(musicInfo, true)
    const result = await getOnlineOtherSourceMusicUrl({
      musicInfos: [...otherSource],
      quality,
      onToggleSource,
      isRefresh: true,
      retryedSource: [musicInfo.source],
    })
    if (!result.isFromCache && result.musicInfo.source != 'bili') void saveMusicUrl(result.musicInfo, result.quality, result.url)
    if (musicInfo.source != 'bili') void saveMusicUrl(musicInfo, result.quality, result.url)
    onResolvedQuality(result.quality)
    return result.url
  }
  const targetQuality = quality ?? getPlayQuality(appSetting['player.playQuality'], musicInfo)
  const cachedUrl = musicInfo.source == 'bili' || qualityList.value[musicInfo.source] == null
    ? null
    : await getStoreMusicUrl(musicInfo, targetQuality)
  if (cachedUrl && !isRefresh) {
    onResolvedQuality(targetQuality)
    return cachedUrl
  }

  return handleGetOnlineMusicUrl({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource }).then(({ url, quality: resolvedQuality, musicInfo: targetMusicInfo, isFromCache }) => {
    if (targetMusicInfo.id != musicInfo.id && !isFromCache && targetMusicInfo.source != 'bili') void saveMusicUrl(targetMusicInfo, resolvedQuality, url)
    if (musicInfo.source != 'bili') void saveMusicUrl(musicInfo, resolvedQuality, url)
    onResolvedQuality(resolvedQuality)
    return url
  })
}

export const getPicUrl = async({ musicInfo, listId, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  listId?: string | null
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (musicInfo.meta.picUrl && !isRefresh) return musicInfo.meta.picUrl
  return handleGetOnlinePicUrl({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(({ url, musicInfo: targetMusicInfo, isFromCache }) => {
    // picRequest = null
    if (listId) {
      musicInfo.meta.picUrl = url
      void updateListMusics([{ id: listId, musicInfo }])
    }
    // savePic({ musicInfo, url, listId })
    return url
  })
}
export const getLyricInfo = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  // lrcRequest = music[musicInfo.source].getLyric(musicInfo)
  return handleGetOnlineLyricInfo({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(async({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
    // lrcRequest = null
    if (isFromCache) return buildLyricInfo(lyricInfo)
    if (targetMusicInfo.id == musicInfo.id) void saveLyric(musicInfo, lyricInfo)
    else void saveLyric(targetMusicInfo, lyricInfo)

    return buildLyricInfo(lyricInfo)
  })
}
