import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/wy/musicDetail.js')) {
      const source = specifier === '../../index'
        ? 'export const formatPlayTime = x => String(x); export const sizeFormate = x => String(x)'
        : specifier === '../../request'
          ? 'export const httpFetch = () => { throw new Error("unexpected request") }'
          : specifier === './utils/crypto' ? 'export const weapi = x => x' : null
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
test.after(() => hooks.deregister())
const { default: musicDetail } = await import('../src/renderer/utils/musicSdk/wy/musicDetail.js')
const songs = [1, 2, 3].map(id => ({ id, name: `song-${id}`, ar: [{ name: 'artist' }], al: { id: 1, name: 'album' }, dt: 180000, h: { size: 1234 } }))

test('网易云缺失或乱序的权限信息不丢弃有效歌曲，也不推断可用音质', () => {
  const list = musicDetail.filterList({ songs, privileges: [{ id: 3, maxbr: 320000 }] })
  assert.deepEqual(list.map(s => s.songmid), [1, 2, 3])
  assert.deepEqual(list[0].types, [])
  assert.deepEqual(list[1].types, [])
  assert.deepEqual(list[2].types.map(type => type.type), ['128k', '320k'])
})

test('网易云整个权限数组缺失时仍保留歌曲，无效歌曲继续过滤', () => {
  const list = musicDetail.filterList({ songs: [...songs, null, { id: 4, name: '' }] })
  assert.deepEqual(list.map(s => s.songmid), [1, 2, 3])
  assert.ok(list.every(s => s.types.length === 0))
})
