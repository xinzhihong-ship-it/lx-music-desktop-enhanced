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

const L = await import('../src/common/utils/lyrics/index.ts')

const words = texts => texts.map((text, i) => ({ text, start: 1000 + i * 300, end: 1000 + i * 300 + 250 }))
const line = (texts, start = 1000) => ({ start, end: start + texts.length * 300, words: words(texts) })

// ---- 媒体时钟 ----
test('media clock extrapolates between reports at the playback rate', () => {
  const clock = L.createMediaClock()
  clock.sample(10_000, 0, true, 1)
  assert.equal(clock.position(0), 10_000)
  assert.equal(clock.position(200), 10_200)
  clock.sample(10_000, 400, true, 2) // 改了倍速：从这里开始按 2 倍外推
  assert.equal(clock.position(500), 10_200)
})

test('media clock stops extrapolating when reports stop (stall) and never jitters backwards', () => {
  const clock = L.createMediaClock({ maxExtrapolate: 1000 })
  clock.sample(0, 0, true)
  assert.equal(clock.position(5000), 1000, 'capped at maxExtrapolate')
  // 新上报略落后于外推：保持上一帧，不回退
  clock.sample(900, 5000, true)
  assert.equal(clock.position(5000), 1000)
  // 大幅回退（跳转）立即采用
  clock.sample(100, 5100, true)
  assert.equal(clock.position(5100), 100)
})

test('media clock does not extrapolate while paused', () => {
  const clock = L.createMediaClock()
  clock.sample(3000, 0, false)
  assert.equal(clock.position(10_000), 3000)
  clock.reset(0, 0)
  assert.equal(clock.position(0), 0)
})

// ---- 滚动弹簧 ----
test('glide is critically damped: monotonic, no overshoot, within 0.5px after ~800ms', () => {
  const glide = L.createGlide()
  glide.to(0, 0, true)
  glide.to(100, 0)
  let previous = glide.value(0)
  for (let t = 16; t <= 1000; t += 16) {
    const v = glide.value(t)
    assert.ok(v >= previous - 1e-9, 'never moves backwards')
    assert.ok(v <= 100 + 1e-9, 'never overshoots')
    previous = v
  }
  assert.ok(100 - glide.value(800) < 0.5)
  assert.equal(glide.isMoving(1200), false)
})

test('glide retargeting mid-way keeps the shown position continuous', () => {
  const glide = L.createGlide()
  glide.to(0, 0, true)
  glide.to(100, 0)
  const shown = glide.value(150)
  glide.to(200, 150)
  assert.ok(Math.abs(glide.value(150) - shown) < 1e-9)
  glide.to(50, 300, true)
  assert.equal(glide.value(300), 50)
  assert.equal(glide.isMoving(300), false)
})

// ---- 舞台排版 ----
test('seededRandom is deterministic and in [0, 1)', () => {
  for (let i = 0; i < 50; i++) {
    const v = L.seededRandom(1234, i)
    assert.ok(v >= 0 && v < 1)
    assert.equal(v, L.seededRandom(1234, i))
  }
})

test('springStep starts at 0, overshoots a little and settles near 1', () => {
  assert.equal(L.springStep(0), 0)
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => L.springStep(i / 100)))
  assert.ok(peak > 1 && peak < 1.1)
  assert.ok(Math.abs(L.springStep(0.8) - 1) < 0.01)
})

test('stageUnits: phrases end at punctuation / spaces, long CJK runs are cut in fours, lone punctuation joins the previous unit', () => {
  const cjk = '我们一起走过的那些日子'.split('')
  assert.deepEqual(L.stageUnits(words(cjk)), [[0, 3], [3, 7], [7, 11]], '11 chars in pieces of about four')
  assert.deepEqual(L.stageUnits(words('短短六个字啊'.split(''))), [[0, 6]], 'up to 6 stay whole')
  const latin = words(['It’s ', 'a ', 'good ', 'day'])
  assert.deepEqual(L.stageUnits(latin), [[0, 1], [1, 2], [2, 3], [3, 4]])
  const punct = words(['你', '好', '，', '世', '界'])
  assert.deepEqual(L.stageUnits(punct), [[0, 3], [3, 5]])
  assert.deepEqual(L.stageUnits([]), [])
})

test('flowLayout is stable for a line and leaves room for words to swell', () => {
  const a = L.flowLayout({ start: 42_000 }, [40, 40, 60], 4)
  const b = L.flowLayout({ start: 42_000 }, [40, 40, 60], 4)
  assert.deepEqual(a, b)
  assert.ok(['flex-start', 'center', 'flex-end'].includes(a.justify))
  for (const shape of a.shapes) {
    assert.ok(shape.scale >= 1.1 && shape.scale <= 1.3)
    assert.ok(shape.margin >= 8)
  }
})

