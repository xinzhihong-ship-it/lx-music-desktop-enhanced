<template>
  <!-- 悬浮在歌词上方中央的深色胶囊工具栏：图标按钮同尺寸、圆形悬停底色；空白处按住可拖动窗口 -->
  <div :class="$style.bar" role="toolbar" @mousedown="handleLyricMouseDown" @touchstart="handleLyricTouchStart">
    <button type="button" :class="$style.btn" :title="$t('desktop_lyric__lock')" :aria-label="$t('desktop_lyric__lock')" @click="handleLock">
      <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
    </button>
    <i :class="$style.divider" />
    <button type="button" :class="$style.btn" :title="$t('desktop_lyric__font_decrease')" :aria-label="$t('desktop_lyric__font_decrease')" @click="handleFontChange(-1)">
      <svg viewBox="0 0 24 24"><path d="M3.5 18 8 6l4.5 12M5.2 14h5.6M15 12h6" /></svg>
    </button>
    <button type="button" :class="$style.btn" :title="$t('desktop_lyric__font_increase')" :aria-label="$t('desktop_lyric__font_increase')" @click="handleFontChange(1)">
      <svg viewBox="0 0 24 24"><path d="M3.5 18 8 6l4.5 12M5.2 14h5.6M15 12h6M18 9v6" /></svg>
    </button>
    <button
      type="button" :class="$style.btn" :title="$t('desktop_lyric__opacity_decrease')" :aria-label="$t('desktop_lyric__opacity_decrease')"
      @click="handleOpacityChange(-10)" @contextmenu.prevent="handleOpacityChange(-2)"
    >
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" /><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" :class="$style.fillLow" /></svg>
    </button>
    <button
      type="button" :class="$style.btn" :title="$t('desktop_lyric__opacity_increase')" :aria-label="$t('desktop_lyric__opacity_increase')"
      @click="handleOpacityChange(10)" @contextmenu.prevent="handleOpacityChange(2)"
    >
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" :class="$style.fill" /></svg>
    </button>
    <i :class="$style.divider" />
    <button type="button" :class="$style.btn" :title="directionLabel" :aria-label="directionLabel" @click="handleDirection">
      <svg v-if="isVertical" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9" /></svg>
      <svg v-else viewBox="0 0 24 24"><path d="M17 5v14M12 5v14M7 5v9" /></svg>
    </button>
    <button
      type="button" :class="[$style.btn, { [$style.on]: isAlwaysOnTop }]" :aria-pressed="isAlwaysOnTop"
      :title="$t('desktop_lyric__' + (isAlwaysOnTop ? 'win_top_off' : 'win_top_on'))" :aria-label="$t('desktop_lyric__' + (isAlwaysOnTop ? 'win_top_off' : 'win_top_on'))"
      @click="handleAlwaysOnTop"
    >
      <svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8" /></svg>
    </button>
    <button type="button" :class="$style.btn" :title="$t('desktop_lyric__close')" :aria-label="$t('desktop_lyric__close')" @click="handleClose">
      <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17" /></svg>
    </button>
  </div>
</template>

<script setup>
import { computed } from '@common/utils/vueTools'
import { useI18n } from '@lyric/plugins/i18n'
import { setting } from '@lyric/store/state'
import { updateSetting } from '@lyric/store/action'
import useDrag from './useDrag'

const t = useI18n()
const { handleLyricMouseDown, handleLyricTouchStart } = useDrag()

const isAlwaysOnTop = computed(() => !!setting['desktopLyric.isAlwaysOnTop'])
const isVertical = computed(() => setting['desktopLyric.direction'] == 'vertical')
const directionLabel = computed(() => t(isVertical.value ? 'desktop_lyric__direction_horizontal' : 'desktop_lyric__direction_vertical'))

const handleClose = () => { updateSetting({ 'desktopLyric.enable': false }) }
const handleLock = () => { updateSetting({ 'desktopLyric.isLock': true }) }
const handleAlwaysOnTop = () => { updateSetting({ 'desktopLyric.isAlwaysOnTop': !isAlwaysOnTop.value }) }
const handleDirection = () => { updateSetting({ 'desktopLyric.direction': isVertical.value ? 'horizontal' : 'vertical' }) }
const handleFontChange = step => {
  const size = Math.min(Math.max(setting['desktopLyric.style.fontSize'] + step, 10), 80)
  if (size != setting['desktopLyric.style.fontSize']) updateSetting({ 'desktopLyric.style.fontSize': size })
}
const handleOpacityChange = step => {
  const opacity = Math.min(Math.max(setting['desktopLyric.style.opacity'] + step, 6), 100)
  if (opacity != setting['desktopLyric.style.opacity']) updateSetting({ 'desktopLyric.style.opacity': opacity })
}
</script>

<style lang="less" module>
.bar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(24, 24, 27, .86);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .08);
  cursor: move;
}
.divider {
  width: 1px;
  height: 14px;
  margin: 0 3px;
  background: rgba(255, 255, 255, .16);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: rgba(255, 255, 255, .82);
  cursor: pointer;
  transition: background-color .15s ease, color .15s ease, transform .15s ease;
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
  }
  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, .14);
  }
  &:active {
    transform: scale(.92);
  }
  &.on {
    color: #fff;
    background: rgba(255, 255, 255, .2);
  }
}
.fill {
  fill: currentColor;
}
.fillLow {
  fill: currentColor;
  stroke: none;
  opacity: .45;
}
</style>
