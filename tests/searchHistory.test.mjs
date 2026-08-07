import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEARCH_HISTORY_LIMIT,
  normalizeSearchHistoryLimit,
  trimSearchHistoryList,
} from '../src/common/utils/searchHistory.ts'

test('normalizes and applies a custom search history limit', () => {
  assert.equal(SEARCH_HISTORY_LIMIT.default, 15)
  assert.equal(normalizeSearchHistoryLimit('32'), 32)
  assert.equal(normalizeSearchHistoryLimit(''), SEARCH_HISTORY_LIMIT.default)
  assert.equal(normalizeSearchHistoryLimit(0), SEARCH_HISTORY_LIMIT.min)
  assert.equal(normalizeSearchHistoryLimit(1001), SEARCH_HISTORY_LIMIT.max)

  const list = Array.from({ length: 70 }, (_, index) => String(index))
  assert.equal(trimSearchHistoryList(list, 64), true)
  assert.equal(list.length, 64)
  assert.equal(list.at(-1), '63')
  assert.equal(trimSearchHistoryList(list, 64), false)
})
