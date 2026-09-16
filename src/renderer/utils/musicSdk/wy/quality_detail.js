import { httpFetch } from '../../request'
import { dnsLookup } from '../utils'
import { headers, timeout } from '../options'
import { sizeFormate } from '../../index'

export const getMusicQualityInfo = (id) => {
  const requestObj = httpFetch(`https://music.163.com/api/song/music/detail/get?songId=${id}`, {
    method: 'get',
    timeout,
    headers,
    lookup: dnsLookup,
    family: 4,
  })

  requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
    if (statusCode != 200 || body?.code != 200 || !body.data) throw new Error('获取音质信息失败')
    const types = []
    const _types = {}
    const addQuality = (type, info) => {
      // 落到同一档位的字段不止一个（网易的 Hi-Res 与高清臻音都是 24bit 无损），
      // 先到先得，避免同一档位在档位列表里出现两次。
      if (!info?.size || _types[type]) return
      const size = sizeFormate(info.size)
      types.push({ type, size })
      _types[type] = { size }
    }
    addQuality('128k', body.data.l)
    // m 是 192kbps 的「较高」音质，不是 128k
    addQuality('192k', body.data.m)
    addQuality('320k', body.data.h)
    addQuality('flac', body.data.sq)
    addQuality('hires', body.data.hr)
    // je（高清臻音）实测为 96kHz / 24bit 无损，与 QQ 的 size_hires 是同一规格，同属 24bit 无损档
    addQuality('hires', body.data.je)
    addQuality('master', body.data.jm)
    // 真正的杜比全景声是 db（768kbps / 48kHz E-AC3）；je 不是全景声
    addQuality('atmos', body.data.db)
    return { types, _types }
  })
  return requestObj
}

export const getBatchMusicQualityInfo = async(idList) => {
  const entries = []
  for (let index = 0; index < idList.length; index += 20) {
    entries.push(...await Promise.all(idList.slice(index, index + 20).map(async id => {
      try {
        return [id, await getMusicQualityInfo(id).promise]
      } catch {
        return [id, null]
      }
    })))
  }
  return Object.fromEntries(entries.filter(([, qualityInfo]) => qualityInfo))
}
