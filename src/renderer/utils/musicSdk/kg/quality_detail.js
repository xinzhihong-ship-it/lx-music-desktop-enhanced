import { httpFetch } from '../../request'
import { dnsLookup } from '../utils'
import { headers, timeout } from '../options'
import { sizeFormate } from '../../index'

export const getMusicQualityInfo = (songInfo) => {
  const hash = songInfo.hash
  const requestObj = httpFetch(`https://gateway.kugou.com/goodsmstore/v1/get_res_privilege?appid=1005&clientver=20049&clienttime=${Date.now()}&mid=NeZha`, {
    method: 'post',
    timeout,
    headers,
    body: {
      behavior: 'play',
      clientver: '20049',
      resource: [{ id: 0, type: 'audio', hash }],
      area_code: '1',
      quality: '128',
      qualities: ['128', '320', 'flac', 'high', 'dolby', 'viper_atmos', 'viper_tape', 'viper_clear'],
    },
    lookup: dnsLookup,
    family: 4,
  })

  requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
    const goods = body?.data?.[0]?.relate_goods
    if (statusCode != 200 || body?.error_code != 0 || !goods) throw new Error('获取音质信息失败')
    const types = []
    const _types = {}
    const qualityMap = {
      128: '128k',
      320: '320k',
      flac: 'flac',
      high: 'hires',
      viper_clear: 'master',
      viper_atmos: 'atmos',
    }
    for (const item of goods) {
      const type = qualityMap[item.quality]
      if (!type || !item.hash) continue
      const size = item.info?.filesize ? sizeFormate(item.info.filesize) : null
      types.push({ type, size, hash: item.hash })
      _types[type] = { size, hash: item.hash }
    }
    return { types, _types }
  })
  return requestObj
}
