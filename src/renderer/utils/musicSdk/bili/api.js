import { appSetting } from '@renderer/store/setting'
import { BILI_API, biliGet, refreshAccountCookie, DASH_QUALITY_MAP, getQualityRank } from './util'
import { getStreamUrls, pickStreamUrl } from './stream'

const PLAY_URL_API = `${BILI_API}/x/player/playurl`
const VIEW_API = `${BILI_API}/x/web-interface/view`

let viewCache = new Map()
const VIEW_CACHE_DURATION = 30 * 60 * 1000
const streamUrlAttempts = new Map()

export const getViewInfo = async videoId => {
  const cached = viewCache.get(videoId)
  if (cached && Date.now() - cached.time < VIEW_CACHE_DURATION) return cached.data
  const params = /^av\d+$/i.test(videoId) ? { aid: videoId.slice(2) } : { bvid: videoId }
  const data = await biliGet(VIEW_API, params)
  viewCache.set(videoId, { time: Date.now(), data })
  return data
}

export const getBvid = songInfo => songInfo.platformData?.bvid || songInfo.songmid

const getCid = async(songInfo, view) => {
  if (songInfo.platformData?.cid) return songInfo.platformData.cid
  const page = songInfo.platformData?.page || 1
  return view?.pages?.find(p => p.page == page)?.cid ?? view?.cid ?? 0
}

const getPlayUrlData = async songInfo => {
  const bvid = getBvid(songInfo)
  const view = await getViewInfo(bvid)
  const cid = await getCid(songInfo, view)
  if (!cid) throw new Error('bili video cid was not found')
  // fnval=4048：DASH 全格式（含杜比、Hi-Res 标志位），登录/大会员可解锁更多音频流
  return biliGet(PLAY_URL_API, { bvid, cid, fnval: 4048, fnver: 0, qn: 64 })
}

// 杜比全景声在 dash.dolby.audio，Hi-Res 无损在 dash.flac.audio，均不在 dash.audio 里
const toStreams = dash => [
  ...(dash?.audio || []),
  ...(dash?.dolby?.audio || []),
  dash?.flac?.audio,
]
  .filter(Boolean)
  .map(audio => ({
    quality: DASH_QUALITY_MAP[audio.id] || '128k',
    bandwidth: audio.bandwidth || 0,
    urls: getStreamUrls(audio),
  }))
  .filter(audio => audio.urls.length)
  .sort((a, b) => b.bandwidth - a.bandwidth)

const getStreamKey = (songInfo, stream) => [
  getBvid(songInfo),
  songInfo.platformData?.cid || songInfo.platformData?.page || 1,
  stream.quality,
  stream.bandwidth,
].join(':')

const resolveStreamUrl = (songInfo, stream, isRefresh) => {
  const key = getStreamKey(songInfo, stream)
  const { url, index } = pickStreamUrl(stream.urls, isRefresh, streamUrlAttempts.get(key) ?? 0)
  streamUrlAttempts.set(key, index)
  return url
}

/**
 * 在实际可用音频流中选流：
 * 搜索结果只声明了基础档位，目标音质可能低于视频实际能力，
 * 因此在「目标音质与用户偏好中较高者」范围内选最高可用流；
 * 用户偏好低带宽（如 128k）时则严格限制在该档位。
 */
const pickStream = (streams, targetQuality) => {
  if (!streams.length) return null
  const preferredQuality = appSetting['player.playQuality']
  const ceiling = getQualityRank(preferredQuality) < getQualityRank(targetQuality) ? preferredQuality : targetQuality
  const ceilingRank = getQualityRank(ceiling)
  const inRange = streams.filter(s => getQualityRank(s.quality) >= ceilingRank)
  const candidates = inRange.length ? inRange : streams
  return [...candidates].sort((a, b) => getQualityRank(a.quality) - getQualityRank(b.quality) || b.bandwidth - a.bandwidth)[0]
}

export const getMusicUrl = (songInfo, type, { isRefresh = false } = {}) => {
  const promise = (async() => {
    // 播放关键时刻强制使用最新登录态，避免登录后仍用到旧的空 Cookie 缓存
    await refreshAccountCookie()
    const data = await getPlayUrlData(songInfo)
    const streams = toStreams(data?.dash)
    const stream = pickStream(streams, type)
    if (!stream) throw new Error('bili audio stream was not found')
    return { type: stream.quality, url: resolveStreamUrl(songInfo, stream, isRefresh) }
  })()
  return { promise, cancelHttp: () => {} }
}

// 播放前探测该视频真实可用的音质档位
export const getMusicQualityInfo = songInfo => {
  const promise = (async() => {
    const data = await getPlayUrlData(songInfo)
    const streams = toStreams(data?.dash)
    const qualitys = [...new Set(streams.map(s => s.quality))]
      .sort((a, b) => getQualityRank(a) - getQualityRank(b))
    return {
      types: qualitys.map(type => ({ type, size: null })),
      _types: Object.fromEntries(qualitys.map(type => [type, { size: null }])),
    }
  })()
  return { promise, cancelHttp: () => {} }
}
