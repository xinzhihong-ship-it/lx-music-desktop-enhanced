<template>
  <div ref="dom_root" :class="$style.root" :style="{ '--stage-accent': accent, '--stage-size': `${size}px` }">
    <div v-if="!doc.lines.length" :class="$style.empty">
      <p>{{ $t('lyric_view__empty') }}</p>
      <base-btn min @click.stop="$emit('search')">{{ $t('lyric_menu__search') }}</base-btn>
    </div>
    <template v-else>
      <div :class="$style.layer">
        <template v-for="item in model.lines" :key="item.key">
          <!-- 流动 -->
          <div v-if="item.kind == 'flow'" :class="$style.flowLine" :style="item.style">
            <span v-for="word in item.words" :key="word.key" :class="$style.flowWord" :data-spark="word.spark" :style="word.style">{{ word.text }}</span>
          </div>
          <!-- 阶梯 -->
          <div v-else-if="item.kind == 'steps'" :class="$style.stepsLine" :style="item.style">
            <div v-for="row in item.rows" :key="row.key" :class="[$style.stepsRow, row.left ? $style.guideLeft : $style.guideRight]" :style="row.style">
              <span :class="[$style.guide, { [$style.guideLit]: row.lit }]" :style="row.guideStyle" />
              <span v-for="word in row.words" :key="word.key" :class="$style.flowWord" :data-spark="word.spark" :style="word.style">{{ word.text }}</span>
            </div>
          </div>
          <!-- 倾诉 -->
          <div v-else :class="$style.tiltLine" :style="item.style">
            <div v-for="part in item.parts" :key="part.key" :class="[$style.tiltPart, { [$style.lean]: part.lean }]" :style="part.style">
              <span v-for="char in part.chars" :key="char.key" :class="char.space ? $style.tiltSpace : $style.tiltChar" :data-spark="char.spark" :style="char.style">{{ char.text }}</span>
            </div>
          </div>
        </template>
        <div v-if="model.interlude" :class="$style.dots">
          <span v-for="(dot, i) in model.interlude" :key="i" :style="dot" />
        </div>
      </div>
      <div :class="$style.foot">
        <p v-for="(text, i) in model.extended" :key="i" :class="$style.footExtended">{{ text }}</p>
        <p v-if="model.next" :class="$style.footNext">{{ model.next }}</p>
      </div>
      <canvas v-if="sparks" ref="dom_canvas" :class="$style.sparks" />
      <span ref="dom_accent" :class="$style.accentProbe" aria-hidden="true" />
    </template>
  </div>
</template>

<script setup>
// 歌词舞台：一次只演一行（上一行 0.4 秒内淡出），间奏显示呼吸的三个点，底部是翻译和下一行。
// 三种风格的排版来自 @common/utils/lyrics/stage；刷新节奏按 stageNextFrameDelay：
// 有字在弹入 / 发光时逐帧，只在漂移时每 100ms，其余时间等到下一个字之前。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from '@common/utils/vueTools'
import {
  clamp01, easeOutCubic, findLineIndex, flowLayout, flowWordState, seededRandom, springStep,
  stageNextFrameDelay, stepsRows, tiltParts, tiltSwell, visibleLength,
} from '@common/utils/lyrics'
import { isRomaFirst, readLyricPosition } from '@renderer/core/lyrics/engine'
import { isPlay } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'

const props = defineProps({
  doc: { type: Object, required: true },
  styleName: { type: String, default: 'flow' },
  sparks: { type: Boolean, default: false },
  /** 强调色（CSS 颜色），用于光晕、导引线、倾斜段与火花 */
  accent: { type: String, default: 'var(--color-primary)' },
})
defineEmits(['search'])

const TILT_LEAD = 250
const FLOW_LEAD = 80
const PAUSED_POLL = 250
const SPARK_TIME = 0.6

const dom_root = ref(null)
const dom_canvas = ref(null)
const dom_accent = ref(null)
const width = ref(800)
const height = ref(500)
const pos = shallowRef(0)
let fontFamily = 'sans-serif'

const fontScale = computed(() => (appSetting['playDetail.style.fontSize'] ?? 140) / 140)
const size = computed(() => Math.min(64, Math.max(36, width.value * 0.045)) * fontScale.value)

