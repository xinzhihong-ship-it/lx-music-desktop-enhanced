import { formatPlayTime } from '../../index'
import { BILI_API, biliGet, stripHtml, normalizePicUrl, parseDuration, mapLimit } from './util'
import { getMusicQualityInfo } from './api'

const SEARCH_API = `${BILI_API}/x/web-interface/wbi/search/type`
const VIEW_API = `${BILI_API}/x/web-interface/view`

// 合集/多 P 视频特征：搜索结果的合集标记或标题中的分 P 关键词
const MULTI_PAGE_HINT_RXP = /合集|全集|分\s*[Pp]|多\s*[Pp]|【\d+[Pp]】|（\d+[Pp]）|\(\d+[Pp]\)/
const MAX_EXPAND_PAGES = 200

// 单次搜索最多实测的条目数，避免合集展开后请求量过大
const MAX_QUALITY_PROBES = 45

const toMusicInfo = (item, pageInfo = null) => {
  const title = stripHtml(pageInfo?.part || item.title)
  return {
    name: title,
    singer: item.author || '未知UP主',
    source: 'bili',
    songmid: pageInfo ? `${item.bvid}_p${pageInfo.page}` : item.bvid,
    albumId: '',
    interval: formatPlayTime(pageInfo?.duration ?? parseDuration(item.duration)),
    albumName: item.typename || 'Bilibili',
    lrc: null,
    img: normalizePicUrl(item.pic),
    otherSource: null,
    types: [{ type: '128k', size: null }],
    _types: { '128k': { size: null } },
    typeUrl: {},
    platformData: {
      bvid: item.bvid,
      aid: item.aid,
      cid: pageInfo?.cid ?? 0,
      page: pageInfo?.page ?? 1,
      upName: item.author || '',
      videoTitle: stripHtml(item.title),
    },
  }
}

const isMultiPageSuspect = item => !!item.episode_count_text || MULTI_PAGE_HINT_RXP.test(stripHtml(item.title))

// 展开疑似多 P/合集结果：每个分 P 成为独立条目（独立 cid、标题、时长）
const expandMultiPage = async list => {
  const expanded = await mapLimit(list, 3, async item => {
    if (!isMultiPageSuspect(item)) return [toMusicInfo(item)]
    try {
      const view = await biliGet(VIEW_API, { bvid: item.bvid })
      const pages = (view?.pages || []).slice(0, MAX_EXPAND_PAGES)
      if (pages.length <= 1) return [toMusicInfo(item)]
      return pages.map(page => toMusicInfo(item, { cid: page.cid, page: page.page, part: page.part, duration: page.duration }))
    } catch {
      return [toMusicInfo(item)]
    }
  })
  return expanded.flat()
}

// 整页实测音频流：音质徽标显示当前账号实际可播放的最高档位
// （未登录/无会员实测通常为 192k，大会员且视频提供高阶音轨时可见 Hi-Res/杜比）
const probeRealQuality = async list => {
  const probed = list.slice(0, MAX_QUALITY_PROBES)
  const attempted = new Set()
  let riskControlled = false
  await mapLimit(probed, 4, async(item, index) => {
    if (riskControlled) return
    attempted.add(index)
    try {
      const { types, _types } = await getMusicQualityInfo(item).promise
      if (types?.length) {
        item.types = types
        item._types = _types
      }
    } catch (err) {
      // 触发风控时停止后续探测，保留已验证结果
      // eslint-disable-next-line require-atomic-updates
      if (/412|banned|风控/i.test(String(err?.message || err))) riskControlled = true
    }
  })
  // 风控后的未探测条目标记“风控”，让用户知道为何没有音质徽标
  if (riskControlled) {
    for (let i = 0; i < probed.length; i++) {
      if (attempted.has(i)) continue
      const item = probed[i]
      item._types = { ...item._types, risk: { size: null } }
    }
  }
  return list
}

export default {
  limit: 30,
  async search(keyword, page = 1, limit = 30) {
    const data = await biliGet(SEARCH_API, {
      search_type: 'video',
      keyword,
      page,
      page_size: limit,
      order: 'totalrank',
    }, { signed: true })
    const list = (data?.result || []).filter(item => item?.bvid && item?.aid)
    return {
      list: await probeRealQuality(await expandMultiPage(list)),
      allPage: data?.numPages || 1,
      limit,
      total: data?.numResults || 0,
      source: 'bili',
    }
  },
}
