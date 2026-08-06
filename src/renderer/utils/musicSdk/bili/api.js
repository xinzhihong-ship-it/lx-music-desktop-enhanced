import { appSetting } from '@renderer/store/setting'
import { BILI_API, biliGet, refreshAccountCookie, DASH_QUALITY_MAP, getQualityRank } from './util'
import { getStreamUrls, pickStreamUrl } from './stream'

const PLAY_URL_API = `${BILI_API}/x/player/playurl`
const VIEW_API = `${BILI_API}/x/web-interface/view`

const VIDEO_QUALITY_MAP = {
  16: '360p',
  32: '480p',
  64: '720p',
  74: '720p60',
  80: '1080p',
  112: '1080p+',
  116: '1080p60',
  120: '4K',
  127: '8K',
}
const VIDEO_QUALITY_QN = {
  auto: 80,
  '360p': 16,
  '480p': 32,
  '720p': 64,
  '720p60': 74,
  '1080p': 80,
  '1080p+': 112,
  '1080p60': 116,
  '4K': 120,
  '8K': 127,
}
const VIDEO_QUALITY_RANK = ['360p', '480p', '720p', '720p60', '1080p', '1080p+', '1080p60', '4K', '8K']

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

export const getBvid = songInfo => {
  const id = songInfo.platformData?.bvid || songInfo.songmid
  return String(id || '').replace(/_p\d+$/i, '')
}

const getSongPage = songInfo => songInfo.platformData?.page || Number(String(songInfo.songmid || '').match(/_p(\d+)$/i)?.[1]) || 1

const getCid = async(songInfo, view) => {
  const page = getSongPage(songInfo)
  return view?.pages?.find(p => p.page == page)?.cid ?? (page == 1 ? view?.cid : 0) ?? songInfo.platformData?.cid ?? 0
}

const getPlayUrlData = async(songInfo, qn = 64) => {
  const bvid = getBvid(songInfo)
  const request = async(forceRefresh = false, requestQn = qn, useAid = false) => {
    if (forceRefresh) viewCache.delete(bvid)
    const view = await getViewInfo(bvid)
    const cid = await getCid(songInfo, view)
    if (!cid) throw new Error('bili video cid was not found')
    // fnval=4048：DASH 全格式（含杜比、Hi-Res 标志位），登录/大会员可解锁更多音频流
    const params = useAid && songInfo.platformData?.aid
      ? { avid: songInfo.platformData.aid, cid, fnval: 4048, fnver: 0, qn: requestQn }
      : { bvid, cid, fnval: 4048, fnver: 0, qn: requestQn }
    return biliGet(PLAY_URL_API, params)
  }

  try {
    return await request()
  } catch (error) {
    if (!/-404/.test(String(error?.message || ''))) throw error
    // 收藏/历史里的 CID 可能已经过期，先用最新 view 重新解析一次。
    try {
      return await request(true)
    } catch (refreshError) {
      // 自动档位被 B 站拒绝时，退到基础 DASH 档位；视频仍会按实际返回流选最高画质。
      if (qn !== 64) {
        try {
          return await request(true, 64)
        } catch {}
      }
      if (songInfo.platformData?.aid) return request(true, qn, true)
      throw refreshError
    }
  }
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

const toVideoStreams = data => {
  const dashStreams = (data?.dash?.video || [])
    .map(video => {
      const quality = VIDEO_QUALITY_MAP[video.id] || `${video.height || 0}p`
      return {
        quality,
        rank: VIDEO_QUALITY_RANK.indexOf(quality) === -1 ? VIDEO_QUALITY_RANK.length : VIDEO_QUALITY_RANK.indexOf(quality),
        bandwidth: video.bandwidth || 0,
        urls: getStreamUrls(video),
      }
    })
    .filter(video => video.urls.length)
  if (dashStreams.length) return dashStreams
  return (data?.durl || []).map((video, index) => ({
    quality: VIDEO_QUALITY_MAP[data.quality] || (index ? '480p' : '720p'),
    rank: index ? 1 : 2,
    bandwidth: video.size || 0,
    urls: getStreamUrls(video),
  })).filter(video => video.urls.length)
}

const getStreamKey = (songInfo, stream) => [
  getBvid(songInfo),
  songInfo.platformData?.cid || getSongPage(songInfo),
  stream.quality,
  stream.bandwidth,
].join(':')

const resolveStreamUrl = (songInfo, stream, isRefresh) => {
  const key = getStreamKey(songInfo, stream)
  const { url, index } = pickStreamUrl(stream.urls, isRefresh, streamUrlAttempts.get(key) ?? 0)
  streamUrlAttempts.set(key, index)
  return url
}

const resolveVideoStreamUrl = (songInfo, stream, isRefresh) => {
  const key = `${getBvid(songInfo)}:${songInfo.platformData?.cid || getSongPage(songInfo)}:video:${stream.quality}:${stream.bandwidth}`
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

const pickVideoStream = (streams, targetQuality = 'auto') => {
  if (!streams.length) return null
  const requestedRank = targetQuality === 'auto' ? Number.POSITIVE_INFINITY : (VIDEO_QUALITY_RANK.indexOf(targetQuality) === -1 ? Number.POSITIVE_INFINITY : VIDEO_QUALITY_RANK.indexOf(targetQuality))
  const candidates = streams.filter(stream => stream.rank <= requestedRank)
  return [...(candidates.length ? candidates : streams)].sort((a, b) => b.rank - a.rank || b.bandwidth - a.bandwidth)[0]
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

export const getVideoUrl = (songInfo, quality = 'auto', { isRefresh = false } = {}) => {
  const promise = (async() => {
    await refreshAccountCookie()
    const data = await getPlayUrlData(songInfo, VIDEO_QUALITY_QN[quality] || VIDEO_QUALITY_QN.auto)
    const videoStream = pickVideoStream(toVideoStreams(data), quality)
    if (!videoStream) throw new Error('bili video stream was not found')
    const audioStream = pickStream(toStreams(data?.dash), appSetting['player.playQuality'])
    return {
      type: videoStream.quality,
      url: resolveVideoStreamUrl(songInfo, videoStream, isRefresh),
      audioUrl: audioStream ? resolveStreamUrl(songInfo, audioStream, isRefresh) : undefined,
    }
  })()
  return { promise, cancelHttp: () => {} }
}

export const getVideoQualityInfo = songInfo => {
  const promise = (async() => {
    const data = await getPlayUrlData(songInfo, VIDEO_QUALITY_QN.auto)
    const qualitys = [...new Set(toVideoStreams(data).map(stream => stream.quality))]
      .sort((a, b) => VIDEO_QUALITY_RANK.indexOf(a) - VIDEO_QUALITY_RANK.indexOf(b))
    return {
      types: qualitys.map(type => ({ type, size: null })),
      _types: Object.fromEntries(qualitys.map(type => [type, { size: null }])),
    }
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
