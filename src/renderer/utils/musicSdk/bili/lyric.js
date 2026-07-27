import { BILI_API, biliGet, parseDuration } from './util'
import { getBvid, getViewInfo } from './api'
import wy from '../wy'

const PLAYER_V2_API = `${BILI_API}/x/player/wbi/v2`

const EMPTY_LYRIC = { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
// 落雪核心要求歌词带时间标签，无字幕且无匹配时返回占位行，避免显示“歌词获取失败”
const NO_LYRIC = { lyric: '[00:00.00]暂无歌词\n', tlyric: '', rlyric: '', lxlyric: '' }

const subtitleToLrc = subtitle => (subtitle?.body || [])
  .map(line => {
    const from = line.from || 0
    const minute = Math.floor(from / 60).toString().padStart(2, '0')
    const second = (from % 60).toFixed(2).padStart(5, '0')
    return `[${minute}:${second}]${line.content || ''}`
  })
  .join('\n')

// 优先中文字幕，其次第一条字幕
const getSubtitleLyric = async songInfo => {
  const bvid = getBvid(songInfo)
  let cid = songInfo.platformData?.cid
  if (!cid) {
    const view = await getViewInfo(bvid)
    const page = songInfo.platformData?.page || 1
    cid = view?.pages?.find(p => p.page == page)?.cid ?? view?.cid
  }
  if (!cid) return ''
  const playerData = await biliGet(PLAYER_V2_API, { bvid, cid }, { signed: true })
  const subtitles = playerData?.subtitle?.subtitles || []
  if (!subtitles.length) return ''
  const subtitle = subtitles.find(s => String(s.lan || '').startsWith('zh')) || subtitles[0]
  let url = subtitle.subtitle_url || ''
  if (url.startsWith('//')) url = `https:${url}`
  if (!url) return ''
  const data = await biliGet(url, {}, { raw: true })
  return subtitleToLrc(data)
}

// 从视频标题提取“《歌名》- 歌手”或“歌名 - 歌手”信息，用于歌词匹配
const parseTitleHint = songInfo => {
  const title = songInfo.platformData?.videoTitle || songInfo.name || ''
  let matched = title.match(/《([^》]+)》\s*[-–—~]\s*([^-–—~'"“”‘’【】]{1,30})/)
  if (matched) return { name: matched[1].trim(), singer: matched[2].trim() }
  matched = title.match(/^【[^】]*】\s*《([^》]+)》\s*[-–—~]?\s*([^-–—~'"“”‘’【】]{1,30})?/)
  if (matched?.[2]) return { name: matched[1].trim(), singer: matched[2].trim() }
  return null
}

const getSeconds = interval => {
  if (!interval) return 0
  if (typeof interval == 'number') return interval
  return parseDuration(interval)
}

// 无字幕时用标题信息在网易云严格匹配歌词（歌名、歌手、时长三重约束，避免误配）
const getWyMatchedLyric = async songInfo => {
  const hint = parseTitleHint(songInfo)
  if (!hint) return ''
  const targetSeconds = getSeconds(songInfo.interval)
  const result = await wy.musicSearch.search(`${hint.name} ${hint.singer}`, 1, 10).catch(() => null)
  if (!result?.list?.length) return ''
  const candidate = result.list.find(item => {
    if (!item.name || !item.singer) return false
    const nameMatched = item.name.includes(hint.name) || hint.name.includes(item.name)
    const singerMatched = item.singer.includes(hint.singer) || hint.singer.includes(item.singer)
    if (!nameMatched || !singerMatched) return false
    const seconds = getSeconds(item.interval)
    return !targetSeconds || !seconds || Math.abs(seconds - targetSeconds) < 8
  })
  if (!candidate) return ''
  const lyricInfo = await wy.getLyric(candidate).promise.catch(() => null)
  return lyricInfo?.lyric || ''
}

const getLyric = songInfo => {
  const promise = (async() => {
    try {
      const subtitleLyric = await getSubtitleLyric(songInfo)
      if (subtitleLyric) return { ...EMPTY_LYRIC, lyric: subtitleLyric }
    } catch (err) {
      console.warn('[bili] subtitle lyric failed:', err)
    }
    try {
      const matchedLyric = await getWyMatchedLyric(songInfo)
      if (matchedLyric) return { ...EMPTY_LYRIC, lyric: matchedLyric }
    } catch (err) {
      console.warn('[bili] matched lyric failed:', err)
    }
    return { ...NO_LYRIC }
  })()
  return { promise, cancelHttp: () => {} }
}

export default getLyric