// ---- 文字宽度（流动 / 阶梯预留放大空间、倾诉判断是否放得下） ----
const measureCtx = document.createElement('canvas').getContext('2d')
const measure = (text, fontSize, weight) => {
  if (!measureCtx) return text.length * fontSize * 0.6
  measureCtx.font = `${weight} ${fontSize}px ${fontFamily}`
  return measureCtx.measureText(text).width
}
// 每行的排版只与行和字号有关，缓存起来
const layoutCache = new Map()
const cached = (key, build) => {
  if (!layoutCache.has(key)) {
    if (layoutCache.size > 64) layoutCache.clear()
    layoutCache.set(key, build())
  }
  return layoutCache.get(key)
}

// 性能：不再给每个字做 filter: blur（大字号逐帧模糊会让 GPU 每帧重新光栅化，几个字同时弹入就卡）；
// 光晕量化为 4 档，text-shadow 每个字只变几次，不再逐帧重绘
const GLOW_STEPS = 4
const wordStyle = (state, fontSize, margin) => {
  const glow = Math.round(state.glow * GLOW_STEPS) / GLOW_STEPS
  return {
    marginInlineEnd: `${margin}px`,
    fontSize: `${fontSize}px`,
    transform: `translate(${state.x.toFixed(1)}px, ${state.y.toFixed(1)}px) rotate(${state.rotate.toFixed(2)}deg) scale(${state.scale.toFixed(3)})`,
    opacity: (state.opacity * state.brightness).toFixed(3),
    textShadow: glow > 0 ? `0 0 ${Math.round(fontSize * 0.2)}px color-mix(in srgb, var(--stage-accent) ${Math.round(85 * glow)}%, transparent)` : undefined,
  }
}
const sparkKey = (lineStart, index) => `${lineStart}:${index}`

const flowModel = (line, p, fade, h) => {
  const f = size.value
  const layout = cached(`flow:${line.start}:${f}`, () => flowLayout(line, line.words.map(w => measure(w.text, f, 800)), f * 0.08))
  return {
    kind: 'flow',
    key: `flow:${line.start}`,
    style: { justifyContent: layout.justify, transform: `translateY(${layout.lift * h}px)`, opacity: fade, padding: `0 ${width.value * 0.1}px` },
    words: line.words.map((word, i) => ({
      key: i,
      text: word.text,
      spark: sparkKey(line.start, i),
      style: wordStyle(flowWordState(word, layout.shapes[i], p), f, layout.shapes[i].margin),
    })),
  }
}

const stepsModel = (line, p, fade, h) => {
  let f = size.value * 0.8
  if (visibleLength(line.words) > 40) f *= 0.8
  const rows = cached(`steps:${line.start}:${Math.round(h)}`, () => stepsRows(line, h))
  return {
    kind: 'steps',
    key: `steps:${line.start}`,
    style: { opacity: fade, transform: `scale(${1 + 0.05 * (1 - fade)})` },
    rows: rows.map((row, ri) => {
      const words = line.words.slice(row.from, row.to)
      const first = words[0]
      const last = words.at(-1)
      const since = (p - (first.start - FLOW_LEAD)) / 1000
      const end = (p - Math.max(last.end, last.start + 150)) / 1000
      const side = row.left ? -40 : 40
      let x = row.x + side
      let scale = 0.85
      let opacity = 0
      if (since > 0) {
        const e = springStep(since)
        x = row.x + side * (1 - e)
        scale = 0.85 + 0.15 * e
        opacity = clamp01(since / 0.1)
      }
      const guide = easeOutCubic(since / 0.4)
      const seed = first.start / 1000
      const shapes = cached(`stepsShape:${line.start}:${ri}:${f}`, () => {
        const widths = words.map(w => measure(w.text, f, 800))
        const base = flowLayout({ start: seed * 1000 }, widths, f * 0.1).shapes
        return base.map((shape, i) => {
          const s = seed + i * 7.13
          return {
            ...shape,
            x: (seededRandom(s, 1) - 0.5) * 12,
            y: (seededRandom(s, 2) - 0.5) * 12,
            rotate: (seededRandom(s, 3) - 0.5) * 6,
            scale: row.scale,
            drift: (seededRandom(s, 8) - 0.5) * 20,
            margin: i == words.length - 1 ? 0 : shape.margin,
          }
        })
      })
      const pad = Math.max(0, f * (row.scale * 1.4 - 1) / 2)
      return {
        key: ri,
        left: row.left,
        lit: since > 0 && end <= 0,
        style: { transform: `translate(${x}px, ${row.y}px) scale(${scale})`, opacity, margin: `${pad}px 0 ${pad + 10}px` },
        guideStyle: { opacity: guide <= 0 ? 0 : (end > 0 ? 0.22 : since > 0 ? 1 : 0.14) * guide, '--guide': guide },
        words: words.map((word, i) => ({
          key: i,
          text: word.text,
          spark: sparkKey(line.start, row.from + i),
          style: wordStyle(flowWordState(word, shapes[i], p), f, shapes[i].margin),
        })),
      }
    }),
  }
}

