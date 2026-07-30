import { getBatchMusicQualityInfo as getKgQualityInfo } from './kg/quality_detail'
import { getBatchMusicQualityInfo as getWyQualityInfo } from './wy/quality_detail'

const applyQualityInfo = (list, qualityInfoMap, getKey) => {
  for (const item of list) {
    const qualityInfo = qualityInfoMap[getKey(item)]
    if (!qualityInfo) continue
    item.types = qualityInfo.types
    item._types = qualityInfo._types
  }
}

export default async(source, list) => {
  if (!list.length) return list

  try {
    if (source == 'kg') {
      const hashes = [...new Set(list.map(item => item.hash).filter(Boolean))]
      const qualityInfoMap = {}
      for (let index = 0; index < hashes.length; index += 500) {
        const chunks = []
        for (let offset = index; offset < Math.min(index + 500, hashes.length); offset += 100) {
          chunks.push(getKgQualityInfo(hashes.slice(offset, offset + 100)).promise)
        }
        for (const result of await Promise.all(chunks)) Object.assign(qualityInfoMap, result)
      }
      applyQualityInfo(list, qualityInfoMap, item => item.hash)
    } else if (source == 'wy') {
      const ids = [...new Set(list.map(item => item.songmid).filter(Boolean))]
      applyQualityInfo(list, await getWyQualityInfo(ids), item => item.songmid)
    }
  } catch (err) {
    console.warn(`Failed to fetch ${source} list quality info:`, err)
  }

  return list
}
