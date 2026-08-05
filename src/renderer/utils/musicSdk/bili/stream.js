export const getStreamUrls = audio => {
  const urls = [
    audio?.baseUrl,
    audio?.base_url,
    ...(Array.isArray(audio?.backupUrl) ? audio.backupUrl : []),
    ...(Array.isArray(audio?.backup_url) ? audio.backup_url : []),
  ]
  return [...new Set(urls.filter(url => typeof url == 'string' && url))]
}

export const pickStreamUrl = (urls, isRefresh, previousIndex = 0) => {
  if (!urls.length) return { url: '', index: 0 }
  const index = isRefresh ? Math.min(previousIndex + 1, urls.length - 1) : 0
  return { url: urls[index], index }
}
