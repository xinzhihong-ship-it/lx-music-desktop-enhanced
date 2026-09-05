import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterListActionForMobile,
  filterListDataForMobile,
} from '../src/main/modules/sync/server/modules/list/compatibility.ts'

const biliMusic = { id: 'bili-1', source: 'bili', name: 'bili' }
const kwMusic = { id: 'kw-1', source: 'kw', name: 'kw' }

const listData = () => ({
  defaultList: [biliMusic, kwMusic],
  loveList: [biliMusic],
  userList: [
    { id: 'bili-list', name: 'bili list', source: 'bili', sourceListId: '1', locationUpdateTime: null, list: [biliMusic] },
    { id: 'custom-list', name: 'custom list', locationUpdateTime: null, list: [biliMusic, kwMusic] },
  ],
  tempList: [biliMusic, kwMusic],
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

test('filters mixed and unsupported mobile sync actions', () => {
  const addAction = filterListActionForMobile({
    action: 'list_music_add',
    data: { id: 'default', musicInfos: [biliMusic, kwMusic], addMusicLocationType: 'bottom' },
  })
  assert.deepEqual(addAction.data.musicInfos.map(music => music.id), ['kw-1'])

  const overwriteAction = filterListActionForMobile({
    action: 'list_data_overwrite',
    data: listData(),
  })
  assert.deepEqual(overwriteAction.data.defaultList.map(music => music.id), ['kw-1'])

  assert.equal(filterListActionForMobile({
    action: 'list_music_overwrite',
    data: { listId: 'default', musicInfos: [biliMusic] },
  }), null)
  assert.equal(filterListActionForMobile({
    action: 'list_update',
    data: [{ id: 'bili-list', name: 'bili', source: 'bili', locationUpdateTime: null }],
  }), null)
})
