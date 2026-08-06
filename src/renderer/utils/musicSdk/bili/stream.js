const isMcdnUrl = url => /\.mcdn\.bilivideo\.cn(?::\d+)?\//i.test(url)

export const getStreamUrls = audio => {
  const urls = [
    audio?.url,
    audio?.baseUrl,
    audio?.base_url,
    ...(Array.isArray(audio?.backupUrl) ? audio.backupUrl : []),
    ...(Array.isArray(audio?.backup_url) ? audio.backup_url : []),
  ]
  const uniqueUrls = [...new Set(urls.filter(url => typeof url == 'string' && url))]
  // 部分网络下 mcdn 节点会对 MPV 返回 403，优先使用同一响应里的 upos 备用节点。
  return [
    ...uniqueUrls.filter(url => !isMcdnUrl(url)),
    ...uniqueUrls.filter(url => isMcdnUrl(url)),
  ]
}

export const pickStreamUrl = (urls, isRefresh, previousIndex = 0) => {
  if (!urls.length) return { url: '', index: 0 }
  const index = isRefresh ? Math.min(previousIndex + 1, urls.length - 1) : 0
  return { url: urls[index], index }
}
