<template>
  <div
    :class="[$style.root, vertical && !isStage ? $style.vertical : $style.horizontal, { [$style.dragging]: isDragging, [$style.ellipsis]: ellipsis }]"
    :style="rootStyle" @mousedown="handleMouseDown" @touchstart="handleTouchStart"
  >
    <!-- 舞台风格：与播放详情页相同的流动 / 阶梯 / 倾诉（只做横排） -->
    <StageView
      v-if="isStage" :class="$style.stage" :doc="lyricDoc" :style-name="mode" :sparks="!!setting['desktopLyric.stageSparks']"
      :accent="setting['desktopLyric.style.lyricPlayedColor']" :read-position="readLyricPosition" :playing="isPlay" :roma-first="isRomaFirst"
      :base-size="fontSize" compact
    />
    <!-- 双行 / 翻译：上排靠左、下排靠右。双行时第 1、3、5… 句固定在上排，第 2、4、6… 句在下排；
         翻译时上排是当前句、下排是它的翻译（没有翻译的句子按双行交替） -->
    <div v-else-if="isRows" :class="[$style.stack, $style.double]">
      <template v-for="(row, r) in rows" :key="r">
        <transition
          :enter-from-class="$style.lineEnterFrom" :enter-active-class="$style.lineEnterActive"
          :leave-to-class="$style.lineLeaveTo" :leave-active-class="$style.lineLeaveActive"
        >
          <p
            v-if="row" :key="`${row.translation ? 't' : 'd'}:${musicInfo.id}:${row.index}`"
            :class="[$style.line, $style.primary, r ? $style.rowB : $style.rowA, { [$style.waiting]: !row.active, [$style.translation]: row.translation }]"
          >
            <template v-if="row.active && !row.translation">
              <span v-for="(word, i) in row.words" :key="i" :class="[$style.word, { [$style.singing]: isSinging(word) }]" :style="wordStyle(word)">{{ word.text }}</span>
            </template>
            <template v-else>{{ row.words.map(w => w.text).join('') }}</template>
          </p>
        </transition>
      </template>
    </div>
    <!-- 单行：只显示当前句 -->
    <div v-else :class="$style.stack">
      <transition
        :enter-from-class="$style.lineEnterFrom" :enter-active-class="$style.lineEnterActive"
        :leave-to-class="$style.lineLeaveTo" :leave-active-class="$style.lineLeaveActive"
      >
        <p :key="`p:${musicInfo.id}:${frame.index}`" :class="[$style.line, $style.primary]">
          <template v-if="frame.index >= 0">
            <span v-for="(word, i) in frame.words" :key="i" :class="[$style.word, { [$style.singing]: isSinging(word) }]" :style="wordStyle(word)">{{ word.text }}</span>
          </template>
          <span v-else :class="$style.title">{{ title }}</span>
        </p>
      </transition>
    </div>
  </div>
</template>

<script setup>
// 桌面歌词。显示方式（desktopLyric.lineMode）：
//   single 单行；double 双行交替（酷狗 / 网易云式，下一句在原位亮起）；extended 当前句 + 翻译（排版同双行）；
//   flow / steps / tilt 与播放详情页相同的舞台风格。
// 颜色：没唱到的字用“文字颜色”（半透明），唱过的字用“高亮颜色”，正在唱的字按进度在两者之间过渡并微微上浮、带柔光；
// “阴影颜色”用于外圈柔和投影。沿用字体、字号、透明度、对齐、行距、单行省略、横竖排设置。在歌词上按住拖动可移动窗口。
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from '@common/utils/vueTools'
import { doubleLineFrame, karaokeFrame } from '@common/utils/lyrics'
import { clockRevision, isRomaFirst, lyricDoc, readLyricPosition } from '@lyric/core/lyric'
import { isPlay, musicInfo, setting } from '@lyric/store/state'
import useWindowDrag from '@lyric/useApp/useWindowDrag'
import StageView from '@renderer/components/layout/PlayDetail/lyrics/StageView.vue'

const PAUSED_REFRESH = 500
const STAGE_MODES = ['flow', 'steps', 'tilt']

const { isDragging, handleMouseDown, handleTouchStart } = useWindowDrag()

const vertical = computed(() => setting['desktopLyric.direction'] == 'vertical')
const ellipsis = computed(() => !!setting['desktopLyric.style.ellipsis'])
const mode = computed(() => setting['desktopLyric.lineMode'] ?? 'double')
const isStage = computed(() => STAGE_MODES.includes(mode.value))
const isRows = computed(() => mode.value == 'double' || mode.value == 'extended')
const fontSize = computed(() => Math.trunc(setting['desktopLyric.style.fontSize']))
const frame = shallowRef(karaokeFrame(lyricDoc.value, readLyricPosition(), isRomaFirst.value))
const rows = shallowRef([null, null])
const title = computed(() => {
  if (!musicInfo.id) return ''
  const singer = musicInfo.singer && musicInfo.singer != '^' ? ` - ${musicInfo.singer}` : ''
  return musicInfo.name && musicInfo.name != '^' ? `${musicInfo.name}${singer}` : ''
})

