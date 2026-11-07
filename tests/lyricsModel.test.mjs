import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

// 歌词模块内部使用无扩展名的相对导入（webpack 解析），测试里补上 .ts
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') && context.parentURL?.includes('/src/common/utils/lyrics/') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  buildLyricDoc,
  findLineIndex,
  findQuiets,
  hasTimedLyric,
  isCreditLine,
  parseLrc,
  parseLxWords,
  splitWords,
  spreadWords,
  wordProgress,
} = await import('../src/common/utils/lyrics/index.ts')

test('LRC: multiple timestamps on one line, fraction precision, tags and BOM', () => {
  const { entries, tags } = parseLrc('﻿[ti:Song]\n[offset:-200]\n[00:10.5][01:02.345]Hook\n[00:03.20]Intro\n[00:05:50]Old style\nnot lyric\n')
  assert.deepEqual(entries, [
    { time: 3200, text: 'Intro' },
    { time: 5500, text: 'Old style' },
    { time: 10500, text: 'Hook' },
    { time: 62345, text: 'Hook' },
  ])
  assert.equal(tags.ti, 'Song')
  assert.equal(tags.offset, '-200')
})

test('splitWords: CJK one per char, latin words keep their trailing space', () => {
  assert.deepEqual(splitWords('我爱 you so'), ['我', '爱', 'you ', 'so'])
  assert.deepEqual(splitWords('さくら hello'), ['さ', 'く', 'ら', 'hello'])
  assert.equal(splitWords('Hello  world').join(''), 'Hello world')
})

test('spreadWords: 85% of the line shared by visible length', () => {
  const words = spreadWords('ab c', 1000, 2000)
  assert.equal(words.length, 2)
  assert.equal(words[0].start, 1000)
  // ab 占 2/3，c 占 1/3，总共 850ms
  assert.equal(words[0].end, 1567)
  assert.equal(words[1].end, 1850)
  assert.deepEqual(spreadWords('   ', 0, 1000), [])
})

test('lxlrc word timing is relative to the line start', () => {
  assert.deepEqual(parseLxWords('<0,300>你<300,200>好', 5000), [
    { text: '你', start: 5000, end: 5300 },
    { text: '好', start: 5300, end: 5500 },
  ])
  assert.equal(parseLxWords('plain text', 0), null)
  assert.equal(parseLxWords('bad<0,100>x', 0), null)
})

test('buildLyricDoc prefers word timing and aligns translation / roma within 1.5s', () => {
  const doc = buildLyricDoc({
    lyric: '[offset:120]\n[00:01.00]你好\n[00:03.00]世界\n',
    lxlyric: '[00:01.00]<0,400>你<400,400>好\n[00:03.00]<0,500>世<500,500>界\n',
    tlyric: '[00:01.05]Hello\n[00:03.00]//\n[00:09.00]too far\n',
    rlyric: '[00:01.00]ni hao\n[00:02.90]shi jie\n',
  })
  assert.equal(doc.offset, 120)
  assert.equal(doc.hasWords, true)
  assert.equal(doc.hasTranslation, true)
  assert.equal(doc.hasRoma, true)
  assert.deepEqual(doc.lines.map(line => [line.start, line.end, line.text, line.translation, line.roma, line.timedWords]), [
    [1000, 1800, '你好', 'Hello', 'ni hao', true],
    [3000, 4000, '世界', '', 'shi jie', true],
  ])
})

test('buildLyricDoc without word timing: end capped by next stamp or 6s, words estimated', () => {
  const doc = buildLyricDoc({ lyric: '[00:01.00]Line one\n[00:02.00]\n[00:30.00]Long gap\n' })
  assert.equal(doc.hasWords, false)
  assert.deepEqual(doc.lines.map(line => [line.start, line.end]), [[1000, 2000], [30000, 36000]])
  assert.equal(doc.lines[0].words.map(word => word.text).join(''), 'Line one')
  assert.equal(doc.lines[0].timedWords, false)
})

test('buildLyricDoc falls back to plain lyric when lxlyric is mostly invalid', () => {
  const doc = buildLyricDoc({ lyric: '[00:01.00]A\n[00:02.00]B\n', lxlyric: '[00:01.00]A\n[00:02.00]B\n' })
  assert.deepEqual(doc.lines.map(line => line.text), ['A', 'B'])
  assert.equal(doc.hasWords, false)
  assert.deepEqual(buildLyricDoc(null).lines, [])
  assert.equal(hasTimedLyric('[00:01.00]x'), true)
  assert.equal(hasTimedLyric('[00:01.00]\nplain'), false)
})

test('findLineIndex is -1 before the first line and the last started line after', () => {
  const { lines } = buildLyricDoc({ lyric: '[00:01.00]a\n[00:02.00]b\n[00:03.00]c\n' })
  assert.equal(findLineIndex(lines, 0), -1)
  assert.equal(findLineIndex(lines, 1000), 0)
  assert.equal(findLineIndex(lines, 2999), 1)
  assert.equal(findLineIndex(lines, 99999), 2)
  assert.equal(findLineIndex([], 5), -1)
})

test('wordProgress clamps to 0..1', () => {
  const word = { text: 'x', start: 100, end: 300 }
  assert.equal(wordProgress(word, 50), 0)
  assert.equal(wordProgress(word, 200), 0.5)
  assert.equal(wordProgress(word, 400), 1)
  assert.equal(wordProgress({ text: 'x', start: 100, end: 100 }, 101), 1)
})

test('credit lines are recognised, sung lines with colons are not', () => {
  assert.equal(isCreditLine('作词：林夕'), true)
  assert.equal(isCreditLine('作曲 : 陈小霞'), true)
  assert.equal(isCreditLine('词：方文山'), true)
  assert.equal(isCreditLine('Composer: Someone'), true)
  assert.equal(isCreditLine('曲终人散：我们走吧'), false)
  assert.equal(isCreditLine('我想说：再见'), false)
  assert.equal(isCreditLine('没有冒号的一行'), false)
})

test('findQuiets: intro, interlude and outro, credits ignored', () => {
  const { lines } = buildLyricDoc({ lyric: '[00:00.00]作词：某人\n[00:10.00]第一句\n[00:12.00]\n[00:30.00]第二句\n[00:31.00]\n' })
  assert.deepEqual(findQuiets(lines, 60000, 5000), [
    { from: 0, to: 10000 },
    { from: 12000, to: 30000 },
    { from: 31000, to: 60000 },
  ])
  assert.deepEqual(findQuiets([], 60000, 5000), [])
})
