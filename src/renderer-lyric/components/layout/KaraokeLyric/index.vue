<template>
  <div
    :class="[$style.root, vertical ? $style.vertical : $style.horizontal, { [$style.dragging]: isDragging, [$style.ellipsis]: ellipsis }]"
    :style="rootStyle" @mousedown="handleMouseDown" @touchstart="handleTouchStart"
  >
    <div :class="$style.stack">
      <transition
        :enter-from-class="$style.lineEnterFrom" :enter-active-class="$style.lineEnterActive"
        :leave-to-class="$style.lineLeaveTo" :leave-active-class="$style.lineLeaveActive"
      >
        <p :key="`p:${musicInfo.id}:${frame.index}`" :class="[$style.line, $style.primary]">
          <template v-if="frame.index >= 0">
            <span v-for="(word, i) in frame.words" :key="i" :class="$style.word" :style="wordStyle(word)">{{ word.text }}</span>
          </template>
          <span v-else :class="$style.title">{{ title }}</span>
        </p>
      </transition>
      <transition
        :enter-from-class="$style.lineEnterFrom" :enter-active-class="$style.lineEnterActive"
        :leave-to-class="$style.lineLeaveTo" :leave-active-class="$style.lineLeaveActive"
      >
        <p
          v-if="frame.secondary" :key="`s:${musicInfo.id}:${frame.index}:${frame.secondaryKind}`"
          :class="[$style.line, $style.secondary, { [$style.next]: frame.secondaryKind == 'next' }]"
        >{{ frame.secondary }}</p>
      </transition>
    </div>
  </div>
</template>

<script setup>
// 桌面歌词：两行。当前行逐字点亮——没唱到的字半透明，正在唱的字微微上浮放大并带柔光，
// 唱过的字保持明亮；换行时旧行上移淡出、新行从下方浮入并由模糊变清晰。
// 第二行是翻译 / 罗马音，没有时预告下一行。可读性靠柔和投影（不再用描边）。
// 沿用字体、字号、透明度、对齐、行距、单行省略、横竖排设置；“已播放颜色”作为柔光色。
// 在歌词上按住拖动即可移动窗口。
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from '@common/utils/vueTools'
import { karaokeFrame } from '@common/utils/lyrics'
import { clockRevision, isRomaFirst, lyricDoc, readLyricPosition } from '@lyric/core/lyric'
import { isPlay, musicInfo, setting } from '@lyric/store/state'
import useWindowDrag from '@lyric/useApp/useWindowDrag'

const PAUSED_REFRESH = 500

const { isDragging, handleMouseDown, handleTouchStart } = useWindowDrag()

const vertical = computed(() => setting['desktopLyric.direction'] == 'vertical')
const ellipsis = computed(() => !!setting['desktopLyric.style.ellipsis'])
const frame = shallowRef(karaokeFrame(lyricDoc.value, readLyricPosition(), isRomaFirst.value))
const title = computed(() => {
  if (!musicInfo.id) return ''
  const singer = musicInfo.singer && musicInfo.singer != '^' ? ` - ${musicInfo.singer}` : ''
  return musicInfo.name && musicInfo.name != '^' ? `${musicInfo.name}${singer}` : ''
})

const rootStyle = computed(() => ({
  fontFamily: setting['desktopLyric.style.font'] || undefined,
  fontSize: `${Math.trunc(setting['desktopLyric.style.fontSize'])}px`,
  opacity: setting['desktopLyric.style.opacity'] / 100,
  textAlign: setting['desktopLyric.style.align'],
  '--line-gap': `${setting['desktopLyric.style.lineGap'] / 2}px`,
  '--lyric-color': setting['desktopLyric.style.lyricUnplayColor'],
  '--lyric-glow': setting['desktopLyric.style.lyricPlayedColor'],
}))

/** 每个字：亮度随演唱进度上升；正在唱的字上浮、放大、发光 */
const wordStyle = word => {
  const p = word.progress
  const singing = p > 0 && p < 1
  return {
    opacity: 0.4 + 0.6 * p,
    transform: singing ? 'translateY(-0.05em) scale(1.06)' : undefined,
    '--glow': singing ? 1 : 0,
  }
}

let raf = 0
let timer = null
let unmounted = false
const clearSchedule = () => {
  if (raf) cancelAnimationFrame(raf)
  if (timer) clearTimeout(timer)
  raf = 0
  timer = null
}
const update = () => {
  raf = 0
  timer = null
  frame.value = karaokeFrame(lyricDoc.value, readLyricPosition(), isRomaFirst.value)
  if (unmounted) return
  // 播放中逐帧（点亮要连续）；暂停时低频刷新即可
  if (isPlay.value) raf = requestAnimationFrame(update)
  else timer = setTimeout(update, PAUSED_REFRESH)
}
const refresh = () => {
  clearSchedule()
  update()
}

watch([lyricDoc, clockRevision, isPlay, isRomaFirst], refresh)
onMounted(refresh)
onBeforeUnmount(() => {
  unmounted = true
  clearSchedule()
})
</script>

<style lang="less" module>
.root {
  // contain: strict 含尺寸隔离：竖排时宽度是块方向，不写明会塌成 0
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  cursor: move;
  contain: strict;
  display: flex;
  align-items: center;
  user-select: none;
  color: var(--lyric-color, #fff);
  &.dragging {
    cursor: grabbing;
  }
}
.horizontal {
  padding: 0 .5em;
  .stack {
    width: 100%;
  }
}
.vertical {
  writing-mode: vertical-rl;
  justify-content: center;
  padding: .5em 0;
  .stack {
    height: 100%;
  }
}
.stack {
  position: relative;
  display: grid;
  // 两行各占一个网格单元；换行时离场的旧行与新行叠在同一格里做动画
  grid-template-areas: 'primary' 'secondary';
  row-gap: var(--line-gap);
}
.line {
  margin: 0;
  line-height: 1.3;
  overflow-wrap: break-word;
  // 柔和投影保证在任意桌面背景上可读
  text-shadow: 0 1px 2px rgba(0, 0, 0, .55), 0 2px 10px rgba(0, 0, 0, .35);
}
.primary {
  grid-area: primary;
  font-size: 1em;
  font-weight: 800;
  letter-spacing: -.01em;
}
.secondary {
  grid-area: secondary;
  font-size: .62em;
  font-weight: 600;
  opacity: .78;
  &.next {
    opacity: .5;
  }
}
.word {
  display: inline-block;
  white-space: pre;
  transition: opacity .12s linear, transform .25s cubic-bezier(.3, 1.4, .5, 1), text-shadow .3s ease;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, .55),
    0 2px 10px rgba(0, 0, 0, .35),
    0 0 calc(.45em * var(--glow, 0)) color-mix(in srgb, var(--lyric-glow, #fff) calc(85% * var(--glow, 0)), transparent);
}
.title {
  opacity: .75;
}

// 换行：旧行上移淡出，新行从下方浮入、由模糊变清晰
.lineEnterActive, .lineLeaveActive {
  transition: transform .45s cubic-bezier(.2, .8, .2, 1), opacity .45s ease, filter .45s ease;
}
.lineEnterFrom {
  opacity: 0;
  transform: translateY(.6em);
  filter: blur(6px);
}
.lineLeaveTo {
  opacity: 0;
  transform: translateY(-.6em);
}
// 竖排：块方向是水平的，进出场改为左右移动
.vertical {
  .lineEnterFrom {
    transform: translateX(-.6em);
  }
  .lineLeaveTo {
    transform: translateX(.6em);
  }
}
.ellipsis {
  .line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