const tiltModel = (line, p, fade) => {
  const avail = width.value * 0.85
  let fontSize = Math.min(width.value * 0.06875, 90) * fontScale.value
  const partText = part => line.words.slice(part.from, part.to).map(w => w.text).join('').trim()
  const partWidth = (part, sizeValue) => {
    const text = partText(part)
    return measure(text, sizeValue, part.lean ? 300 : 400) + [...text].length * sizeValue * (part.lean ? 0.15 : 0.08)
  }
  const parts = cached(`tilt:${line.start}:${Math.round(fontSize)}:${Math.round(avail)}`, () => tiltParts(line, list => Math.max(...list.map(part => partWidth(part, fontSize))) <= avail))
  const widest = Math.max(...parts.map(part => partWidth(part, fontSize)))
  if (widest > avail) fontSize *= Math.max(0.5, avail / widest)
  const ease = t => 1 - (1 - clamp01(t)) ** 2
  return {
    kind: 'tilt',
    key: `tilt:${line.start}`,
    style: { opacity: fade, transform: `translateY(${-12 * (1 - fade)}px)` },
    parts: parts.map((part, pi) => {
      const words = line.words.slice(part.from, part.to)
      const since = (p - (words[0].start - TILT_LEAD)) / 1000
      const lean = part.lean
      const inValue = ease(since / (lean ? 0.6 : 0.55))
      const rise = (lean ? 24 : 20) * (1 - inValue)
      const scale = lean ? 0.92 + 0.08 * inValue : 1
      const stagger = lean ? 0.05 : 0.04
      const pulse = lean ? 0.18 : 0.15
      const partSize = part.tail ? fontSize * 1.18 : fontSize
      const chars = []
      let k = 0
      words.forEach((word, wi) => {
        const text = word.text.replace(/\s+$/u, '')
        const list = [...text]
        const each = (word.end - word.start) / Math.max(list.length, 1)
        list.forEach((char, ci) => {
          if (/\s/u.test(char)) {
            chars.push({ key: `${wi}:${ci}`, space: true, text: '', style: { width: `${partSize * (lean ? 0.35 : 0.25)}px` } })
            return
          }
          const start = word.start + ci * each
          const t = (p - start) / 1000
          const swell = tiltSwell(t, each / 1000)
          const shown = ease((since - k * stagger) / 0.5)
          let y = 0
          if (lean) {
            y = partSize / 6 * (2 - shown)
            if (k % 2 == 0) y = -y
          }
          chars.push({
            key: `${wi}:${ci}`,
            text: char,
            spark: ci == 0 ? sparkKey(line.start, part.from + wi) : undefined,
            style: {
              fontSize: `${partSize}px`,
              marginInlineEnd: `${partSize * (lean ? 0.15 : 0.08)}px`,
              opacity: shown,
              transform: `translateY(${y}px) scale(${1 + swell * pulse})`,
            },
          })
          k++
        })
        if (text != word.text && wi < words.length - 1) chars.push({ key: `${wi}:gap`, space: true, text: '', style: { width: `${partSize * (lean ? 0.35 : 0.25)}px` } })
      })
      return {
        key: pi,
        lean,
        style: { transform: `translateY(${rise}px) scale(${scale})`, opacity: inValue },
        chars,
      }
    }),
  }
}

const lineModel = (line, p, fade) => {
  const h = height.value
  switch (props.styleName) {
    case 'steps': return stepsModel(line, p, fade, h)
    case 'tilt': return tiltModel(line, p, fade)
    default: return flowModel(line, p, fade, h)
  }
}

