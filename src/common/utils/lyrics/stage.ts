// 歌词舞台的排版计算（纯函数）。三种风格：
//   flow  流动：一行的字词散布在舞台上，逐个弹入、发光、落定后缓慢漂移
//   steps 阶梯：一行按短语拆成错落的几行，从导引线一侧滑入
//   tilt  倾诉：一行拆成 1~4 段大字，其中一段倾斜，逐字随演唱脉动
// 所有随机量都由“行的开始时间”决定，同一行每次出现（包括跳转之后）排版都一样。
import type { LyricLine, LyricWord } from './types'

/** 由种子决定的伪随机数 [0, 1) */
export const seededRandom = (seed: number, offset: number) => {
  const x = Math.sin(seed + offset) * 10000
  return x - Math.floor(x)
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
export const lerp = (from: number, to: number, t: number) => from + (to - from) * t
export const easeOutCubic = (t: number) => {
  const v = clamp01(t)
  return 1 - (1 - v) ** 3
}

/** 弹簧（刚度 200、阻尼 20 量级）出发 t 秒后走过的比例：略有过冲，约半秒稳定 */
export const springStep = (t: number) => {
  if (t <= 0) return 0
  const e = Math.exp(-10 * t)
  return 1 - e * (Math.cos(10 * t) + Math.sin(10 * t))
}

const MARK_RXP = /[\s\p{P}]/u
const JOINER_RXP = /['’-]$/u
export const isBreakMark = (char: string) => MARK_RXP.test(char)

export const visibleLength = (words: readonly LyricWord[]) => words.reduce((sum, word) => sum + [...word.text.trim()].length, 0)

/**
 * 把一行的字词切成“单元” [from, to)：英文等按词；中日文连续的一段到空格或标点为止，
 * 超过 6 个字的按约 4 个字一段再切。单独的标点并入前一个单元，撇号 / 连字符连接下一个词。
 */
export const stageUnits = (words: readonly LyricWord[]): Array<[number, number]> => {
  const units: Array<[number, number]> = []
  const pushPhrase = (from: number, to: number) => {
    const length = to - from
    const pieces = length <= 6 ? 1 : Math.ceil(length / 4)
    for (let k = 0; k < pieces; k++) {
      units.push([from + Math.floor(length * k / pieces), from + Math.floor(length * (k + 1) / pieces)])
    }
  }
  let from = 0
  for (let i = 0; i < words.length; i++) {
    const text = words[i].text
    if (i == from && units.length && !text.trim().replace(/\p{P}/gu, '')) {
      units[units.length - 1][1] = i + 1
      from = i + 1
      continue
    }
    const last = [...text].at(-1) ?? ''
    if (i + 1 == words.length || (isBreakMark(last) && !JOINER_RXP.test(last))) {
      pushPhrase(from, i + 1)
      from = i + 1
    }
  }
  return units
}

// ---------------------------------------------------------------------------
// flow 流动
// ---------------------------------------------------------------------------

export interface FlowWordShape {
  x: number
  y: number
  rotate: number
  scale: number
  drift: number
  /** 词后留白（容纳唱到时放大） */
  margin: number
}

export interface FlowLayout {
  shapes: FlowWordShape[]
  /** 整行水平位置 */
  justify: 'flex-start' | 'center' | 'flex-end'
  /** 整行上下偏移（占舞台高度的比例） */
  lift: number
}

/** 唱到时的放大倍数（相对 scale） */
export const FLOW_SINGING_SCALE = 1.4

/** widths 为各字词在基础字号下的宽度，gap 为基础间距 */
export const flowLayout = (line: Pick<LyricLine, 'start'>, widths: readonly number[], gap: number): FlowLayout => {
  const seed = line.start
  const shapes: FlowWordShape[] = widths.map((_, i) => {
    const s = seed + i
    return {
      x: (seededRandom(s, 1) - 0.5) * 36,
      y: (seededRandom(s, 2) - 0.5) * 36,
      rotate: (seededRandom(s, 3) - 0.5) * 10,
      scale: 1.1 + seededRandom(s, 4) * 0.2,
      drift: (seededRandom(s, 5) - 0.5) * 10,
      margin: 0,
    }
  })
  for (let i = 0; i < shapes.length; i++) {
    const grow = widths[i] * (shapes[i].scale * FLOW_SINGING_SCALE - 1) / 2
    const next = i + 1 < shapes.length ? widths[i + 1] * (shapes[i + 1].scale * FLOW_SINGING_SCALE - 1) / 2 : 0
    const toward = i + 1 < shapes.length ? shapes[i].x - shapes[i + 1].x : 0
    shapes[i].margin = Math.max(2 * gap, grow + next + toward + gap)
  }
  const justify = (['flex-start', 'center', 'flex-end'] as const)[Math.abs(Math.floor(seed)) % 3]
  const lift = [-0.14, 0, 0.12][Math.abs(Math.floor(seed * 2)) % 3]
  return { shapes, justify, lift }
}

export interface FlowWordState {
  x: number
  y: number
  scale: number
  rotate: number
  opacity: number
  blur: number
  /** 文字亮度 0.5~1 */
  brightness: number
  /** 光晕强度 0~1 */
  glow: number
}

const FLOW_LOOKAHEAD = 80

/** 某个字词在 pos 时的状态：未唱（小、偏、转、透明、模糊）→ 弹入发光 → 唱完回落、漂移 */
export const flowWordState = (word: LyricWord, shape: FlowWordShape, pos: number): FlowWordState => {
  const start = word.start - FLOW_LOOKAHEAD
  const end = Math.max(word.end, word.start + 150)
  const since = (pos - start) / 1000
  const after = (pos - end) / 1000
  const singing = Math.max(0.08, (end - word.start) / 1000)

  let x = shape.x + Math.sin(shape.y) * 100
  let y = shape.y + Math.cos(shape.x) * 50
  let scale = 0.5
  let rotate = shape.rotate + 20
  let opacity = 0
  let blur = 10
  let brightness = 0.5
  let glow = 0
  if (since > 0) {
    const e = springStep(since)
    x = lerp(x, shape.x, e)
    y = lerp(y, shape.y, e)
    scale = lerp(0.5, shape.scale * FLOW_SINGING_SCALE, e)
    rotate = lerp(shape.rotate + 20, shape.rotate, e)
    opacity = clamp01(since / 0.1)
    blur = 10 * (1 - clamp01(since / 0.2))
    brightness = lerp(0.5, 1, clamp01(since / singing))
    glow = clamp01(since / Math.max(0.08, 0.3 * singing))
  }
  if (after > 0) {
    const q = easeOutCubic(after / 0.5)
    scale = lerp(shape.scale * FLOW_SINGING_SCALE, shape.scale, q)
    opacity = lerp(1, 0.82, q)
    rotate = shape.rotate + shape.drift * clamp01(after / 5)
    brightness = lerp(1, 0.5, easeOutCubic(after / 0.8))
    glow = 1 - clamp01(after / 0.9)
  }
  return { x, y, scale, rotate, opacity, blur, brightness, glow }
}

// ---------------------------------------------------------------------------
// steps 阶梯
// ---------------------------------------------------------------------------

export interface StepsRow {
  from: number
  to: number
  /** 水平错位（像素，负数偏左） */
  x: number
  y: number
  scale: number
  /** 导引线在左侧 */
  left: boolean
}

/** 把一行拆成错落的几行；行数受舞台高度限制 */
export const stepsRows = (line: Pick<LyricLine, 'start' | 'words'>, height: number): StepsRow[] => {
  const units = stageUnits(line.words)
  if (!units.length) return []
  const seed = line.start / 1000
  let k = 0
  const random = () => seededRandom(seed, ++k)
  const count = Math.min(units.length, Math.max(1, Math.floor(height * 0.65 / 100)))
  const rows: StepsRow[] = []
  let remaining = units.length
  let unit = 0
  for (let i = 0; i < count; i++) {
    let n = remaining
    if (i < count - 1) {
      const avg = remaining / (count - i)
      n = Math.min(Math.ceil(avg * 1.5), Math.max(1, Math.round(avg + (random() - 0.5) * avg)))
    }
    n = Math.max(1, Math.min(n, remaining - (count - i - 1)))
    const stagger = 20 + random() * 80
    const left = i % 2 == 0
    rows.push({
      from: units[unit][0],
      to: units[unit + n - 1][1],
      x: left ? -stagger : stagger,
      y: (i - (count - 1) / 2) * 2.5,
      scale: 0.8 + random() * 0.9,
      left,
    })
    unit += n
    remaining -= n
  }
  return rows
}

// ---------------------------------------------------------------------------
// tilt 倾诉
// ---------------------------------------------------------------------------

export interface TiltPart {
  from: number
  to: number
  lean: boolean
  /** 很短的行尾（≤2 字），放大显示 */
  tail: boolean
}

/** 在单元边界把字词切成 n 段：每个断点选最接近字数均分处，标点后优先 */
export const splitTiltParts = (words: readonly LyricWord[], units: ReadonlyArray<[number, number]>, n: number): TiltPart[] => {
  const total = visibleLength(words)
  const before = [0]
  for (const [from, to] of units) before.push(before.at(-1)! + visibleLength(words.slice(from, to)))
  const parts: TiltPart[] = []
  let from = 0
  for (let k = 1; k < n; k++) {
    let at = -1
    let best = 0
    for (let cut = from + 1; cut <= units.length - (n - k); cut++) {
      let distance = Math.abs(before[cut] - total * k / n)
      const lastChar = [...words[units[cut - 1][1] - 1].text.trim()].at(-1) ?? ''
      if (/\p{P}/u.test(lastChar)) distance -= total * 0.15
      if (at < 0 || distance < best) {
        at = cut
        best = distance
      }
    }
    parts.push({ from: units[from][0], to: units[at - 1][1], lean: false, tail: false })
    from = at
  }
  parts.push({ from: units[from][0], to: units[units.length - 1][1], lean: false, tail: false })
  return parts
}

/** 拆成 1~4 段（越长段数越多；fits 返回 false 时继续增加段数），约三分之一的概率有一段倾斜 */
export const tiltParts = (line: Pick<LyricLine, 'start' | 'words'>, fits: (parts: TiltPart[]) => boolean = () => true): TiltPart[] => {
  const units = stageUnits(line.words)
  if (!units.length) return []
  const seed = line.start / 1000
  const chars = visibleLength(line.words)
  const score = Math.log(chars + 4) / Math.log(24) * (seededRandom(seed, 1) * 0.6 + 0.7) * 0.75
  let n = 4
  for (const [i, limit] of [0.45, 1.05, 1.7].entries()) {
    if (score < limit) {
      n = i + 1
      break
    }
  }
  let parts: TiltPart[]
  for (;;) {
    parts = splitTiltParts(line.words, units, Math.min(n, units.length))
    const leanCandidates = parts.map((_, i) => i).filter(i => seededRandom(seed, 100 + i) < 0.35)
    if (leanCandidates.length) parts[leanCandidates[Math.floor(seededRandom(seed, 200) * leanCandidates.length)]].lean = true
    if (n >= 4 || n >= units.length || fits(parts)) break
    n++
  }
  const count = parts.length
  if (count > 1 && !parts[count - 1].lean) {
    const last = visibleLength(line.words.slice(parts[count - 1].from, parts[count - 1].to))
    const prev = visibleLength(line.words.slice(parts[count - 2].from, parts[count - 2].to))
    parts[count - 1].tail = last <= 2 && last * 2 <= prev
  }
  return parts
}

/** 倾诉风格单个字符的放大量：唱时正弦脉冲，唱完保留一点 */
export const tiltSwell = (sinceSeconds: number, duration: number) => {
  if (sinceSeconds < 0) return 0
  const d = Math.min(Math.max(duration, 0.2), 0.9)
  if (sinceSeconds <= d) return Math.sin(sinceSeconds / d * Math.PI)
  return 0.25 * clamp01((sinceSeconds - d) / (d * 1.2))
}

// ---------------------------------------------------------------------------
// 重绘调度
// ---------------------------------------------------------------------------

/**
 * 舞台下一次需要重绘的等待时间（毫秒）：有字词正在弹入 / 发光 → 0（下一帧）；
 * 只在漂移 → 100；否则等到下一个字词前（最多 250）。
 */
export const stageNextFrameDelay = (lines: readonly LyricLine[], current: number, pos: number, lead = 80): number => {
  if (current < 0) return lines.length ? Math.max(0, Math.min(100, lines[0].start - pos)) : 250
  let next = -1
  let drifting = false
  for (let i = Math.max(current - 1, 0); i <= Math.min(current + 1, lines.length - 1); i++) {
    for (const word of lines[i].words) {
      const start = word.start - lead
      const end = Math.max(word.end, word.start + 150)
      if (pos >= start && pos < Math.max(start + 700, end + 900)) return 0
      if (pos >= end && pos < end + 5000) drifting = true
      else if (pos < start && (next < 0 || start - pos < next)) next = start - pos
    }
  }
  if (drifting) return 100
  return next > 0 ? Math.min(next, 250) : 100
}
