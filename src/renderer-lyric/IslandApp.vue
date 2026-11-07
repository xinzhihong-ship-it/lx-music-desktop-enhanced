<template>
  <div :class="$style.stage">
    <div
      ref="dom_capsule"
      :class="[$style.capsule, $style[layout], { [$style.expanded]: expanded, [$style.hidden]: hidden }]"
      :style="capsuleStyle"
    >
      <!-- 收起。刘海屏：只在刘海两侧露出封面和电平，中间正好是刘海，不占菜单栏；常驻时刘海下方多一行歌词。
           其他屏：封面 + 当前歌词（逐字填充）+ 电平 -->
      <div v-show="!expanded" :class="$style.compact">
        <div :class="$style.compactRow" :style="layout == 'notch' ? { height: `${display.menuBar}px` } : null">
          <img v-if="musicInfo.pic" :src="musicInfo.pic" :class="$style.thumb" alt="">
          <span v-else :class="[$style.thumb, $style.thumbEmpty]" />
          <span v-if="layout == 'notch'" :class="$style.notchGap" />
          <p v-else :class="$style.compactLine">
            <template v-if="frame.index >= 0">
              <span v-for="(word, i) in frame.words" :key="i" :class="$style.word" :style="{ '--p': word.progress }">{{ word.text }}</span>
            </template>
            <span v-else :class="$style.plainText">{{ title || $t('island__not_playing') }}</span>
          </p>
          <span :class="[$style.levels, { [$style.levelsOn]: isPlay }]" aria-hidden="true"><i /><i /><i /><i /></span>
        </div>
        <p v-if="showChin" :class="$style.chin">
          <span v-for="(word, i) in frame.words" :key="i" :class="$style.word" :style="{ '--p': word.progress }">{{ word.text }}</span>
        </p>
      </div>

      <!-- 展开：迷你播放器 -->
      <div v-show="expanded" :class="$style.full">
        <div :class="$style.head">
          <img v-if="musicInfo.pic" :src="musicInfo.pic" :class="$style.cover" alt="">
          <span v-else :class="[$style.cover, $style.thumbEmpty]" />
          <div :class="$style.meta">
            <p :class="$style.name">{{ musicInfo.id ? musicInfo.name : $t('island__not_playing') }}</p>
            <p :class="$style.singer">{{ musicInfo.id ? musicInfo.singer : '' }}</p>
          </div>
          <span :class="[$style.levels, $style.levelsBig, { [$style.levelsOn]: isPlay }]" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        </div>
        <div :class="$style.lyric">
          <p :class="$style.lyricMain">
            <template v-if="frame.index >= 0">
              <span v-for="(word, i) in frame.words" :key="i" :class="$style.word" :style="{ '--p': word.progress }">{{ word.text }}</span>
            </template>
            <span v-else :class="$style.plainText">{{ title }}</span>
          </p>
          <p v-if="frame.secondary" :class="$style.lyricSub">{{ frame.secondary }}</p>
        </div>
        <div :class="$style.progress">
          <span>{{ formatTime(shownTime) }}</span>
          <span
            :class="[$style.bar, { [$style.barActive]: seeking }]" role="slider" :aria-valuenow="Math.round(shownTime / 1000)" :aria-valuemax="Math.round(duration)"
            @pointerdown="handleSeekStart" @pointermove="handleSeekMove" @pointerup="handleSeekEnd" @pointercancel="handleSeekCancel"
          ><i :style="{ transform: `scaleX(${shownProgress})` }" /></span>
          <span>{{ formatTime(duration * 1000) }}</span>
        </div>
        <div :class="$style.controls">
          <button type="button" :class="$style.ctrl" :aria-label="$t('island__prev')" @click="playPrev">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
          </button>
          <button type="button" :class="[$style.ctrl, $style.ctrlMain]" :aria-label="$t(isPlay ? 'island__pause' : 'island__play')" @click="playToggle">
            <svg v-if="isPlay" viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
            <svg v-else viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
          </button>
          <button type="button" :class="$style.ctrl" :aria-label="$t('island__next')" @click="playNext">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 顶部歌词岛：屏幕顶部中央的黑色胶囊，平时显示当前歌词，鼠标停留 300ms 展开为迷你播放器。
