import musicSearch from './musicSearch'
import { apis } from '../api-source'

const git = {
  musicSearch,
  getMusicUrl(songInfo, type) {
    return apis('git').getMusicUrl(songInfo, type)
  },
  getLyric(songInfo) {
    try {
      const getLyric = apis('git').getLyric
      if (getLyric) return getLyric(songInfo)
    } catch {}
    return {
      promise: Promise.resolve({
        lyric: songInfo.platformData?.lyrics || '',
        tlyric: '',
        rlyric: '',
        lxlyric: '',
      }),
    }
  },
  getPic(songInfo) {
    try {
      const getPic = apis('git').getPic
      if (getPic) return getPic(songInfo).promise
    } catch {}
    return Promise.resolve(songInfo.img || '')
  },
  getMusicDetailPageUrl() {
    return 'https://gitcode.com/ikun_0014/music'
  },
}

export default git
