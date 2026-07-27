import musicSearch from './musicSearch'
import { apis } from '../api-source'
import { getMusicUrl as getLocalMusicUrl } from './api'

const git = {
  musicSearch,
  getMusicUrl(songInfo, type) {
    // 优先走自定义源解析；解析失败（如用户配置了自定义源数据库之外的索引）时，
    // 回退到本地索引自解析（直接使用记录中的 download_url），保证搜索与播放自洽
    try {
      const request = apis('git').getMusicUrl(songInfo, type)
      return {
        promise: request.promise.catch(err => getLocalMusicUrl(songInfo).catch(() => { throw err })),
        cancelHttp: request.cancelHttp ?? (() => {}),
      }
    } catch {
      return { promise: getLocalMusicUrl(songInfo), cancelHttp: () => {} }
    }
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
