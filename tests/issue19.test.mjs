import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getNextApiSourceId,
  getPlayErrorActions,
  movePlayErrorAction,
  normalizePlayErrorApiSourceCount,
  normalizePlayErrorRetryCount,
  normalizePlayErrorStrategyOrder,
} from '../src/common/utils/playErrorStrategy.ts'

test('playback failure order keeps each supported action exactly once', () => {
  assert.deepEqual(
    normalizePlayErrorStrategyOrder(['quality', 'quality', 'invalid', 'next']),
    ['quality', 'next', 'apiSource', 'platform'],
  )
  assert.deepEqual(movePlayErrorAction(['apiSource', 'platform', 'quality', 'next'], 2, 0), [
    'quality', 'apiSource', 'platform', 'next',
  ])
})

test('legacy strategies keep their original single action', () => {
  assert.deepEqual(getPlayErrorActions('source', []), ['platform'])
  assert.deepEqual(getPlayErrorActions('quality', []), ['quality'])
  assert.deepEqual(getPlayErrorActions('next', []), ['next'])
})

test('retry and source counts are integer and bounded', () => {
  assert.equal(normalizePlayErrorRetryCount('3'), 3)
  assert.equal(normalizePlayErrorRetryCount(99), 5)
  assert.equal(normalizePlayErrorApiSourceCount(0), 1)
  assert.equal(normalizePlayErrorApiSourceCount('bad'), 2)
})

test('automatic source switching follows list order and wraps once', () => {
  assert.equal(getNextApiSourceId('source-b', new Set(['source-b']), ['source-a', 'source-b', 'source-c']), 'source-c')
  assert.equal(getNextApiSourceId('source-c', new Set(['source-b', 'source-c']), ['source-a', 'source-b', 'source-c']), 'source-a')
  assert.equal(getNextApiSourceId('source-a', new Set(['source-a', 'source-b', 'source-c']), ['source-a', 'source-b', 'source-c']), null)
})