const interludeDots = (p, from, to) => {
  const progress = clamp01((p - from) / Math.max(100, to - from))
  const breath = 1 + 0.12 * Math.sin(performance.now() / 420)
  return [0, 1, 2].map(i => ({ opacity: 0.2 + 0.7 * clamp01(progress * 3 - i), transform: `scale(${breath})` }))
}

const currentIndex = computed(() => findLineIndex(props.doc.lines, pos.value))

const model = computed(() => {
  const lines = props.doc.lines
  const p = pos.value
  const cur = currentIndex.value
  const result = { lines: [], interlude: null, extended: [], next: '' }
  if (!lines.length) return result
  if (cur > 0) {
    const gone = (p - lines[cur].start) / 400
    if (gone < 1) result.lines.push(lineModel(lines[cur - 1], p, 1 - easeOutCubic(gone)))
  }
  if (cur < 0) {
    result.interlude = interludeDots(p, 0, lines[0].start)
  } else if (cur + 1 < lines.length && p > lines[cur].end + 1000 && lines[cur + 1].start - lines[cur].end > 4000) {
    result.interlude = interludeDots(p, lines[cur].end, lines[cur + 1].start)
  } else {
    result.lines.push(lineModel(lines[cur], p, 1))
  }
  if (cur >= 0) {
    const extended = []
    if (lines[cur].translation) extended.push(lines[cur].translation)
    if (lines[cur].roma) extended.push(lines[cur].roma)
    result.extended = isRomaFirst.value ? extended.reverse() : extended
  }
  if (cur + 1 < lines.length) result.next = lines[cur + 1].text
  return result
})

// ---- 火花：字词落定后 0.6 秒内从边缘射出的短线 ----
const sparkRects = new Map()
const drawSparks = () => {
  const canvas = dom_canvas.value
  const root = dom_root.value
  if (!canvas || !root) return false
  const ratio = window.devicePixelRatio || 1
  const w = root.clientWidth
  const h = root.clientHeight
  if (canvas.width != Math.round(w * ratio) || canvas.height != Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const lines = props.doc.lines
  const cur = currentIndex.value
  if (cur < 0) return false
  // canvas 不认识 CSS 变量：借一个隐藏元素把强调色解析成具体颜色
  const accent = dom_accent.value ? getComputedStyle(dom_accent.value).color : getComputedStyle(root).color
  let active = false
  let rootRect = null
  for (const lineIndex of [cur - 1, cur]) {
    const line = lines[lineIndex]
    if (!line) continue
    line.words.forEach((word, i) => {
      const since = (pos.value - word.start) / 1000
      if (since < 0 || since >= SPARK_TIME) return
      const key = sparkKey(line.start, i)
      let r = sparkRects.get(key)
      if (!r) {
        // 只在火花开始时量一次（读位置会强制同步排版），之后 0.6 秒内复用
        const el = root.querySelector(`[data-spark="${key}"]`)
        if (!el) return
        rootRect ??= root.getBoundingClientRect()
        const box = el.getBoundingClientRect()
        r = { cx: box.left - rootRect.left + box.width / 2, cy: box.top - rootRect.top + box.height / 2, width: box.width, height: box.height }
        if (sparkRects.size > 64) sparkRects.clear()
        sparkRects.set(key, r)
      }
      active = true
      const cx = r.cx
      const cy = r.cy
      const last = i == line.words.length - 1
      const count = last ? 16 : 9
      const reach = Math.max(r.width, r.height) * 0.75 * (last ? 1.6 : 1)
      const t = since / SPARK_TIME
      const out = 1 - (1 - t) ** 3
      const fade = (1 - t) ** 2
      ctx.strokeStyle = accent
      ctx.lineCap = 'round'
      for (let n = 0; n < count; n++) {
        const angle = 2 * Math.PI * (n + seededRandom(word.start, n) * 0.7) / count
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)
        const edge = r.width / 2 * 0.7 * Math.abs(dx) + r.height / 2 * 0.7 * Math.abs(dy)
        const head = edge + reach * (0.55 + 0.45 * seededRandom(word.start, n + 50)) * out
        const tail = Math.max(edge, head - reach * 0.3 * (1 - t))
        ctx.globalAlpha = 0.9 * fade
        ctx.lineWidth = 0.8 + 1.6 * (1 - t)
        ctx.beginPath()
        ctx.moveTo(cx + dx * tail, cy + dy * tail)
        ctx.lineTo(cx + dx * head, cy + dy * head)
        ctx.stroke()
      }
    })
  }
  ctx.globalAlpha = 1
  return active
}

