import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isAmbiguousRecognition,
  promoteRecognitionCandidate,
  selectAlternativeCandidates,
  selectConsensusKey,
} from '../src/main/modules/musicRecognition/decision.ts'

test('Shazam requires the same track in at least two windows', () => {
  assert.equal(selectConsensusKey([]), null)
  assert.equal(selectConsensusKey(['wrong']), null)
  assert.equal(selectConsensusKey(['wrong', 'right', 'right']), 'right')
})

test('platform-only matches remain uncertain even when Kugou and NetEase agree', () => {
  assert.equal(isAmbiguousRecognition(['kg', 'wy'], false), true)
})

test('verified Shazam, ACRCloud, or matching player metadata confirms a result', () => {
  assert.equal(isAmbiguousRecognition(['shazam', 'kg'], false), false)
  assert.equal(isAmbiguousRecognition(['acrcloud', 'wy'], false), false)
  assert.equal(isAmbiguousRecognition(['kg', 'wy'], true), false)
})

test('disagreeing engine results are kept and ordered instead of silently filtered', () => {
  const match = { id: 'kg:1', priority: 0 }
  const candidates = [
    match,
    { id: 'wy:other-title', priority: 2 },
    { id: 'wy:same-title', priority: 1 },
    { id: 'tx:same-recording', priority: 0 },
    { id: 'wy:same-title', priority: 1 },
  ]
  assert.deepEqual(
    selectAlternativeCandidates(match, candidates, item => item.id, (_selected, item) => item.priority, 8),
    [
      { id: 'tx:same-recording', priority: 0 },
      { id: 'wy:same-title', priority: 1 },
      { id: 'wy:other-title', priority: 2 },
    ],
  )
})

test('confirming a candidate preserves the recognition history identity and timestamp', () => {
  const current = {
    id: 'recognition:1',
    title: 'Wrong',
    artist: 'Wrong artist',
    provider: 'kg',
    providerTrackId: 'kg:wrong',
    recognizedAt: 100,
    confidence: 'possible',
  }
  const candidate = {
    id: 'tx:right',
    title: 'Right',
    artist: 'Right artist',
    provider: 'tx',
    providerTrackId: 'tx:right',
    recognizedAt: 200,
    confidence: 'possible',
  }

  assert.deepEqual(promoteRecognitionCandidate(current, candidate), {
    ...candidate,
    id: current.id,
    recognizedAt: current.recognizedAt,
    confidence: 'confirmed',
  })
})
