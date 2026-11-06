import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adaptMobileListAction,
  filterListDataForMobile,
  mapMovePositionToDesktop,
  mapMovePositionToMobile,
  primeDesktopOnlyListCache,
  resetDesktopOnlyListCache,
  restoreDesktopOnlyListData,
  toMobileListAction,
} from '../src/main/modules/sync/server/modules/list/compatibility.ts'

const biliMusic = { id: 'bili-1', source: 'bili', name: 'bili' }
const kwMusic = { id: 'kw-1', source: 'kw', name: 'kw' }
const isBili = music => music.source === 'bili'

const listData = () => ({
  defaultList: [biliMusic, kwMusic],
  loveList: [biliMusic],
  userList: [
    { id: 'bili-list', name: 'bili list', source: 'bili', sourceListId: '1', locationUpdateTime: null, list: [biliMusic] },
    { id: 'custom-list', name: 'custom list', locationUpdateTime: null, list: [biliMusic, kwMusic] },
  ],
  tempList: [biliMusic, kwMusic],
})

const createReader = data => ({
  getListMusics: async listId => {
    if (listId === 'default') return data.defaultList
    if (listId === 'love') return data.loveList
    return data.userList.find(list => list.id === listId)?.list ?? []
  },
  getUserLists: async() => data.userList.map(({ list, ...info }) => info),
  getListData: async() => data,
})

test('filters unsupported Bilibili data from mobile list snapshots', () => {
  const data = listData()
  const filtered = filterListDataForMobile(data)

  assert.deepEqual(filtered.defaultList.map(music => music.id), ['kw-1'])
  assert.deepEqual(filtered.loveList, [])
  assert.deepEqual(filtered.tempList.map(music => music.id), ['kw-1'])
  assert.deepEqual(filtered.userList.map(list => list.id), ['custom-list'])
  assert.deepEqual(filtered.userList[0].list.map(music => music.id), ['kw-1'])
  assert.equal(data.defaultList.length, 2)
  assert.equal(data.userList.length, 2)
})

test('filters mixed and unsupported mobile sync actions', async() => {
  const reader = createReader(listData())
  const addAction = await toMobileListAction({
    action: 'list_music_add',
    data: { id: 'default', musicInfos: [biliMusic, kwMusic], addMusicLocationType: 'bottom' },
  }, reader)
  assert.deepEqual(addAction.data.musicInfos.map(music => music.id), ['kw-1'])

  const overwriteAction = await toMobileListAction({
    action: 'list_data_overwrite',
    data: listData(),
  }, reader)
  assert.deepEqual(overwriteAction.data.defaultList.map(music => music.id), ['kw-1'])

  // 列表只剩 B 站歌曲时下发空覆盖，移动端不会残留旧歌曲
  const onlyBiliOverwrite = await toMobileListAction({
    action: 'list_music_overwrite',
    data: { listId: 'default', musicInfos: [biliMusic] },
  }, reader)
  assert.deepEqual(onlyBiliOverwrite.data.musicInfos, [])
  assert.equal(await toMobileListAction({
    action: 'list_update',
    data: [{ id: 'bili-list', name: 'bili', source: 'bili', locationUpdateTime: null }],
  }, reader), null)
})

test('mobile overwrite and clear keep local Bilibili songs', async() => {
  const reader = createReader(listData())
  const [overwrite] = await adaptMobileListAction({
    action: 'list_music_overwrite',
    data: { listId: 'custom-list', musicInfos: [] },
  }, reader)
  assert.deepEqual(overwrite.data.musicInfos.map(music => music.id), ['bili-1'])

  const cleared = await adaptMobileListAction({ action: 'list_music_clear', data: ['custom-list'] }, reader)
  assert.deepEqual(cleared, [{ action: 'list_music_overwrite', data: { listId: 'custom-list', musicInfos: [biliMusic] } }])
})

test('mobile full overwrite keeps local Bilibili songs and lists', () => {
  const local = listData()
  const remote = filterListDataForMobile(local)
  remote.defaultList = []
  const restored = restoreDesktopOnlyListData(remote, local)
  assert.deepEqual(restored.defaultList.map(music => music.id), ['bili-1'])
  assert.deepEqual(restored.loveList.map(music => music.id), ['bili-1'])
  assert.deepEqual(restored.userList.map(list => list.id), ['bili-list', 'custom-list'])
  assert.deepEqual(restored.userList[1].list.map(music => music.id), ['bili-1', 'kw-1'])
})

