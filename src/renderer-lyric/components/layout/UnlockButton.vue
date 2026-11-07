<template>
  <!-- 锁定后窗口对鼠标穿透（移动仍会转发进来）：鼠标在歌词上停一下，顶部出现“解锁”按钮；
       只有指针落在按钮上时才让窗口接收点击，其余区域照样穿透 -->
  <transition :enter-from-class="$style.hiddenState" :leave-to-class="$style.hiddenState">
    <button
      v-show="visible" ref="dom_btn" type="button" :class="[$style.btn, { [$style.vertical]: isVertical }]" :style="{ '--ui-scale': uiScale }"
      :aria-label="$t('desktop_lyric__unlock')" @click="handleUnlock"
    >
      <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 7.6-1.8" /></svg>
      <span>{{ $t('desktop_lyric__unlock') }}</span>
    </button>
  </transition>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import { setting } from '@lyric/store/state'
import { updateSetting } from '@lyric/store/action'
import { onMouseEnterLeave, setLyricInteractive } from '@lyric/utils/ipc'
import { lyricUiScale } from './uiScale'

const SHOW_DELAY = 400
const HIDE_DELAY = 1800
const SLACK = 6

const dom_btn = ref(null)
const visible = ref(false)
const isVertical = computed(() => setting['desktopLyric.direction'] == 'vertical')
const uiScale = computed(() => lyricUiScale(setting['desktopLyric.style.fontSize']))

let showTimer = null
let hideTimer = null
let interactive = false
const setInteractive = value => {
  if (interactive == value) return
  interactive = value
  setLyricInteractive(value)
}
const clearTimers = () => {
  if (showTimer) clearTimeout(showTimer)
  if (hideTimer) clearTimeout(hideTimer)
  showTimer = null
  hideTimer = null
}
const hide = () => {
  clearTimers()
  visible.value = false
  setInteractive(false)
}
const isOverButton = (x, y) => {
  const el = dom_btn.value
  if (!el || !visible.value) return false
  const r = el.getBoundingClientRect()
  return x >= r.left - SLACK && x <= r.right + SLACK && y >= r.top - SLACK && y <= r.bottom + SLACK
}
const handleMouseMove = event => {
  if (!setting['desktopLyric.isLock']) return
  const over = isOverButton(event.clientX, event.clientY)
  setInteractive(over)
  if (!visible.value) showTimer ??= setTimeout(() => { showTimer = null; visible.value = true }, SHOW_DELAY)
  if (hideTimer) clearTimeout(hideTimer)
  // 指针停在按钮上时不收起
  hideTimer = over ? null : setTimeout(hide, HIDE_DELAY)
}
const handleUnlock = () => {
  hide()
  updateSetting({ 'desktopLyric.isLock': false })
}

// 主进程检测到鼠标离开窗口
const removeLeaveListener = onMouseEnterLeave(({ params: isEnter }) => { if (!isEnter) hide() })
watch(() => setting['desktopLyric.isLock'], locked => { if (!locked) hide() })
onMounted(() => {
  document.addEventListener('mousemove', handleMouseMove)
  document.documentElement.addEventListener('mouseleave', hide)
})
onBeforeUnmount(() => {
  hide()
  removeLeaveListener()
  document.removeEventListener('mousemove', handleMouseMove)
  document.documentElement.removeEventListener('mouseleave', hide)
})
</script>

<style lang="less" module>
.btn {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px 0 10px;
  border: none;
  border-radius: 15px;
  background: rgba(24, 24, 27, .86);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .08);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transform: translateX(-50%) scale(var(--ui-scale, 1));
  transform-origin: 50% 0;
  transition: opacity .2s ease, transform .2s ease;
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  &:hover {
    background: rgba(40, 40, 44, .92);
  }
  // 竖排：放在右上角
  &.vertical {
    left: auto;
    right: 8px;
    transform: scale(var(--ui-scale, 1));
    transform-origin: 100% 0;
  }
}
.hiddenState {
  opacity: 0;
}
</style>