test('flowWordState: hidden before, springs in while sung, settles dimmer after', () => {
  const word = { text: '爱', start: 5000, end: 5400 }
  const shape = { x: 0, y: 0, rotate: 2, scale: 1.2, drift: 4, margin: 0 }
  const before = L.flowWordState(word, shape, 4000)
  assert.equal(before.opacity, 0)
  assert.equal(before.blur, 10)
  const singing = L.flowWordState(word, shape, 5300)
  assert.equal(singing.opacity, 1)
  assert.ok(singing.glow > 0.9)
  assert.ok(singing.scale > shape.scale)
  const after = L.flowWordState(word, shape, 12_000)
  assert.ok(Math.abs(after.scale - shape.scale) < 1e-9)
  assert.ok(Math.abs(after.opacity - 0.82) < 1e-9)
  assert.equal(after.glow, 0)
  assert.ok(Math.abs(after.rotate - (shape.rotate + shape.drift)) < 1e-9, 'fully drifted after 5s')
})

test('stepsRows covers every word exactly once, alternates sides and respects the height', () => {
  const l = line('一二三，四五六，七八九，十'.split(''))
  const rows = L.stepsRows(l, 600)
  assert.ok(rows.length >= 1 && rows.length <= Math.floor(600 * 0.65 / 100))
  assert.equal(rows[0].from, 0)
  assert.equal(rows.at(-1).to, l.words.length)
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].from, rows[i - 1].to)
  rows.forEach((row, i) => assert.equal(row.left, i % 2 == 0))
  assert.deepEqual(L.stepsRows(l, 600), rows, 'stable')
  assert.equal(L.stepsRows(l, 120).length, 1)
})

test('tilt splits at punctuation, covers all words and marks at most one leaning part', () => {
  const l = line('今天天气真好，我们出去走走吧，好不好'.split(''), 7000)
  const parts = L.tiltParts(l)
  assert.ok(parts.length >= 1 && parts.length <= 4)
  assert.equal(parts[0].from, 0)
  assert.equal(parts.at(-1).to, l.words.length)
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].from, parts[i - 1].to)
  assert.ok(parts.filter(p => p.lean).length <= 1)
  // 两段时，断点落在标点之后
  const split = L.splitTiltParts(l.words, L.stageUnits(l.words), 2)
  assert.equal(l.words[split[0].to - 1].text, '，')
})

test('tilt keeps splitting while the parts do not fit', () => {
  const l = line('一二三四，五六七八，九十一二，三四五六'.split(''), 3000)
  let calls = 0
  const parts = L.tiltParts(l, () => { calls++; return false })
  assert.equal(parts.length, 4)
  assert.ok(calls >= 1)
})

test('tiltSwell pulses while sung and keeps a little after', () => {
  assert.equal(L.tiltSwell(-0.1, 0.4), 0)
  assert.ok(Math.abs(L.tiltSwell(0.2, 0.4) - 1) < 1e-9)
  assert.ok(Math.abs(L.tiltSwell(10, 0.4) - 0.25) < 1e-9)
})

test('stageNextFrameDelay: every frame while a word springs in, slower while drifting, waits for the next word', () => {
  const doc = L.buildLyricDoc({ lyric: '[00:01.00]ab\n[00:20.00]cd\n' })
  const { lines } = doc
  assert.equal(L.stageNextFrameDelay(lines, 0, lines[0].words[0].start), 0)
  assert.equal(L.stageNextFrameDelay(lines, 0, lines[0].end + 3000), 100)
  assert.equal(L.stageNextFrameDelay(lines, 1, lines[1].words[0].start - 1000), 250)
  assert.equal(L.stageNextFrameDelay(lines, -1, 0), 100)
})

// ---- 取色 ----
const solid = (r, g, b, n = 64) => {
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) data.set([r, g, b, 255], i * 4)
  return data
}

test('dominantColor picks the vivid color, ignores transparent pixels, falls back to the average for gray covers', () => {
  const mixed = new Uint8ClampedArray([...solid(220, 30, 30, 30), ...solid(128, 128, 128, 60), ...solid(0, 255, 0, 10).map((v, i) => i % 4 == 3 ? 0 : v)])
  const red = L.dominantColor(mixed)
  assert.ok(red.r > 200 && red.g < 60 && red.b < 60)
  const gray = L.dominantColor(solid(100, 100, 100))
  assert.deepEqual(gray, { r: 100, g: 100, b: 100 })
  assert.deepEqual(L.dominantColor(new Uint8ClampedArray(0)), { r: 120, g: 120, b: 130 })
})

test('backdropPalette keeps the hue, lands at a deep value for white text, and keeps gray gray', () => {
  const blue = L.backdropPalette({ r: 40, g: 90, b: 220 })
  const top = blue.top.match(/\d+/g).map(Number)
  assert.ok(top[2] > top[0] && top[2] > top[1], 'still blue')
  assert.ok(Math.max(...top) <= Math.round(0.35 * 255) + 1, 'deep enough')
  const grayPalette = L.backdropPalette({ r: 128, g: 128, b: 128 })
  const g = grayPalette.top.match(/\d+/g).map(Number)
  assert.equal(new Set(g).size, 1)
  assert.ok(blue.accentRgb.b > 220 - 1 && blue.accentRgb.r > 40)
})

