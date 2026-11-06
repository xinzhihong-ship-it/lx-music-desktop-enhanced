<template>
  <div
    :class="[$style.root, vertical ? $style.vertical : $style.horizontal, { [$style.dragging]: isDragging, [$style.ellipsis]: ellipsis }]"
    :style="rootStyle" @mousedown="handleMouseDown" @touchstart="handleTouchStart"
  >
    <div :class="$style.stack">
      <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut" mode="out-in">
        <div :key="`p:${musicInfo.id}:${frame.index}`" :class="[$style.line, $style.primary, { [$style.bold]: primaryBold }]">
          <template v-if="frame.index >= 0">
            <!-- 底层：描边阴影；顶层：逐字渐变填充（两层排版完全一致） -->
            <span :class="$style.shadowLayer" aria-hidden="true"><span v-for="(word, i) in frame.words" :key="i" :class="$style.word">{{ word.text }}</span></span>
            <span :class="$style.fillLayer"><span v-for="(word, i) in frame.words" :key="i" :class="$style.word" :style="{ '--p': word.progress }">{{ word.text }}</span></span>
          </template>
          <template v-else>
            <span :class="$style.shadowLayer" aria-hidden="true">{{ title }}</span>
            <span :class="[$style.fillLayer, $style.plain]">{{ title }}</span>
          </template>
        </div>
      </transition>
      <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut" mode="out-in">
        <div
          v-if="frame.secondary" :key="`s:${musicInfo.id}:${frame.index}:${frame.secondaryKind}`"
          :class="[$style.line, $style.secondary, { [$style.next]: frame.secondaryKind == 'next', [$style.bold]: extendedBold }]"
        >
          <span :class="$style.shadowLayer" aria-hidden="true">{{ frame.secondary }}</span>
          <span :class="[$style.fillLayer, $style.plain]">{{ frame.secondary }}</span>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup>
// 新桌面歌词：卡拉 OK 式两行 —— 当前行逐字填充（无逐字时间的行整行点亮），
// 下面是翻译 / 罗马音，没有时预告下一行。支持横排 / 竖排，沿用原有的字体、颜色、对齐、透明度等设置。
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
const hasWordTiming = computed(() => lyricDoc.value.hasWords)
const primaryBold = computed(() => hasWordTiming.value ? setting['desktopLyric.style.isFontWeightFont'] : setting['desktopLyric.style.isFontWeightLine'])
const extendedBold = computed(() => !!setting['desktopLyric.style.isFontWeightExtended'])
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
  '--line-gap': `${setting['desktopLyric.style.lineGap']}px`,
}))

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
  // 播放中逐帧（填充要连续）；暂停时低频刷新即可
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
@import '@lyric/assets/styles/layout.less';

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
  &.dragging {
    cursor: grabbing;
  }
}
.horizontal {
  padding: 0 .4em;
  .stack {
    width: 100%;
  }
}
.vertical {
  writing-mode: vertical-rl;
  justify-content: center;
  padding: .4em 0;
  .stack {
    height: 100%;
  }
}
.stack {
  display: flex;
  flex-flow: column nowrap;
  gap: var(--line-gap);
}
.line {
  position: relative;
  line-height: 1.25;
  overflow-wrap: break-word;
}
.primary {
  font-size: 1em;
}
.secondary {
  font-size: .8em;
  &.next {
    opacity: .6;
  }
}
.bold {
  font-weight: bold;
}
// 两层叠放：底层只负责描边（文字透明，阴影描出轮廓），顶层是填充色
.shadowLayer {
  color: transparent;
  .stroke3(var(--color-lyric-shadow));
}
.fillLayer {
  position: absolute;
  inset: 0;
}
.plain {
  color: var(--color-lyric-unplay);
}
.word {
  white-space: pre-wrap;
  padding: 0 .06em .12em;
  margin: 0 -.06em -.12em;
}
.fillLayer .word {
  color: transparent;
  background-color: var(--color-lyric-unplay);
  background-image: linear-gradient(var(--color-lyric-played), var(--color-lyric-played));
  background-repeat: no-repeat;
  background-size: calc(var(--p, 0) * 100%) 100%;
  -webkit-background-clip: text;
  background-clip: text;
}
.vertical .fillLayer .word {
  background-size: 100% calc(var(--p, 0) * 100%);
  padding: .06em 0;
  margin: -.06em 0;
}
.ellipsis {
  .line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fillLayer {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .word {
    white-space: pre;
  }
}
</style>