// 窗口默认鼠标穿透（forward：仍能收到移动事件）；鼠标进入胶囊时请求接收鼠标，离开后恢复穿透。
// 不常驻时（island.alwaysShow 关闭）平时隐藏，鼠标贴到屏幕顶部中央才出现，避免挡住最大化窗口的标题栏。
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from '@common/utils/vueTools'
import { karaokeFrame } from '@common/utils/lyrics'
import { clockRevision, init as initLyric, isRomaFirst, lyricDoc, readLyricPosition, readMediaTime } from '@lyric/core/lyric'
import { playNext, playPrev, playToggle, seekTo } from '@lyric/core/mainWindowChannel'
import { duration, isPlay, musicInfo, setting } from '@lyric/store/state'
import { onIslandDisplayInfo, sendConnectMainWindowEvent, setIslandInteractive } from '@lyric/utils/ipc'

const query = new URLSearchParams(location.search)
const isMac = query.get('os') == 'mac'
const HOVER_DELAY = 300
const LEAVE_DELAY = 300
const SLACK = 6
const REVEAL_HALF_WIDTH = 110
const REVEAL_DEPTH = 3
// 刘海宽度拿不到准确值（系统没有开放给 Electron），按常见机型取 200，两侧各留一个“翼”放封面和电平
const NOTCH_WIDTH = 200
const FLOAT_GAP = 6

/** 所在屏幕：主进程在换屏 / 改分辨率时推送 */
const display = reactive({ notch: query.get('notch') == 'true', menuBar: Number(query.get('menuBar')) || 0 })
// notch：贴着刘海；float：macOS 普通屏，放在菜单栏下方，不挡菜单；top：Windows / Linux，贴着屏幕顶边
const layout = computed(() => isMac ? (display.notch ? 'notch' : 'float') : 'top')

const dom_capsule = ref(null)
const expanded = ref(false)
const inside = ref(false)
const frame = shallowRef(karaokeFrame(lyricDoc.value, 0))
const mediaTime = ref(0)

const title = computed(() => {
  if (!musicInfo.id || !musicInfo.name || musicInfo.name == '^') return ''
  return musicInfo.singer && musicInfo.singer != '^' ? `${musicInfo.name} - ${musicInfo.singer}` : musicInfo.name
})
// 刘海屏常驻显示：刘海下方多一行当前歌词
const showChin = computed(() => layout.value == 'notch' && !!setting['island.alwaysShow'] && frame.value.index >= 0 && isPlay.value)
// 不常驻：只有鼠标在胶囊上（或移到顶部中央）时才显示。刘海屏上的“翼”与刘海融为一体，始终显示
const hidden = computed(() => layout.value != 'notch' && !setting['island.alwaysShow'] && !inside.value && !expanded.value)
const EXPANDED_BODY = 176
const capsuleStyle = computed(() => {
  const top = layout.value == 'float' ? `${display.menuBar + FLOAT_GAP}px` : '0px'
  if (expanded.value) {
    // 刘海屏：内容从菜单栏下方开始，整体加高菜单栏的高度
    const notch = layout.value == 'notch'
    return { top, width: '460px', height: `${notch ? EXPANDED_BODY + display.menuBar : EXPANDED_BODY}px`, '--pad-top': notch ? `${display.menuBar}px` : '0px' }
  }
  if (layout.value == 'notch') {
    const wing = Math.max(36, display.menuBar + 6)
    return { top, width: `${NOTCH_WIDTH + wing * 2}px`, height: `${display.menuBar + (showChin.value ? 30 : 0)}px` }
  }
  return { top, width: musicInfo.id ? '380px' : '220px', height: '34px' }
})
const progress = computed(() => duration.value > 0 ? Math.min(1, mediaTime.value / (duration.value * 1000)) : 0)

