import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPlaylistChanges, recordPlaylistChange } from '../src/renderer/utils/platformPlaylistChanges.ts'

let counter = 0
const destination = (source = 'kg') => ({ account: { id: `${source}-account-${++counter}` }, playlist: { id: 'playlist' } })
const song = (id, source = 'kg') => ({ id: `${source}_${id}`, source, name: id, meta: { hash: id, songId: id, accountTrackId: 'old-fileid', _qualitys: {} } })

for (const source of ['kg', 'tx', 'wy', 'bili']) {
  test(`${source} 写入成功后立即显示新增歌曲，旧缓存不回滚，云端确认后保留 fileid`, () => {
    const dest = destination(source)
    const existing = song('existing', source)
    const added = song('added', source)
    recordPlaylistChange(dest, [added], 'add', 1)
    const visible = applyPlaylistChanges(dest, [existing])
    assert.deepEqual(visible.map(s => s.name), ['added', 'existing'])
    assert.equal(visible[0].meta.accountTrackId, undefined)
    assert.equal(added.meta.accountTrackId, 'old-fileid')
    assert.deepEqual(applyPlaylistChanges(dest, [existing], 1).map(s => s.name), ['added', 'existing'])
    const confirmed = { ...added, meta: { ...added.meta, accountTrackId: 'new-fileid' } }
    assert.equal(applyPlaylistChanges(dest, [confirmed, existing], 1)[0].meta.accountTrackId, 'new-fileid')
    assert.deepEqual(applyPlaylistChanges(dest, [existing], 2), [existing])
  })

  test(`${source} 成功移除立即隐藏，旧缓存和旧请求不能让歌曲恢复`, () => {
    const dest = destination(source)
    const removed = song('removed', source)
    const other = song('other', source)
    recordPlaylistChange(dest, [removed], 'remove', 2)
    assert.deepEqual(applyPlaylistChanges(dest, [removed, other]), [other])
    // A request started before the operation cannot confirm it.
    applyPlaylistChanges(dest, [other], 1)
    assert.deepEqual(applyPlaylistChanges(dest, [removed, other], 1), [other])
    assert.deepEqual(applyPlaylistChanges(dest, [other], 2), [other])
    // Confirmed changes stop overriding subsequent cloud results.
    assert.deepEqual(applyPlaylistChanges(dest, [removed, other], 3), [removed, other])
  })
}

test('变更只作用于目标账号及歌单，同一首歌曲后续操作覆盖前一次', () => {
  const dest = destination()
  const added = song('ABCDEF')
  recordPlaylistChange(dest, [added], 'add', 1)
  assert.deepEqual(applyPlaylistChanges({ ...dest, playlist: { id: 'another' } }, []), [])
  assert.deepEqual(applyPlaylistChanges(destination(), []), [])
  recordPlaylistChange(dest, [song('abcdef')], 'remove', 2)
  assert.deepEqual(applyPlaylistChanges(dest, [added], 1), [])
  recordPlaylistChange(dest, [added], 'add', 3)
  assert.deepEqual(applyPlaylistChanges(dest, [], 2).map(s => s.name), ['ABCDEF'])
})

// Execute the actual renderer store to ensure failures never publish a local success.
import { registerHooks } from 'node:module'
const state = globalThis.__playlistChangesTest = { fail: false }
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source
    if (specifier === '@common/utils/vueTools') source = 'export const ref = value => ({ value }); export const computed = fn => ({ get value() { return fn() } })'
    if (specifier === '@renderer/utils/ipc') source = `
      const mutate = async () => { if (globalThis.__playlistChangesTest.fail) throw new Error('denied') }
      export const addAccountPlaylistTracks = mutate; export const removeAccountPlaylistTracks = mutate;
      export const getAccounts = async () => []; export const getAccountPlaylists = async () => [];
      export const removeAccount = async () => {};
    `
    if (specifier === '@renderer/utils/musicSdk/bili/util') source = 'export const clearAccountCookieCache = () => {}'
    if (specifier === '@renderer/utils/platformPlaylistChanges') return { url: new URL('../src/renderer/utils/platformPlaylistChanges.ts', import.meta.url).href, shortCircuit: true }
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
test.after(() => hooks.deregister())
const { addToPlatformPlaylist, removeFromPlatformPlaylist, platformPlaylistRevision } = await import('../src/renderer/store/account.ts')

test('平台写操作成功才发布变更，失败不增减列表或修订号', async () => {
  const dest = destination()
  const added = song('added')
  state.fail = true
  const before = platformPlaylistRevision.value
  await assert.rejects(addToPlatformPlaylist(dest, [added]), /denied/)
  await assert.rejects(removeFromPlatformPlaylist(dest, [added]), /denied/)
  assert.equal(platformPlaylistRevision.value, before)
  assert.deepEqual(applyPlaylistChanges(dest, []), [])
  assert.deepEqual(applyPlaylistChanges(dest, [added]), [added])
  state.fail = false
  await addToPlatformPlaylist(dest, [added])
  assert.equal(platformPlaylistRevision.value, before + 1)
  assert.equal(applyPlaylistChanges(dest, []).length, 1)
  await removeFromPlatformPlaylist(dest, [added])
  assert.equal(platformPlaylistRevision.value, before + 2)
  assert.deepEqual(applyPlaylistChanges(dest, [added]), [])
})
