import { httpFetch } from '../../request'
import { sizeFormate } from '../../index'

export const getMusicQualityInfo = (songInfo) => {
  const songId = Number(songInfo.songId)
  const requestObj = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'post',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
    },
    body: {
      comm: { ct: '19', cv: '1859', uin: '0' },
      req: {
        module: 'music.trackInfo.UniformRuleCtrl',
        method: 'CgiGetTrackInfo',
        param: { types: [1], ids: [songId], ctx: 0 },
      },
    },
  })

  requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
    const file = body?.req?.data?.tracks?.[0]?.file
    if (statusCode != 200 || body?.code != 0 || !file) throw new Error('获取音质信息失败')
    const types = []
    const _types = {}
    const addQuality = (type, sizeValue) => {
      if (!sizeValue) return
      const size = sizeFormate(sizeValue)
      types.push({ type, size })
      _types[type] = { size }
    }
    addQuality('128k', file.size_128mp3)
    addQuality('320k', file.size_320mp3)
    addQuality('flac', file.size_flac)
    addQuality('hires', file.size_hires)
    addQuality('master', file.size_new?.[0])
    addQuality('atmos', file.size_new?.[1])
    addQuality('atmos_plus', file.size_new?.[2])
    return { types, _types }
  })
  return requestObj
}