// ---- 拖动进度条：拖动中只预览，松手时跳转 ----
const seeking = ref(false)
const seekRatio = ref(0)
const shownProgress = computed(() => seeking.value ? seekRatio.value : progress.value)
const shownTime = computed(() => seeking.value ? seekRatio.value * duration.value * 1000 : mediaTime.value)
const ratioAt = event => {
  const rect = event.currentTarget.getBoundingClientRect()
  return rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0
}
const handleSeekStart = event => {
  if (!(duration.value > 0) || event.button != 0) return
  event.currentTarget.setPointerCapture(event.pointerId)
  seeking.value = true
  seekRatio.value = ratioAt(event)
}
const handleSeekMove = event => {
  if (seeking.value) seekRatio.value = ratioAt(event)
}
const handleSeekEnd = event => {
  if (!seeking.value) return
  seekRatio.value = ratioAt(event)
  seeking.value = false
  seekTo(seekRatio.value * duration.value)
}
const handleSeekCancel = () => { seeking.value = false }

const formatTime = ms => {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// ---- 刷新：播放中逐帧（逐字填充），暂停时低频 ----
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
  mediaTime.value = readMediaTime()
  if (unmounted) return
  if (isPlay.value) raf = requestAnimationFrame(update)
  else timer = setTimeout(update, 500)
}
const refresh = () => {
  clearSchedule()
  update()
}
watch([lyricDoc, clockRevision, isPlay, isRomaFirst], refresh)

// ---- 鼠标：命中胶囊 / 顶部中央 → 接收鼠标并计时展开；离开 → 恢复穿透并计时收起 ----
let hoverTimer = null
let leaveTimer = null
let interactive = false
const setInteractive = value => {
  if (interactive == value) return
  interactive = value
  setIslandInteractive(value)
}
const hitTest = (x, y) => {
  const el = dom_capsule.value
  if (!el) return false
  const rect = el.getBoundingClientRect()
  if (!hidden.value && x >= rect.left - SLACK && x <= rect.right + SLACK && y >= rect.top - SLACK && y <= rect.bottom + SLACK) return true
  // 隐藏时的唤出区：屏幕顶边（macOS 普通屏为菜单栏）中央一段
  const depth = layout.value == 'float' ? display.menuBar + REVEAL_DEPTH : REVEAL_DEPTH
  return y <= depth && Math.abs(x - window.innerWidth / 2) <= REVEAL_HALF_WIDTH
}
const setInside = value => {
  if (inside.value == value) return
  inside.value = value
  if (value) {
    setInteractive(true)
    if (leaveTimer) clearTimeout(leaveTimer)
    leaveTimer = null
    hoverTimer ??= setTimeout(() => {
      hoverTimer = null
      if (inside.value) expanded.value = true
    }, HOVER_DELAY)
  } else {
    setInteractive(false)
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = null
    leaveTimer ??= setTimeout(() => {
      leaveTimer = null
      if (!inside.value) expanded.value = false
    }, LEAVE_DELAY)
  }
}
const handleMouseMove = event => { setInside(hitTest(event.clientX, event.clientY)) }
const handleMouseLeave = () => { setInside(false) }

const removeDisplayListener = onIslandDisplayInfo(({ params }) => {
  display.notch = params.notch
  display.menuBar = params.menuBar
})

onMounted(() => {
  initLyric()
  sendConnectMainWindowEvent()
  document.addEventListener('mousemove', handleMouseMove)
  document.documentElement.addEventListener('mouseleave', handleMouseLeave)
  refresh()
})
onBeforeUnmount(() => {
  unmounted = true
  clearSchedule()
  removeDisplayListener()
  document.removeEventListener('mousemove', handleMouseMove)
  document.documentElement.removeEventListener('mouseleave', handleMouseLeave)
})
</script>

<style lang="less">
html, body, #root {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent !important;
}
// 与桌面歌词共用一个渲染包：桌面歌词 App.vue 里的全局 body { opacity: .8 } 也会加载进来，歌词岛不需要
body {
  opacity: 1 !important;
}
</style>

