import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
const state = globalThis.__biliPlaylistPages = { repeated: false, requests: 0 }
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@main/utils/request') {
      const source = `export const httpFetch = async url => {
        globalThis.__biliPlaylistPages.requests++
        const page = Number(new URL(url).searchParams.get('pn'))
        const offset = globalThis.__biliPlaylistPages.repeated ? 0 : (page - 1) * 40
        const length = page === 26 ? 1 : 40
        return { statusCode: 200, body: { code: 0, data: { has_more: globalThis.__biliPlaylistPages.repeated || page < 26,
          medias: Array.from({length}, (_, i) => ({ bvid: 'BV' + (offset+i), id: offset+i+1 })) } } }
      }`
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
test.after(() => hooks.deregister())
const { getPlaylistTrackIds } = await import('../src/main/modules/account/providers/bili.ts')
const session = { source: 'bili', cookies: {}, tokens: { userId: 'test' } }

test('B 站收藏夹超过 1000 条继续读取，保留 bvid 和删除 aid', async () => {
  state.repeated = false; state.requests = 0
  const tracks = await getPlaylistTrackIds(session, 'folder')
  assert.equal(tracks.length, 1001)
  assert.equal(tracks.at(-1).id, 'BV1000')
  assert.equal(tracks.at(-1).removeId, '1001')
  assert.equal(state.requests, 26)
})

test('B 站接口持续标记 has_more 但返回重复页时停止且不重复歌曲', async () => {
  state.repeated = true; state.requests = 0
  const tracks = await getPlaylistTrackIds(session, 'folder')
  assert.equal(tracks.length, 40)
  assert.equal(state.requests, 2)
})
