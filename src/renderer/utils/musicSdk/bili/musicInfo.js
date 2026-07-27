import { formatPlayTime } from '../../index'
import { normalizePicUrl, mapLimit } from './util'
import { getViewInfo } from './api'

// 供平台账号收藏夹使用：根据 bvid 列表构建标准音乐对象
export const getMusicInfos = async bvids => {
  const list = await mapLimit(bvids, 5, async bvid => {
    try {
      const view = await getViewInfo(bvid)
      if (!view?.cid) return null
      return {
        name: view.title || '',
        singer: view.owner?.name || '未知UP主',
        source: 'bili',
        songmid: view.bvid || bvid,
        albumId: '',
        interval: formatPlayTime(Number(view.duration) || 0),
        albumName: view.tname || 'Bilibili',
        lrc: null,
        img: normalizePicUrl(view.pic),
        otherSource: null,
        types: [{ type: '128k', size: null }],
        _types: { '128k': { size: null } },
        typeUrl: {},
        platformData: {
          bvid: view.bvid || bvid,
          aid: view.aid,
          cid: 0,
          page: 1,
          upName: view.owner?.name || '',
          videoTitle: view.title || '',
        },
      }
    } catch {
      return null
    }
  })
  return list.filter(Boolean)
}
