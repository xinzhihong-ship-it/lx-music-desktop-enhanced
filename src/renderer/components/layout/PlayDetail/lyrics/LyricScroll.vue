<template>
  <div ref="dom_root" :class="$style.root" @wheel.prevent="handleWheel">
    <div v-if="!doc.lines.length" :class="$style.empty">
      <p>{{ $t('lyric_view__empty') }}</p>
      <base-btn min @click="$emit('search')">{{ $t('lyric_menu__search') }}</base-btn>
    </div>
    <div v-else ref="dom_list" :class="[$style.list, $style[align]]">
      <div
        v-for="(line, index) in doc.lines" :key="`${line.start}_${index}`"
        :class="[$style.line, { [$style.active]: index == active }]"
        role="button" tabindex="-1" @click="handleClick(line)"
      >
        <p :class="$style.text">
          <LyricWords v-if="index == active && doc.hasWords && line.timedWords" :words="line.words" />
          <template v-else>{{ line.text }}</template>
        </p>
        <p v-for="(text, i) in extendedOf(line)" :key="i" :class="$style.extended">{{ text }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
// 滚动歌词：当前行停在约 35% 高度处，换行时用临界阻尼弹簧平滑滚过去；
// 非当前行淡化缩小，悬停稍亮；点击一行跳到该行；滚轮手动浏览，停手 2.5 秒后回到当前行。
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from '@common/utils/vueTools'
import { createGlide, findLineIndex } from '@common/utils/lyrics'
import { isRomaFirst, readLyricPosition, seekToLyricTime } from '@renderer/core/lyrics/engine'
import { isPlay } from '@renderer/store/player/state'
import { play } from '@renderer/core/player/action'
import { appSetting } from '@renderer/store/setting'
import LyricWords from './LyricWords.vue'

const props = defineProps({
  doc: { type: Object, required: true },
})
defineEmits(['search'])

const ANCHOR = 0.35
const MANUAL_HOLD = 2500
const PAUSED_POLL = 250

const dom_root = ref(null)
const dom_list = ref(null)
const active = ref(-1)
const position = shallowRef(0)
provide('lyricPosition', position)

const align = computed(() => appSetting['playDetail.style.align'] ?? 'center')
const extendedOf = line => {
  const list = []
  if (line.translation) list.push(line.translation)
  if (line.roma) list.push(line.roma)
  return isRomaFirst.value ? list.reverse() : list
}

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
const glide = createGlide()
let manualUntil = 0
let raf = 0
let timer = null
let unmounted = false

const applyScroll = y => {
  if (dom_list.value) dom_list.value.style.transform = `translate3d(0, ${-y}px, 0)`
}

const targetOf = index => {
  const root = dom_root.value
  // 直接取当前列表的子元素：v-for 的 ref 数组在换歌词后可能残留旧行、顺序错乱，量出来的位置会跑到列表末尾
  const el = dom_list.value?.children[Math.max(0, index)]
  if (!root || !el) return null
  return el.offsetTop + el.offsetHeight / 2 - root.clientHeight * ANCHOR
}

const follow = (now, instant = false) => {
  const target = targetOf(active.value)
  if (target == null) return
  glide.to(target, now, instant || !!reduceMotion?.matches)
}

const schedule = () => {
  if (unmounted || raf || timer) return
  if (isPlay.value || glide.isMoving(performance.now())) raf = requestAnimationFrame(frame)
  else timer = setTimeout(() => { timer = null; frame() }, PAUSED_POLL)
}

function frame() {
  raf = 0
  const now = performance.now()
  const pos = readLyricPosition(now)
  position.value = pos
  const index = findLineIndex(props.doc.lines, pos)
  if (index != active.value) {
    active.value = index
    // 等新的当前行样式（放大）生效后再量位置
    void nextTick(() => {
      if (performance.now() >= manualUntil) follow(performance.now())
      schedule()
    })
  } else if (manualUntil && now >= manualUntil) {
    manualUntil = 0
    follow(now)
  }
  applyScroll(glide.value(now))
  schedule()
}

const restart = () => {
  if (raf) cancelAnimationFrame(raf)
  if (timer) clearTimeout(timer)
  raf = 0
  timer = null
  frame()
}

const handleWheel = event => {
  if (!props.doc.lines.length) return
  const now = performance.now()
  glide.to(glide.value(now) + event.deltaY, now, true)
  manualUntil = now + MANUAL_HOLD
  applyScroll(glide.value(now))
  schedule()
}

const handleClick = line => {
  manualUntil = 0
  seekToLyricTime(line.start)
  if (!isPlay.value) play()
  restart()
}

// 换歌 / 换歌词：在新列表渲染完成后直接定位到当前行（不做动画）
const snapToCurrent = () => {
  manualUntil = 0
  const now = performance.now()
  position.value = readLyricPosition(now)
  active.value = findLineIndex(props.doc.lines, position.value)
  void nextTick(() => {
    const t = performance.now()
    follow(t, true)
    applyScroll(glide.value(t))
    restart()
  })
}
watch(() => props.doc, snapToCurrent, { flush: 'post' })
watch(isPlay, restart)
watch([() => appSetting['playDetail.style.fontSize'], align], () => { void nextTick(() => { follow(performance.now()); restart() }) })

let resizeObserver = null
onMounted(() => {
  resizeObserver = new ResizeObserver(() => { follow(performance.now(), true); applyScroll(glide.value(performance.now())) })
  if (dom_root.value) resizeObserver.observe(dom_root.value)
  snapToCurrent()
})
onBeforeUnmount(() => {
  unmounted = true
  if (raf) cancelAnimationFrame(raf)
  if (timer) clearTimeout(timer)
  resizeObserver?.disconnect()
})
</script>

<style lang="less" module>
.root {
  position: relative;
  height: 100%;
  overflow: hidden;
  font-size: var(--playDetail-lrc-font-size, 16px);
  -webkit-mask-image: linear-gradient(transparent 0%, #fff 16%, #fff 84%, transparent 100%);
}
.list {
  will-change: transform;
  padding: 0 6%;
  &.left { text-align: left; .line { transform-origin: 0 50%; } }
  &.center { text-align: center; .line { transform-origin: 50% 50%; } }
  &.right { text-align: right; .line { transform-origin: 100% 50%; } }
}
.line {
  padding: .35em .5em;
  margin: .1em 0;
  border-radius: 12px;
  cursor: pointer;
  opacity: .28;
  transform: scale(.94);
  transition: opacity .38s ease, transform .6s cubic-bezier(.22, 1.12, .36, 1), background-color .2s ease;
  outline: none;
  &:hover {
    opacity: .55;
    background-color: var(--color-primary-alpha-900);
  }
  &.active {
    opacity: 1;
    transform: scale(1);
  }
}
.text {
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -.01em;
  color: var(--color-font);
  overflow-wrap: break-word;
}
.extended {
  margin-top: .25em;
  font-size: .6em;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-font);
  opacity: .72;
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
@media (prefers-reduced-motion: reduce) {
  .line { transition: opacity .2s ease; }
}
</style>
