import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const state = globalThis.__kugouPlaylist = {
  requests: [],
  pages: null,
  songs: [],
  mutationResult: { status: 1 },
  mutateBeforeThrow: false,
  delayedDeleteReads: 0,
  delayedDeleteSongs: [],
}

const virtualModules = new Map([
  ['@main/utils/request', `
    export const httpFetch = async (url, options = {}) => {
      const entry = { url: String(url), options }
      globalThis.__kugouPlaylist.requests.push(entry)
      if (entry.url.includes('get_list_all_file')) {
        const body = JSON.parse(options.text || '{}')
        entry.body = body
        const page = Number(body.page || 1)
        let rows = globalThis.__kugouPlaylist.pages
          ? (globalThis.__kugouPlaylist.pages[page - 1] || [])
          : globalThis.__kugouPlaylist.songs
        if (globalThis.__kugouPlaylist.delayedDeleteReads > 0) {
          rows = [...rows, ...globalThis.__kugouPlaylist.delayedDeleteSongs]
          globalThis.__kugouPlaylist.delayedDeleteReads--
        }
        return {
          statusCode: 200,
          body: { status: 1, data: { songs: rows, ...(globalThis.__kugouPlaylist.pages ? {} : { count: rows.length }) } },
        }
      }
      if (entry.url.includes('add_song')) {
        entry.body = JSON.parse(options.text || '{}')
        const result = globalThis.__kugouPlaylist.mutationResult
        if (globalThis.__kugouPlaylist.mutateBeforeThrow) {
          for (const song of entry.body.data ?? []) {
            globalThis.__kugouPlaylist.songs.push({ hash: song.hash, fileid: 700 + globalThis.__kugouPlaylist.songs.length })
          }
          throw new Error('请求超时')
        }
        if (result?.status === 1) {
          for (const song of entry.body.data ?? []) {
            globalThis.__kugouPlaylist.songs.push({ hash: song.hash, fileid: 700 + globalThis.__kugouPlaylist.songs.length })
          }
        }
        return { statusCode: 200, body: result }
      }
      if (entry.url.includes('delete_songs')) {
        entry.body = JSON.parse(options.text || '{}')
        const ids = new Set((entry.body.data ?? []).map(item => String(item.fileid)))
        const result = globalThis.__kugouPlaylist.mutationResult
        if (result?.status === 1) {
          globalThis.__kugouPlaylist.delayedDeleteSongs = globalThis.__kugouPlaylist.songs
            .filter(song => ids.has(String(song.fileid)))
          globalThis.__kugouPlaylist.songs = globalThis.__kugouPlaylist.songs.filter(song => !ids.has(String(song.fileid)))
          globalThis.__kugouPlaylist.delayedDeleteReads = globalThis.__kugouPlaylist.delayedDeleteReads || 0
        }
        return { statusCode: 200, body: result }
      }
      throw new Error('unexpected request: ' + entry.url)
    }
  `],
])

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const virtual = virtualModules.get(specifier)
    if (virtual != null) {
      return { url: `data:text/javascript,${encodeURIComponent(virtual)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const {
  getPlaylistTrackIds,
  addPlaylistTracks,
  removePlaylistTracks,
} = await import('../src/main/modules/account/providers/kg.ts')

const session = {
  source: 'kg',
  cookies: { dfid: '-', KUGOU_API_MID: 'mid' },
  tokens: { userId: '123', token: 'token' },
}

const reset = () => {
  state.requests.length = 0
  state.pages = null
  state.songs = []
  state.mutationResult = { status: 1 }
  state.mutateBeforeThrow = false
  state.delayedDeleteReads = 0
  state.delayedDeleteSongs = []
}

test.after(() => hooks?.deregister?.())

test('酷狗普通歌单使用 listid 接口并保留真实 fileid，不把 audio_id 当删除 ID', async() => {
  reset()
  state.songs = [
    { hash: 'ABCDEF', fileid: 11, audio_id: 9911 },
    { hash: 'Second', fileid: 12, audio_id: 9912 },
  ]

  const tracks = await getPlaylistTrackIds(session, 'collection_1', '88')
  assert.deepEqual(tracks, [
    { id: 'ABCDEF', removeId: '11' },
    { id: 'Second', removeId: '12' },
  ])
  const request = state.requests.find(item => item.url.includes('get_list_all_file'))
  assert.equal(request.body.listid, 88)
  assert.equal(request.body.page, 1)
})

test('酷狗歌单按 list_sort 显示最新添加歌曲在前', async() => {
  reset()
  state.songs = [
    { hash: 'older', fileid: 11, list_sort: 2 },
    { hash: 'newer', fileid: 12, list_sort: 0 },
  ]

  const tracks = await getPlaylistTrackIds(session, 'collection_1', '88')
  assert.deepEqual(tracks.map(track => track.id), ['newer', 'older'])
  assert.deepEqual(tracks.map(track => track.removeId), ['12', '11'])
})

test('酷狗歌单分页在缺少总数和重复页时仍保留顺序并停止', async() => {
  reset()
  state.pages = [
    Array.from({ length: 300 }, (_, index) => ({ hash: `hash-${index}`, fileid: index + 1 })),
    Array.from({ length: 300 }, (_, index) => ({ hash: `hash-${index + 300}`, fileid: index + 301 })),
    Array.from({ length: 300 }, (_, index) => ({ hash: `hash-${index + 300}`, fileid: index + 301 })),
  ]

  const tracks = await getPlaylistTrackIds(session, 'collection_1', '88')
  assert.equal(tracks.length, 600)
  assert.equal(tracks[0].id, 'hash-0')
  assert.equal(tracks.at(-1).removeId, '600')
  assert.equal(state.requests.filter(item => item.url.includes('get_list_all_file')).length, 3)
})

test('酷狗添加歌曲必须有明确成功状态，并回读确认云端结果', async() => {
  reset()
  state.songs = [{ hash: 'existing', fileid: 11 }]
  await addPlaylistTracks(session, 'collection_1', '88', [{
    source: 'kg',
    songId: '1234',
    name: 'new song',
    hash: 'NewHash',
  }])

  const request = state.requests.find(item => item.url.includes('add_song'))
  assert.equal(request.body.listid, '88')
  assert.equal(request.body.data[0].hash, 'NewHash')
  assert.ok(state.requests.filter(item => item.url.includes('get_list_all_file')).length >= 1)
})

test('酷狗添加响应带已提交歌曲时立即确认，不等待歌单缓存回读', async() => {
  reset()
  state.mutationResult = {
    status: 1,
    data: {
      status: 1,
      info: [{ hash: 'NewHash', fileid: 701 }],
      count: 1,
      list_ver: 2,
    },
  }
  await addPlaylistTracks(session, 'collection_1', '88', [{
    source: 'kg',
    songId: '1234',
    name: 'new song',
    hash: 'newhash',
  }])
  assert.equal(state.requests.filter(item => item.url.includes('get_list_all_file')).length, 0)
})

test('酷狗添加响应缺少 status 时不能提示成功', async() => {
  reset()
  state.mutationResult = { code: 0 }
  await assert.rejects(
    () => addPlaylistTracks(session, 'collection_1', '88', [{
      source: 'kg',
      songId: '1234',
      name: 'unknown result',
      hash: 'MissingHash',
    }]),
    /结果待确认/,
  )
})

test('酷狗添加外层成功但 data.status 失败时不能提示成功', async() => {
  reset()
  state.mutationResult = { status: 1, data: { status: 0, msg: 'invalid song' } }
  await assert.rejects(
    () => addPlaylistTracks(session, 'collection_1', '88', [{
      source: 'kg',
      songId: '1234',
      name: 'failed song',
      hash: 'FailedHash',
    }]),
    /添加歌曲失败.*invalid song/,
  )
})

test('酷狗删除按 Hash 重新取得 fileid，忽略传入的 audio_id', async() => {
  reset()
  state.songs = [{ hash: 'AbCdEf', fileid: 42, audio_id: 9999 }]
  await removePlaylistTracks(session, 'collection_1', '88', [{
    source: 'kg',
    songId: '9999',
    name: 'song',
    hash: 'abcdef',
  }])

  const request = state.requests.find(item => item.url.includes('delete_songs'))
  assert.deepEqual(request.body.data, [{ fileid: 42 }])
  assert.equal(state.songs.length, 0)
})

test('酷狗删除优先复用列表已确认的 fileid，减少一次前置读取', async() => {
  reset()
  state.songs = [{ hash: 'AbCdEf', fileid: 42, audio_id: 9999 }]
  await removePlaylistTracks(session, 'collection_1', '88', [{
    source: 'kg',
    songId: '9999',
    platformId: '42',
    name: 'song',
    hash: 'abcdef',
  }])

  const request = state.requests.find(item => item.url.includes('delete_songs'))
  assert.deepEqual(request.body.data, [{ fileid: 42 }])
  assert.equal(state.requests.filter(item => item.url.includes('get_list_all_file')).length, 1)
})

test('酷狗删除缺少真实 fileid 时拒绝操作', async() => {
  reset()
  state.songs = [{ hash: 'AbCdEf', audio_id: 9999 }]
  await assert.rejects(
    () => removePlaylistTracks(session, 'collection_1', '88', [{
      source: 'kg',
      songId: '9999',
      name: 'song',
      hash: 'abcdef',
    }]),
    /fileid/,
  )
  assert.equal(state.requests.some(item => item.url.includes('delete_songs')), false)
})

test('酷狗删除超时但云端已完成时通过回读确认，不重复提交', async() => {
  reset()
  state.songs = [{ hash: 'AbCdEf', fileid: 42 }]
  state.mutateBeforeThrow = true
  await removePlaylistTracks(session, 'collection_1', '88', [{
    source: 'kg',
    songId: '9999',
    name: 'song',
    hash: 'abcdef',
  }])
  assert.equal(state.requests.filter(item => item.url.includes('delete_songs')).length, 1)
})

test('酷狗删除回读短暂滞后时等待确认，不重复提交', async() => {
  reset()
  state.songs = [{ hash: 'AbCdEf', fileid: 42 }]
  state.delayedDeleteReads = 1
  await removePlaylistTracks(session, 'collection_1', '88', [{
    source: 'kg',
    songId: '9999',
    name: 'song',
    hash: 'abcdef',
  }])
  assert.equal(state.requests.filter(item => item.url.includes('delete_songs')).length, 1)
  assert.equal(state.songs.length, 0)
})

test('酷狗删除响应带新歌单计数时立即确认，不等待旧缓存回读', async() => {
  reset()
  state.songs = [{ hash: 'AbCdEf', fileid: 42 }]
  state.mutationResult = { status: 1, data: { status: 1, count: 0, list_ver: 9 } }
  await removePlaylistTracks(session, 'collection_1', '88', [{
    source: 'kg',
    songId: '9999',
    platformId: '42',
    name: 'song',
    hash: 'abcdef',
  }])
  assert.equal(state.requests.filter(item => item.url.includes('get_list_all_file')).length, 0)
})