// ---- 刷新调度 ----
let raf = 0
let timer = null
let unmounted = false
const clearSchedule = () => {
  if (raf) cancelAnimationFrame(raf)
  if (timer) clearTimeout(timer)
  raf = 0
  timer = null
}
const schedule = sparking => {
  if (unmounted) return
  clearSchedule()
  let delay = PAUSED_POLL
  if (isPlay.value) {
    const lead = props.styleName == 'tilt' ? TILT_LEAD : FLOW_LEAD
    delay = sparking ? 0 : stageNextFrameDelay(props.doc.lines, currentIndex.value, pos.value, lead)
    if (model.value.interlude) delay = Math.min(delay, 50)
  }
  if (delay <= 0) raf = requestAnimationFrame(frame)
  else timer = setTimeout(frame, delay)
}
function frame() {
  raf = 0
  timer = null
  pos.value = readLyricPosition()
  if (props.sparks) {
    void nextTick(() => { schedule(drawSparks()) })
  } else {
    schedule(false)
  }
}

watch(() => [props.doc, props.styleName, props.sparks, isPlay.value], () => {
  layoutCache.clear()
  sparkRects.clear()
  frame()
})

let resizeObserver = null
onMounted(() => {
  if (dom_root.value) fontFamily = getComputedStyle(dom_root.value).fontFamily || fontFamily
  resizeObserver = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect
    if (!rect) return
    width.value = rect.width
    height.value = rect.height
    layoutCache.clear()
    sparkRects.clear()
  })
  if (dom_root.value) resizeObserver.observe(dom_root.value)
  frame()
})
onBeforeUnmount(() => {
  unmounted = true
  clearSchedule()
  resizeObserver?.disconnect()
})
</script>

<style lang="less" module>
.root {
  position: relative;
  height: 100%;
  overflow: hidden;
  color: var(--color-font);
  user-select: none;
}
.layer {
  position: absolute;
  inset: 0 0 18% 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.flowLine {
  position: absolute;
  inset: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  align-items: center;
  pointer-events: none;
}
.flowWord {
  display: inline-block;
  font-weight: 800;
  white-space: pre;
  line-height: 1.25;
  will-change: transform, opacity;
}
.stepsLine {
  position: absolute;
  inset: 0;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.stepsRow {
  position: relative;
  display: flex;
  align-items: center;
  padding: 3px 8px;
}
.guide {
  position: absolute;
  bottom: -8px;
  width: calc((100% + 36px) * var(--guide, 0));
  height: calc(32px * var(--guide, 0));
  border-bottom: 1px solid var(--color-font);
  pointer-events: none;
  &.guideLit {
    border-color: var(--stage-accent);
  }
}
.guideLeft .guide {
  left: -16px;
  border-left: 1px solid var(--color-font);
  &.guideLit { border-color: var(--stage-accent); }
}
.guideRight .guide {
  right: -16px;
  border-right: 1px solid var(--color-font);
  &.guideLit { border-color: var(--stage-accent); }
}
.tiltLine {
  position: absolute;
  inset: 0;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  gap: 14px;
  pointer-events: none;
}
.tiltPart {
  display: flex;
  align-items: center;
  font-weight: 400;
  line-height: 1.35;
  &.lean {
    font-weight: 300;
    font-style: italic;
    line-height: 1.25;
    color: var(--stage-accent);
  }
}
.tiltChar {
  display: inline-block;
  white-space: pre;
  will-change: transform, opacity;
}
.tiltSpace {
  display: inline-block;
}
.dots {
  display: flex;
  gap: 18px;
  span {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: var(--color-font);
  }
}
.foot {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: 24px;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  gap: 8px;
  text-align: center;
  pointer-events: none;
}
.footExtended {
  font-size: 18px;
  font-weight: 600;
  opacity: .72;
}
.footNext {
  font-size: 14px;
  opacity: .32;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sparks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.accentProbe {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  color: var(--stage-accent);
}
.empty {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-size: 15px;
  color: var(--color-font-label);
}
</style>
