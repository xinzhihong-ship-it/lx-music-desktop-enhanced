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
      if (!info?.size) return
      const size = sizeFormate(info.size)
      types.push({ type, size })
      _types[type] = { size }
    }
    addQuality('128k', body.data.l ?? body.data.m)
    addQuality('320k', body.data.h)
    addQuality('flac', body.data.sq)
    addQuality('hires', body.data.hr)
    addQuality('master', body.data.jm)
    addQuality('atmos', body.data.je ?? body.data.db)
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
