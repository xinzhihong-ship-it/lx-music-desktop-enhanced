import musicSearch from './musicSearch'
import getLyric from './lyric'
import { getMusicInfoByUrl } from './musicInfo'
import { getMusicUrl, getMusicQualityInfo, getBvid } from './api'

const bili = {
  musicSearch,
  getMusicInfoByUrl,
  getMusicUrl,
  getMusicQualityInfo,
  getLyric,
  getPic(songInfo) {
    return Promise.resolve(songInfo.img || '')
  },
  getMusicDetailPageUrl(songInfo) {
    return `https://www.bilibili.com/video/${getBvid(songInfo)}`
  },
}

export default bili