<style lang="less" module>
.stage {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #fff;
  user-select: none;
}
.capsule {
  position: relative;
  overflow: hidden;
  background: #000;
  border-radius: 0 0 17px 17px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .28);
  // 带一点回弹的展开 / 收起
  transition: width .5s cubic-bezier(.34, 1.36, .64, 1), height .5s cubic-bezier(.34, 1.36, .64, 1), border-radius .4s ease, opacity .25s ease, transform .3s ease;
  &.expanded {
    border-radius: 0 0 26px 26px;
  }
  // 刘海屏：收起时与刘海同色同高，底部小圆角
  &.notch {
    border-radius: 0 0 12px 12px;
    box-shadow: none;
    &.expanded {
      border-radius: 0 0 26px 26px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .28);
    }
  }
  // 普通屏：悬浮在菜单栏下方的胶囊
  &.float {
    border-radius: 17px;
    &.expanded {
      border-radius: 24px;
    }
  }
  &.hidden {
    opacity: 0;
    transform: translateY(-100%);
  }
  .full {
    padding-top: calc(var(--pad-top, 0px) + 16px);
  }
}
.compact {
  display: flex;
  flex-flow: column nowrap;
}
.compactRow {
  height: 34px;
  padding: 0 12px 0 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.notch .compactRow {
  padding: 0 14px;
}
.notchGap {
  flex: auto;
}
.chin {
  height: 30px;
  margin: 0;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  line-height: 26px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.thumb {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: cover;
}
.thumbEmpty {
  background: rgba(255, 255, 255, .14);
}
.compactLine {
  flex: auto;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.word {
  white-space: pre;
  color: transparent;
  background-color: rgba(255, 255, 255, .42);
  background-image: linear-gradient(#fff, #fff);
  background-repeat: no-repeat;
  background-size: calc(var(--p, 0) * 100%) 100%;
  -webkit-background-clip: text;
  background-clip: text;
}
.plainText {
  color: rgba(255, 255, 255, .7);
}
.levels {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
  i {
    width: 2.5px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, .8);
    transition: height .3s ease;
  }
  &.levelsOn i {
    animation: level 1s ease-in-out infinite;
    &:nth-child(2) { animation-delay: -.3s; }
    &:nth-child(3) { animation-delay: -.6s; }
    &:nth-child(4) { animation-delay: -.15s; }
    &:nth-child(5) { animation-delay: -.45s; }
  }
}
.levelsBig {
  height: 22px;
  i { width: 3px; }
}
@keyframes level {
  0%, 100% { height: 3px; }
  50% { height: 100%; }
}
.full {
  padding: 16px 22px 14px;
  box-sizing: border-box;
  display: flex;
  flex-flow: column nowrap;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cover {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: cover;
}
.meta {
  flex: auto;
  min-width: 0;
  p {
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
.name {
  font-size: 14px;
  font-weight: 700;
}
.singer {
  font-size: 12px;
  color: rgba(255, 255, 255, .55);
}
.lyric {
  min-height: 34px;
  p {
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
.lyricMain {
  font-size: 15px;
  font-weight: 700;
}
.lyricSub {
  font-size: 12px;
  color: rgba(255, 255, 255, .5);
}
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, .5);
}
// 可拖动的进度条：点击区域 14px 高，可见轨道 3px（悬停 / 拖动时加粗）
.bar {
  flex: auto;
  position: relative;
  height: 14px;
  cursor: pointer;
  touch-action: none;
  &::before, i {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 3px;
    margin-top: -1.5px;
    border-radius: 2px;
    transition: height .15s ease, margin-top .15s ease;
  }
  &::before {
    content: '';
    background: rgba(255, 255, 255, .18);
  }
  i {
    display: block;
    background: rgba(255, 255, 255, .9);
    transform-origin: 0 50%;
  }
  &:hover, &.barActive {
    &::before, i {
      height: 5px;
      margin-top: -2.5px;
    }
  }
}
.controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 26px;
  margin-top: -4px;
}
.ctrl {
  display: inline-flex;
  padding: 4px;
  border: none;
  border-radius: 50%;
  background: none;
  color: rgba(255, 255, 255, .85);
  cursor: pointer;
  transition: background-color .15s ease, transform .15s ease;
  &:hover {
    background: rgba(255, 255, 255, .12);
  }
  &:active {
    transform: scale(.92);
  }
}
.ctrlMain {
  color: #fff;
}
</style>
