import { buildDownloadUrl, findDatabaseItem, getItemQuality, getRelativePath } from './util'

export const getMusicUrl = async(songInfo) => {
  const item = await findDatabaseItem(songInfo)
  if (!item) throw new Error('GitCode music information was not found')

  const url = item.download_url || buildDownloadUrl(getRelativePath(item))
  if (!url) throw new Error('GitCode music download URL was not found')
  return {
    type: getItemQuality(item),
    url,
  }
}