test('hsv round trip', () => {
  for (const c of [{ r: 255, g: 0, b: 0 }, { r: 12, g: 200, b: 99 }, { r: 50, g: 50, b: 50 }]) {
    const { h, s, v } = L.rgbToHsv(c)
    assert.deepEqual(L.hsvToRgb(h, s, v), c)
  }
})

// ---- 卡拉 OK 帧（桌面歌词 / 歌词岛） ----
test('karaokeFrame: before the first line the main line is empty and the first line is previewed', () => {
  const doc = L.buildLyricDoc({ lyric: '[00:02.00]第一句\n[00:04.00]第二句\n' })
  assert.deepEqual(L.karaokeFrame(doc, 500), { index: -1, words: [], done: false, secondary: '第一句', secondaryKind: 'next' })
  assert.deepEqual(L.karaokeFrame(L.buildLyricDoc({ lyric: '' }), 0).secondaryKind, 'none')
})

test('karaokeFrame: word-timed lines fill word by word; translation wins over the next-line preview', () => {
  const doc = L.buildLyricDoc({
    lyric: '[00:01.00]你好\n[00:03.00]世界\n',
    lxlyric: '[00:01.00]<0,400>你<400,400>好\n[00:03.00]<0,500>世<500,500>界\n',
    tlyric: '[00:01.00]Hello\n',
  })
  const a = L.karaokeFrame(doc, 1200)
  assert.equal(a.index, 0)
  assert.deepEqual(a.words.map(w => w.text), ['你', '好'])
  assert.ok(Math.abs(a.words[0].progress - 0.5) < 1e-9)
  assert.equal(a.words[1].progress, 0)
  assert.equal(a.done, false)
  assert.deepEqual([a.secondary, a.secondaryKind], ['Hello', 'extended'])
  const b = L.karaokeFrame(doc, 1900)
  assert.equal(b.done, true)
  const c = L.karaokeFrame(doc, 3100)
  assert.deepEqual([c.index, c.secondaryKind], [1, 'none'], 'last line, no translation, nothing after')
})

test('karaokeFrame: lines without word timing light up whole instead of a fake sweep', () => {
  const doc = L.buildLyricDoc({ lyric: '[00:01.00]整行歌词\n[00:03.00]下一行\n' })
  const f = L.karaokeFrame(doc, 1100)
  assert.deepEqual(f.words, [{ text: '整行歌词', progress: 1 }])
  assert.deepEqual([f.secondary, f.secondaryKind], ['下一行', 'next'])
})

test('karaokeFrame: during a long break the next line is shown early, unfilled', () => {
  const doc = L.buildLyricDoc({ lyric: '[00:01.00]前一句\n[00:02.00]\n[00:20.00]后一句\n' })
  assert.equal(L.karaokeFrame(doc, 2500).index, 0, 'right after the line: keep it')
  const f = L.karaokeFrame(doc, 4000)
  assert.equal(f.index, 1)
  assert.equal(f.words[0].progress, 0)
  assert.equal(f.done, false)
})

test('karaokeFrame: roma / translation order follows the swap setting', () => {
  const doc = L.buildLyricDoc({ lyric: '[00:01.00]歌\n', tlyric: '[00:01.00]Song\n', rlyric: '[00:01.00]uta\n' })
  assert.equal(L.karaokeFrame(doc, 1500).secondary, 'Song / uta')
  assert.equal(L.karaokeFrame(doc, 1500, true).secondary, 'uta / Song')
})

// ---- 双行交替（酷狗 / 网易云式桌面歌词） ----
test('doubleLineFrame: odd lines stay on the top row, even lines on the bottom; the next line lights up in place', () => {
  const doc = L.buildLyricDoc({
    lyric: '[00:01.00]第一句\n[00:03.00]第二句\n[00:05.00]第三句\n[00:07.00]第四句\n',
    lxlyric: '[00:01.00]<0,1000>第一<1000,1000>句\n[00:03.00]<0,1000>第二<1000,1000>句\n[00:05.00]<0,2000>第三句\n[00:07.00]<0,2000>第四句\n',
  })
  const rows = pos => L.doubleLineFrame(doc, pos).map(r => r && `${r.index}${r.active ? '*' : ''}`)
  assert.deepEqual(rows(500), ['0', '1'], 'before start: preview the first two lines')
  assert.deepEqual(rows(1500), ['0*', '1'])
  assert.deepEqual(rows(3500), ['2', '1*'], 'line 2 lit where it already was (bottom), top row moves on to line 3')
  assert.deepEqual(rows(5500), ['2*', '3'])
  assert.deepEqual(rows(7500), [null, '3*'], 'nothing after the last line')
  const [top] = L.doubleLineFrame(doc, 1500)
  assert.deepEqual(top.words.map(w => w.text), ['第一', '句'])
  assert.ok(Math.abs(top.words[0].progress - 0.5) < 1e-9)
  assert.deepEqual(L.doubleLineFrame(doc, 1500)[1].words, [{ text: '第二句', progress: 0 }], 'the waiting row is plain text')
  assert.deepEqual(L.doubleLineFrame(L.buildLyricDoc({ lyric: '' }), 0), [null, null])
})
