// 读已登录平台账号的歌单、每日推荐里的歌：先从主进程（modules/account）拿到歌的 ID，再按平台补齐歌曲详情，
// 换成本软件的歌曲信息。「平台音乐」页面和「Folia 对接」共用这一份。
import { toNewMusicInfo } from '@renderer/utils'
import { getAccountDailyTrackIds, getAccountPlaylistTrackIds } from '@renderer/utils/ipc'
import { getMusicInfos as getKgMusicInfos, getPlaylistMusicInfos as getKgPlaylistMusicInfos } from '@renderer/utils/musicSdk/kg/musicInfo'
import { getMusicInfos as getBiliMusicInfos } from '@renderer/utils/musicSdk/bili/musicInfo'
import txMusicInfo from '@renderer/utils/musicSdk/tx/musicInfo'
import wyMusicDetail from '@renderer/utils/musicSdk/wy/musicDetail'

/**
 * 限并发地映射一批数据。
 *
 * QQ 音乐的歌曲详情接口是「一次一首」，而歌单可能有几百首。若直接用
 * Promise.all 同时发起，会瞬间建立上百条 TLS 连接，连接会被网络栈/代理挤断，
 * 报出 "Client network socket disconnected before secure TLS connection was established"。
 * 这里把并发压到一个小窗口，既快又不会打爆连接。
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async() => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run)
  await Promise.all(runners)
  return results
}

/** QQ 音乐详情接口的并发上限：太高会被网络层掐断，太低会明显变慢。 */
const TX_DETAIL_CONCURRENCY = 6

export const loadDailyDetails = async(source: LX.Account.Source, ids: string[]) => {
  switch (source) {
    case 'wy': {
      const chunks: string[][] = []
      for (let index = 0; index < ids.length; index += 500) chunks.push(ids.slice(index, index + 500))
      return (await Promise.all(chunks.map(async chunk => (await wyMusicDetail.getList(chunk)).list))).flat()
    }
    case 'tx': {
      // 逐首取详情，但严格限制同时进行的请求数（见 mapWithConcurrency 的说明）。
      // 单曲失败（下架/无版权/偶发网络抖动）不应让整个歌单加载失败，
      // 但若全军覆没就必须把错误抛出去，否则界面会只剩一个空列表、看不出原因。
      let firstError: unknown = null
      let failed = 0
      const list = await mapWithConcurrency(ids, TX_DETAIL_CONCURRENCY, async(id) => {
        try {
          return await txMusicInfo(id)
        } catch (err) {
          failed++
          firstError ??= err
          return null
        }
      })
      if (ids.length && failed === ids.length) throw firstError
      return list
    }
    case 'kg':
      return getKgMusicInfos(ids.map(hash => ({ hash })))
    case 'bili':
      return getBiliMusicInfos(ids)
  }
}

export const loadPlaylistDetails = async(
  source: LX.Account.Source,
  tracks: LX.Account.PlaylistTrackInfo[],
) => {
  const details = new Array<any>(tracks.length)
  const missing: Array<{ index: number, id: string }> = []
  tracks.forEach((track, index) => {
    if (track.detail) details[index] = track.detail
    else missing.push({ index, id: track.id })
  })

  if (missing.length) {
    const loaded = source === 'kg'
      ? await getKgPlaylistMusicInfos(missing.map(item => ({ hash: item.id })))
      : await loadDailyDetails(source, missing.map(item => item.id))
    // 详情接口可能过滤下架歌曲，不能按数组下标回填，否则一首缺失会让后续歌曲错位。
    const loadedById = new Map<string, any>()
    for (const detail of loaded) {
      const id = source === 'kg' ? detail?.hash : detail?.songmid
      const key = String(id ?? '').trim().toLowerCase()
      if (key) loadedById.set(key, detail)
    }
    missing.forEach(item => {
      const key = item.id.trim().toLowerCase()
      details[item.index] = loadedById.get(key)
    })
  }
  return details
}

/**
 * 补齐的详情换成歌曲信息；给了歌单的条目时，每首记下它在平台歌单里的条目 ID（meta.accountTrackId，从平台歌单删歌要用）。
 * 读不到详情的（下架等）略过。
 */
export const toAccountMusicInfos = (list: any[], tracks?: LX.Account.PlaylistTrackInfo[]): LX.Music.MusicInfoOnline[] => {
  const normalizeTrackId = (value: unknown) => String(value ?? '').trim().toLowerCase()
  const trackMap = new Map<string, string | undefined>()
  for (const track of tracks ?? []) {
    for (const id of [
      track.id,
      track.removeId,
      track.detail?.songmid,
      track.detail?.songId,
      track.detail?.hash,
    ]) {
      const key = normalizeTrackId(id)
      if (key) trackMap.set(key, track.removeId)
    }
  }
  return list.filter(Boolean).map(item => {
    const musicInfo = toNewMusicInfo(item) as LX.Music.MusicInfoOnline
    const meta = musicInfo.meta as any
    const trackId = musicInfo.source == 'kg'
      ? normalizeTrackId(meta.hash)
      : String(meta.songId ?? meta.strMediaMid ?? '')
    meta.accountTrackId = trackMap.get(trackId)
    return musicInfo
  })
}

const PLATFORM_SOURCE_ORDER: Partial<Record<LX.Account.Source, number>> = {
  tx: 0,
  wy: 1,
  kg: 2,
  bili: 3,
}

/** 账号按平台排（QQ、网易云、酷狗、B 站），同一平台的保持原来的顺序 */
export const sortPlatformAccounts = (list: LX.Account.PlatformAccount[]) => list
  .map((account, index) => ({ account, index }))
  .sort((a, b) => (
    (PLATFORM_SOURCE_ORDER[a.account.source] ?? 99) -
    (PLATFORM_SOURCE_ORDER[b.account.source] ?? 99) ||
    a.index - b.index
  ))
  .map(({ account }) => account)

/** 一个账号一张歌单里的歌 */
export const readAccountPlaylistMusics = async(account: LX.Account.PlatformAccount, playlistId: string, dirId?: string) => {
  const tracks = await getAccountPlaylistTrackIds(account.id, playlistId, dirId)
  return toAccountMusicInfos(await loadPlaylistDetails(account.source, tracks), tracks)
}

/** 一个账号的每日推荐（B 站没有） */
export const readAccountDailyMusics = async(account: LX.Account.PlatformAccount) => {
  const ids = await getAccountDailyTrackIds(account.id)
  return toAccountMusicInfos(await loadDailyDetails(account.source, ids) ?? [])
}
