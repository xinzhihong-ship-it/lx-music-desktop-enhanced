import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') && context.parentURL?.includes('/src/common/utils/lyrics/') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  AUTO_MATCH_SCORE,
  buildSearchKeyword,
  normalizeSingers,
  normalizeTitle,
  parseDuration,
  scoreCandidate,
} = await import('../src/common/utils/lyrics/index.ts')

const song = { name: '晴天', singer: '周杰伦', duration: 269 }

test('normalizeTitle drops version notes, feat. and punctuation, keeps real versions', () => {
  assert.equal(normalizeTitle('晴天 (Live)'), '晴天')
  assert.equal(normalizeTitle('晴天（伴奏）'), '晴天')
  assert.equal(normalizeTitle('Ｈｅｌｌｏ，World!'), 'helloworld')
  assert.equal(normalizeTitle('Song (feat. Someone)'), 'song')
  assert.equal(normalizeTitle('Song ft. Someone'), 'song')
  assert.equal(normalizeTitle('Song (Remix)'), 'songremix', 'a remix is a different version')
})

test('normalizeSingers splits on common separators and dedupes', () => {
  assert.deepEqual(normalizeSingers('周杰伦、费玉清'), ['周杰伦', '费玉清'])
  assert.deepEqual(normalizeSingers('A & B / A'), ['a', 'b'])
  assert.deepEqual(normalizeSingers('Artist feat. Guest'), ['artist', 'guest'])
  assert.deepEqual(normalizeSingers(''), [])
})

test('parseDuration handles mm:ss, h:mm:ss, numbers and junk', () => {
  assert.equal(parseDuration('04:29'), 269)
  assert.equal(parseDuration('1:02:03'), 3723)
  assert.equal(parseDuration(269.4), 269)
  assert.equal(parseDuration('abc'), 0)
  assert.equal(parseDuration(null), 0)
})

test('exact title + singer + duration scores the maximum and is auto-accepted', () => {
  const score = scoreCandidate(song, { name: '晴天', singer: '周杰伦', duration: 270 })
  assert.equal(score, 85)
  assert.ok(score >= AUTO_MATCH_SCORE)
})

test('live version with the same artist still matches; a cover by someone else does not auto-apply', () => {
  assert.ok(scoreCandidate(song, { name: '晴天 (Live)', singer: '周杰伦', duration: 272 }) >= AUTO_MATCH_SCORE)
  const cover = scoreCandidate(song, { name: '晴天', singer: '某翻唱', duration: 268 })
  assert.equal(cover, 60, 'title 40 + duration 20, no singer points')
  assert.ok(cover < AUTO_MATCH_SCORE, 'same title and length is not enough without the singer')
  assert.ok(scoreCandidate(song, { name: '晴天', singer: '周杰伦', duration: 0 }) >= AUTO_MATCH_SCORE, 'title + singer with unknown length is accepted')
})

test('duration gap over 10s rejects the candidate; unknown duration is neutral', () => {
  assert.equal(scoreCandidate(song, { name: '晴天', singer: '周杰伦', duration: 300 }), null)
  assert.equal(scoreCandidate({ ...song, duration: 0 }, { name: '晴天', singer: '周杰伦', duration: 300 }), 70)
})

test('unrelated title gets no title points even with the right singer', () => {
  const score = scoreCandidate(song, { name: '稻香', singer: '周杰伦', duration: 269 })
  assert.equal(score, 45)
  assert.ok(score < AUTO_MATCH_SCORE)
  assert.equal(scoreCandidate(song, { name: '晴', singer: '', duration: 0 }), 5, 'single-char containment does not count')
})

test('buildSearchKeyword uses the title and the first singer', () => {
  assert.equal(buildSearchKeyword({ name: ' 晴天 ', singer: '周杰伦、费玉清' }), '晴天 周杰伦')
  assert.equal(buildSearchKeyword({ name: 'Song', singer: '' }), 'Song')
})

test('setLrcOffsetTag replaces existing offset tags and is parsed back', async() => {
  const { setLrcOffsetTag, buildLyricDoc } = await import('../src/common/utils/lyrics/index.ts')
  const lrc = '[ti:x]\n[offset:300]\n[00:01.00]a\n'
  const shifted = setLrcOffsetTag(lrc, -250)
  assert.equal(shifted, '[offset:-250]\n[ti:x]\n[00:01.00]a\n')
  assert.equal(buildLyricDoc({ lyric: shifted }).offset, -250)
  assert.equal(setLrcOffsetTag(lrc, 0), '[ti:x]\n[00:01.00]a\n')
  assert.equal(setLrcOffsetTag('', 100), '')
  assert.equal(setLrcOffsetTag(null, 100), '')
})
