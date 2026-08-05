import { formatPlayTime } from '../../index'
import { httpFetch } from '../../request'
import { normalizePicUrl, mapLimit, BILI_REFERER, BILI_UA } from './util'
import { getViewInfo } from './api'
import { parseBiliVideoUrl } from './url'

const toMusicInfo = (view, videoId, pageInfo = null) => {
  const bvid = view.bvid || videoId
  const page = pageInfo?.page || 1
  return {
    name: pageInfo?.part || view.title || '',
    singer: view.owner?.name || '未知UP主',
    source: 'bili',
    songmid: page > 1 ? `${bvid}_p${page}` : bvid,
    albumId: '',
    interval: formatPlayTime(Number(pageInfo?.duration ?? view.duration) || 0),
    albumName: view.tname || 'Bilibili',
    lrc: null,
    img: normalizePicUrl(view.pic),
    otherSource: null,
    types: [{ type: '128k', size: null }],
    _types: { '128k': { size: null } },
    typeUrl: {},
    platformData: {
      bvid,
      aid: view.aid,
      cid: pageInfo?.cid || view.cid || 0,
      page,
      upName: view.owner?.name || '',
      videoTitle: view.title || '',
    },
  }
}

const resolveShortUrl = async(parsed) => {
  const { headers = {}, statusCode } = await httpFetch(parsed.shortUrl, {
    headers: {
      'User-Agent': BILI_UA,
      Referer: BILI_REFERER,
    },
  }).promise
  if (statusCode > 400 || !headers.location) throw new Error('无法解析哔哩哔哩短链接')
  const resolved = parseBiliVideoUrl(headers.location.startsWith('//') ? `https:${headers.location}` : headers.location)
  if (!resolved?.videoId) throw new Error('无法解析哔哩哔哩短链接')
  return { ...resolved, page: parsed.page > 1 ? parsed.page : resolved.page }
}

// 供平台账号收藏夹使用：根据 bvid 列表构建标准音乐对象
export const getMusicInfos = async bvids => {
  const list = await mapLimit(bvids, 5, async bvid => {
    try {
      const view = await getViewInfo(bvid)
      if (!view?.cid) return null
      return toMusicInfo(view, bvid)
    } catch {
      return null
    }
  })
  return list.filter(Boolean)
}

export const getMusicInfoByUrl = async url => {
  const parsed = parseBiliVideoUrl(url)
  if (!parsed) return null
  const target = parsed.shortUrl ? await resolveShortUrl(parsed) : parsed
  const view = await getViewInfo(target.videoId)
  if (!view?.cid) throw new Error('哔哩哔哩视频不存在或无法访问')
  const pageInfo = view.pages?.find(page => page.page == target.page)
  if (target.page > 1 && !pageInfo) throw new Error(`哔哩哔哩视频不存在第 ${target.page} P`)
  return toMusicInfo(view, target.videoId, pageInfo)
}
