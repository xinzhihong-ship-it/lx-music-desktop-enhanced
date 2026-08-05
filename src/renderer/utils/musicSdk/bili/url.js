const BILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv', 'www.b23.tv'])
const VIDEO_ID_RXP = /^(BV[0-9A-Za-z]+|av\d+)$/i

const normalizeVideoId = id => /^av/i.test(id) ? `av${id.slice(2)}` : `BV${id.slice(2)}`

export const parseBiliVideoUrl = value => {
  const text = String(value ?? '').trim()
  if (!text) return null

  if (VIDEO_ID_RXP.test(text)) return { videoId: normalizeVideoId(text), page: 1 }

  let url
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }

  const hostname = url.hostname.toLowerCase()
  if (!BILI_HOSTS.has(hostname)) return null

  const pathId = url.pathname.match(/^\/video\/([^/]+)\/?$/i)?.[1] ??
    (hostname.endsWith('b23.tv') ? url.pathname.match(/^\/([^/]+)\/?$/)?.[1] : null)
  const page = Number.parseInt(url.searchParams.get('p') || '1', 10)
  const safePage = Number.isInteger(page) && page > 0 ? page : 1
  if (!pathId) return null
  if (VIDEO_ID_RXP.test(pathId)) return { videoId: normalizeVideoId(pathId), page: safePage }
  if (hostname.endsWith('b23.tv')) return { shortUrl: url.toString(), page: safePage }
  return null
}