const rootStyle = computed(() => ({
  fontFamily: setting['desktopLyric.style.font'] || undefined,
  fontSize: `${fontSize.value}px`,
  opacity: setting['desktopLyric.style.opacity'] / 100,
  textAlign: setting['desktopLyric.style.align'],
  '--line-gap': `${setting['desktopLyric.style.lineGap'] / 2}px`,
  '--lyric-color': setting['desktopLyric.style.lyricUnplayColor'],
  '--lyric-played': setting['desktopLyric.style.lyricPlayedColor'],
  '--lyric-shadow': setting['desktopLyric.style.lyricShadowColor'],
  // 舞台风格的文字颜色
  '--stage-color': setting['desktopLyric.style.lyricUnplayColor'],
}))

const isSinging = word => word.progress > 0 && word.progress < 1
/** 每个字的颜色按演唱进度从“文字颜色”过渡到“高亮颜色” */
const wordStyle = word => ({ '--p': `${Math.round(word.progress * 100)}%` })

/** 翻译模式：当前句有翻译 / 罗马音时，上排当前句、下排翻译；否则按双行交替 */
const translationRows = (pos) => {
  const f = karaokeFrame(lyricDoc.value, pos, isRomaFirst.value)
  if (f.index < 0 || f.secondaryKind != 'extended') return doubleLineFrame(lyricDoc.value, pos)
  return [
    { index: f.index, words: f.words, active: true },
    { index: f.index, words: [{ text: f.secondary, progress: 0 }], active: true, translation: true },
  ]
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
  // 舞台风格由 StageView 自己调度刷新
  if (unmounted || isStage.value) return
  const pos = readLyricPosition()
  if (mode.value == 'double') rows.value = doubleLineFrame(lyricDoc.value, pos)
  else if (mode.value == 'extended') rows.value = translationRows(pos)
  else frame.value = karaokeFrame(lyricDoc.value, pos, isRomaFirst.value)
  // 播放中逐帧（点亮要连续）；暂停时低频刷新即可
  if (isPlay.value) raf = requestAnimationFrame(update)
  else timer = setTimeout(update, PAUSED_REFRESH)
}
const refresh = () => {
  clearSchedule()
  update()
}

watch([lyricDoc, clockRevision, isPlay, isRomaFirst, mode], refresh)
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
.stage {
  flex: auto;
  width: 100%;
  height: 100%;
}
.line {
  margin: 0;
  line-height: 1.3;
  overflow-wrap: break-word;
  color: var(--lyric-color, #fff);
  // 柔和投影保证在任意桌面背景上可读
  text-shadow: 0 1px 2px rgba(0, 0, 0, .55), 0 2px 10px var(--lyric-shadow, rgba(0, 0, 0, .35));
}
.primary {
  grid-area: primary;
  font-size: 1em;
  font-weight: 800;
  letter-spacing: -.01em;
}
// 没唱到：文字颜色（半透明）；唱过：高亮颜色；正在唱：两者按进度混合，并上浮、放大、带高亮色柔光
.word {
  display: inline-block;
  white-space: pre;
  color: color-mix(in srgb, var(--lyric-played, #fff) var(--p, 0%), color-mix(in srgb, var(--lyric-color, #fff) 50%, transparent));
  transition: transform .25s cubic-bezier(.3, 1.4, .5, 1), text-shadow .3s ease;
}
.singing {
  transform: translateY(-.05em) scale(1.06);
  text-shadow:
    0 1px 2px rgba(0, 0, 0, .55),
    0 2px 10px var(--lyric-shadow, rgba(0, 0, 0, .35)),
    0 0 .45em color-mix(in srgb, var(--lyric-played, #fff) 85%, transparent);
}
.title {
  opacity: .75;
}
// 双行：两排同字号，上排靠左、下排靠右（竖排时上排靠上、下排靠下）；等待中的一排半透明
.double {
  // 两排都保留一行高度：最后一句时上排为空，下排也不往上挪
  grid-template-rows: repeat(2, minmax(1.3em, auto));
  .rowA {
    grid-area: primary;
    justify-self: start;
    text-align: start;
  }
  .rowB {
    grid-area: secondary;
    justify-self: end;
    text-align: end;
  }
  .line {
    max-width: 100%;
    box-sizing: border-box;
  }
}
.waiting {
  opacity: .5;
}
.translation {
  font-size: .8em;
  font-weight: 700;
  opacity: .88;
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
