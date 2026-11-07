import assert from 'node:assert/strict'
import { test } from 'node:test'

const { createLyricDriftGuard } = await import('../src/renderer/core/lyricDriftGuard.ts')

// 模拟播放器：每 100ms 上报一次时间；stalledUntil 之前时间不动（MPV 卡住且不发暂停事件）
const simulate = ({ guard, from = 0, to, rate = 1, stall = null, step = 100, checkEvery = 500 }) => {
  const actions = []
  let media = 0
  let lastReport = 0
  for (let now = from; now <= to; now += step) {
    const stalled = stall && now >= stall[0] && now < stall[1]
    if (now > from && !stalled) media += step * rate
    lastReport = media
    if (now > from && now % checkEvery == 0) {
      const action = guard.check(lastReport, now)
      if (action != 'none') actions.push([now, action, lastReport])
    }
  }
  return actions
}

test('steady playback never triggers anything', () => {
  const guard = createLyricDriftGuard()
  guard.start(0, 0)
  assert.deepEqual(simulate({ guard, to: 20_000 }), [])
})

test('steady playback at 1.5x rate is not mistaken for drift', () => {
  const guard = createLyricDriftGuard()
  guard.start(0, 0, 1.5)
  assert.deepEqual(simulate({ guard, to: 20_000, rate: 1.5 }), [])
})

test('a stall pauses the lyric, and it resumes from the real time once playback moves again', () => {
  const guard = createLyricDriftGuard()
  guard.start(0, 0)
  // 5s 起卡住 4 秒
  const actions = simulate({ guard, to: 15_000, stall: [5000, 9000] })
  assert.deepEqual(actions.map(([, action]) => action), ['stall', 'resume'])
  const [[stallAt], [resumeAt, , resumeTime]] = actions
  assert.ok(stallAt <= 5000 + 1500 + 500, `stall detected within ~2s (at ${stallAt})`)
  assert.ok(resumeAt >= 9000 && resumeAt <= 9500)
  // 恢复时用的是真实时间（约 5s + 已播出的部分），不是歌词自己跑到的 9s+
  assert.ok(resumeTime < 5800, `resumed at real media time ${resumeTime}`)
})

test('a short gap in time reports (< stallAfter) is ignored', () => {
  const guard = createLyricDriftGuard()
  guard.start(0, 0)
  assert.deepEqual(simulate({ guard, to: 10_000, stall: [3000, 4000] }).map(([, a]) => a), ['resync'],
    'a 1s hiccup is not a stall; afterwards the clock is behind by 1s and is re-aligned once')
})

test('a jump in real time (seek without event, restart at another position) re-aligns the lyric', () => {
  const guard = createLyricDriftGuard()
  guard.start(0, 0)
  assert.equal(guard.check(500, 500), 'none')
  assert.equal(guard.check(30_000, 1000), 'resync')
  assert.equal(guard.check(30_500, 1500), 'none', 're-anchored at the new position')
})

test('stopped guard does nothing; start re-arms it', () => {
  const guard = createLyricDriftGuard()
  assert.equal(guard.check(100, 100), 'none')
  guard.start(0, 0)
  assert.equal(guard.active, true)
  guard.stop()
  assert.equal(guard.active, false)
  assert.equal(guard.check(99_999, 5000), 'none')
})
