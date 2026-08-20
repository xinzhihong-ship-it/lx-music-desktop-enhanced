import test from 'node:test'
import assert from 'node:assert/strict'
import { filterDuplicateMusicRows } from '../src/renderer/utils/filterMusicRows.ts'

const duplicates = list => filterDuplicateMusicRows(list).map(({ index }) => index)

test('duplicate filter matches base title and artist without merging different artists', () => {
  const list = [
    { name: '星空下的恋人(Edit Version)', singer: '关淑怡' },
    { name: '星空下的恋人', singer: '关淑怡' },
    { name: '星空下的恋人', singer: '其他歌手' },
    { name: '合唱', singer: '甲、乙' },
    { name: '合唱 (Live)', singer: '乙' },
    { name: '单曲', singer: '甲' },
  ]

  assert.deepEqual(duplicates(list), [3, 4, 0, 1])
})

test('duplicate filter keeps exact variants separate when requested', () => {
  const list = [
    { name: '歌曲 (Live)', singer: '歌手' },
    { name: '歌曲', singer: '歌手' },
  ]

  assert.deepEqual(filterDuplicateMusicRows(list, false), [])
})
