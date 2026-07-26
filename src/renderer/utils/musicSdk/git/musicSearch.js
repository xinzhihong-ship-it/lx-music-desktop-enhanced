import { formatPlayTime } from '../../index'
import { generateSongId, getItemQuality, getRelativePath, loadDatabase } from './util'

const toMusicInfo = item => {
  const relativePath = getRelativePath(item)
  const quality = getItemQuality(item)
  return {
    name: item.title || String(item.filename || '').replace(/\.[^.]+$/, '') || '未知歌曲',
    singer: item.artist || '未知歌手',
    source: 'git',
    songmid: generateSongId(relativePath),
    albumId: item.album || '',
    interval: formatPlayTime(Number(item.duration) || 0),
    albumName: item.album || '未知专辑',
    lrc: null,
    img: item.img || item.cover || '',
    otherSource: null,
    types: [{ type: quality, size: item.filesize || null }],
    _types: { [quality]: { size: item.filesize || null } },
    typeUrl: {},
    platformData: { relativePath, lyrics: item.lyrics || '' },
  }
}

export default {
  limit: 30,
  async search(keyword, page = 1, limit = 30) {
    const words = keyword.toLowerCase().split(/\s+/).filter(Boolean)
    const matched = (await loadDatabase()).filter(item => {
      const fields = [item.title, item.artist, item.album, item.filename].map(value => String(value || '').toLowerCase())
      return words.every(word => fields.some(field => field.includes(word)))
    })
    const start = (page - 1) * limit
    return {
      list: matched.slice(start, start + limit).map(toMusicInfo),
      allPage: Math.ceil(matched.length / limit),
      limit,
      total: matched.length,
      source: 'git',
    }
  },
}