test('position mapping skips Bilibili songs in both directions', () => {
  const list = [{ id: 'a' }, { id: 'B', source: 'bili' }, { id: 'b' }, { id: 'c' }]
  // 移动端 [a,b,c] 把 c 移到位置 1（b 之前）→ 桌面端插在 b 之前
  assert.equal(mapMovePositionToDesktop(list, ['c'], 1, isBili), 2)
  // 移到末尾 → 插在最后一个可见歌曲之后
  assert.equal(mapMovePositionToDesktop(list, ['a'], 2, isBili), 3)
  // 桌面端把 c 插到 B 之前（位置 1）→ 移动端位置 1
  assert.equal(mapMovePositionToMobile(list, ['c'], 1, isBili), 1)
  // 不含 B 站歌曲时位置不变
  const plain = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(mapMovePositionToDesktop(plain, ['c'], 1, isBili), 1)
  assert.equal(mapMovePositionToMobile(plain, ['c'], 1, isBili), 1)
})

test('operations targeting a Bilibili-source list are never sent to mobile', async() => {
  const data = listData()
  const reader = createReader(data)
  const targeted = [
    { action: 'list_music_overwrite', data: { listId: 'bili-list', musicInfos: [biliMusic, kwMusic] } },
    { action: 'list_music_overwrite', data: { listId: 'bili-list', musicInfos: [] } },
    { action: 'list_music_add', data: { id: 'bili-list', musicInfos: [kwMusic], addMusicLocationType: 'bottom' } },
    { action: 'list_music_clear', data: ['bili-list'] },
    { action: 'list_music_remove', data: { listId: 'bili-list', ids: ['kw-1'] } },
    { action: 'list_music_update_position', data: { listId: 'bili-list', position: 0, ids: ['kw-1'] } },
    { action: 'list_music_update', data: [{ id: 'bili-list', musicInfo: kwMusic }] },
    { action: 'list_create', data: { position: 0, listInfos: [{ id: 'bili-new', name: 'b', source: 'bili', locationUpdateTime: null }] } },
    { action: 'list_update_position', data: { position: 0, ids: ['bili-list'] } },
  ]
  for (const action of targeted) assert.equal(await toMobileListAction(action, reader), null, action.action)

  // 混合目标时只保留普通歌单
  const clear = await toMobileListAction({ action: 'list_music_clear', data: ['bili-list', 'custom-list'] }, reader)
  assert.deepEqual(clear.data, ['custom-list'])
  // 普通列表只剩 B 站歌曲时仍下发空覆盖
  const overwrite = await toMobileListAction({ action: 'list_music_overwrite', data: { listId: 'custom-list', musicInfos: [biliMusic] } }, reader)
  assert.deepEqual(overwrite.data, { listId: 'custom-list', musicInfos: [] })
})

test('moving songs across a Bilibili-source list only shows the visible side on mobile', async() => {
  const reader = createReader(listData())
  const base = { musicInfos: [biliMusic, kwMusic], addMusicLocationType: 'top' }
  assert.deepEqual(await toMobileListAction({ action: 'list_music_move', data: { ...base, fromId: 'custom-list', toId: 'bili-list' } }, reader),
    { action: 'list_music_remove', data: { listId: 'custom-list', ids: ['kw-1'] } })
  assert.deepEqual(await toMobileListAction({ action: 'list_music_move', data: { ...base, fromId: 'bili-list', toId: 'default' } }, reader),
    { action: 'list_music_add', data: { id: 'default', musicInfos: [kwMusic], addMusicLocationType: 'top' } })
  assert.equal(await toMobileListAction({ action: 'list_music_move', data: { ...base, fromId: 'bili-list', toId: 'bili-list' } }, reader), null)
  const normal = await toMobileListAction({ action: 'list_music_move', data: { ...base, fromId: 'custom-list', toId: 'default' } }, reader)
  assert.deepEqual(normal.data.musicInfos, [kwMusic])
})

test('removing a Bilibili-source list is recognised even after it left the database', async() => {
  resetDesktopOnlyListCache()
  const data = listData()
  await primeDesktopOnlyListCache(createReader(data))
  // 列表事件在数据库删除之后触发：此时已读不到 bili-list
  const afterDelete = createReader({ ...data, userList: data.userList.filter(list => list.id !== 'bili-list') })
  assert.equal(await toMobileListAction({ action: 'list_remove', data: ['bili-list'] }, afterDelete), null)
  const mixed = await toMobileListAction({ action: 'list_remove', data: ['custom-list'] }, afterDelete)
  assert.deepEqual(mixed.data, ['custom-list'])
})
