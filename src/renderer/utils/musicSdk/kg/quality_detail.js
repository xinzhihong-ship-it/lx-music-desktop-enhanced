import { httpFetch } from '../../request'
import { dnsLookup } from '../utils'
import { headers, timeout } from '../options'
import { sizeFormate } from '../../index'

const qualityMap = {
  128: '128k',
  320: '320k',
  flac: 'flac',
  high: 'hires',
  viper_clear: 'master',
  viper_atmos: 'atmos',
}

const parseQualityInfo = (goods) => {
  const types = []
  const _types = {}
  for (const item of goods ?? []) {
    const type = qualityMap[item.quality]
    if (!type || !item.hash) continue
    const size = item.info?.filesize ? sizeFormate(item.info.filesize) : null
    types.push({ type, size, hash: item.hash })
    _types[type] = { size, hash: item.hash }
  }
  return { types, _types }
}

const requestMusicQualityInfo = (hashList) => {
  return httpFetch(`https://gateway.kugou.com/goodsmstore/v1/get_res_privilege?appid=1005&clientver=20049&clienttime=${Date.now()}&mid=NeZha`, {
    method: 'post',
    timeout,
    headers,
    body: {
      behavior: 'play',
      clientver: '20049',
      resource: hashList.map(hash => ({ id: 0, type: 'audio', hash })),
      area_code: '1',
      quality: '128',
      qualities: ['128', '320', 'flac', 'high', 'dolby', 'viper_atmos', 'viper_tape', 'viper_clear'],
    },
    lookup: dnsLookup,
    family: 4,
  })
}

export const getMusicQualityInfo = (songInfo) => {
  const requestObj = requestMusicQualityInfo([songInfo.hash])

  requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
    const goods = body?.data?.[0]?.relate_goods
    if (statusCode != 200 || body?.error_code != 0 || !goods) throw new Error('获取音质信息失败')
    return parseQualityInfo(goods)
  })
  return requestObj
}

export const getBatchMusicQualityInfo = (hashList) => {
  const requestObj = requestMusicQualityInfo(hashList)

  requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
    if (statusCode != 200 || body?.error_code != 0 || !Array.isArray(body.data)) {
      throw new Error('获取音质信息失败')
    }
    const qualityInfoMap = {}
    body.data.forEach((songData, index) => {
      const hash = hashList[index]
      if (!hash || !songData?.relate_goods) return
      qualityInfoMap[hash] = parseQualityInfo(songData.relate_goods)
    })
    return qualityInfoMap
  })
  return requestObj
}
