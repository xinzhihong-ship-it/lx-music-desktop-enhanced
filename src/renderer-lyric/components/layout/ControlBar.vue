<template>
  <!-- 桌面歌词工具栏（深色胶囊）。横排时在顶部中央一行，竖排时在右侧一列；按窗口大小整体缩放，
       太小时才依次隐藏透明度、方向 / 置顶、字号按钮。点“颜色”后整条换成颜色选择，点 ✓ 返回。空白处按住可拖动窗口 -->
  <div
    ref="dom_bar" :class="[$style.bar, { [$style.vbar]: isVertical }]" :style="barStyle" role="toolbar"
    @mousedown="handleLyricMouseDown" @touchstart="handleLyricTouchStart"
  >
    <template v-if="!colorMode">
      <button type="button" :class="$style.btn" :title="$t('desktop_lyric__lock')" :aria-label="$t('desktop_lyric__lock')" @click="handleLock">
        <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      </button>
      <i :class="$style.divider" />
      <div :class="$style.segment" role="radiogroup" :aria-label="$t('setting__desktop_lyric_line_mode')">
        <button
          v-for="item in modeList" :key="item.id" type="button" role="radio" :aria-checked="lineMode == item.id"
          :class="[$style.seg, { [$style.segOn]: lineMode == item.id }]" @click="setLineMode(item.id)"
        >{{ item.label }}</button>
      </div>
      <button
        type="button" :class="[$style.seg, $style.chip, { [$style.segOn]: wordByWord }]" :aria-pressed="wordByWord"
        :title="$t('lyric_view__word_tip')" @click="toggleWordByWord"
      >{{ $t('lyric_view__word') }}</button>
      <button
        type="button" :class="[$style.seg, $style.chip, { [$style.segOn]: sparks && isStage }]" :aria-pressed="sparks" :disabled="!isStage"
        :title="$t('lyric_view__sparks_tip')" @click="toggleSparks"
      >{{ $t('lyric_view__sparks') }}</button>
      <i :class="$style.divider" />
      <!-- 歌词偏移：±100ms（右击 ±500ms），点中间的数值恢复原始偏移 -->
      <div v-if="level < 3" :class="$style.offset" role="group" :aria-label="$t('desktop_lyric__offset')">
        <button
          type="button" :class="$style.btn" :title="$t('desktop_lyric__offset_dec')" :aria-label="$t('desktop_lyric__offset_dec')"
          @click="adjustLyricOffset(-100)" @contextmenu.prevent="adjustLyricOffset(-500)"
        >
          <svg viewBox="0 0 24 24"><path d="M6 12h12" /></svg>
        </button>
        <button type="button" :class="[$style.seg, $style.offsetValue]" :title="$t('desktop_lyric__offset_reset')" @click="resetLyricOffset">{{ offsetLabel }}</button>
        <button
          type="button" :class="$style.btn" :title="$t('desktop_lyric__offset_inc')" :aria-label="$t('desktop_lyric__offset_inc')"
          @click="adjustLyricOffset(100)" @contextmenu.prevent="adjustLyricOffset(500)"
        >
          <svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12" /></svg>
        </button>
      </div>
      <i v-if="level < 3" :class="$style.divider" />
      <button type="button" :class="$style.btn" :title="$t('desktop_lyric__color')" :aria-label="$t('desktop_lyric__color')" @click="colorMode = true">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="9" cy="9.5" r="1.4" :class="$style.fill" /><circle cx="14.5" cy="8.5" r="1.4" :class="$style.fill" /><circle cx="16" cy="13.5" r="1.4" :class="$style.fill" /></svg>
      </button>
      <template v-if="level < 3">
        <button type="button" :class="$style.btn" :title="$t('desktop_lyric__font_decrease')" :aria-label="$t('desktop_lyric__font_decrease')" @click="handleFontChange(-1)">
          <svg viewBox="0 0 24 24"><path d="M3.5 18 8 6l4.5 12M5.2 14h5.6M15 12h6" /></svg>
        </button>
        <button type="button" :class="$style.btn" :title="$t('desktop_lyric__font_increase')" :aria-label="$t('desktop_lyric__font_increase')" @click="handleFontChange(1)">
          <svg viewBox="0 0 24 24"><path d="M3.5 18 8 6l4.5 12M5.2 14h5.6M15 12h6M18 9v6" /></svg>
        </button>
      </template>
      <template v-if="level < 1">
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
      </template>
      <template v-if="level < 2">
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
      </template>
      <i :class="$style.divider" />
      <button type="button" :class="$style.btn" :title="$t('desktop_lyric__close')" :aria-label="$t('desktop_lyric__close')" @click="handleClose">
        <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17" /></svg>
      </button>
    </template>

    <!-- 颜色：文字颜色（没唱到的字）与高亮颜色（唱过的字） -->
    <template v-else>
      <div v-for="group in colorGroups" :key="group.key" :class="$style.colorGroup" role="radiogroup" :aria-label="group.label">
        <span :class="$style.colorLabel">{{ group.label }}</span>
        <button
          v-for="color in group.colors" :key="color" type="button" role="radio" :aria-checked="isSameColor(setting[group.key], color)"
          :class="[$style.swatch, { [$style.swatchOn]: isSameColor(setting[group.key], color) }]" :style="{ '--swatch': color }"
          :aria-label="color" @click="updateSetting({ [group.key]: color })"
        />
        <!-- 自定义：系统取色器（macOS 为色轮） -->
        <label
          :class="[$style.swatch, $style.custom, { [$style.swatchOn]: !group.colors.some(color => isSameColor(setting[group.key], color)) }]"
          :style="{ '--swatch': setting[group.key] }" :title="$t('desktop_lyric__color_custom')"
        >
          <input type="color" :value="toHex(setting[group.key])" :aria-label="$t('desktop_lyric__color_custom')" @input="updateSetting({ [group.key]: toRgba($event.target.value) })">
        </label>
      </div>
      <i :class="$style.divider" />
      <button type="button" :class="$style.btn" :title="$t('desktop_lyric__color_reset')" :aria-label="$t('desktop_lyric__color_reset')" @click="resetColors">
        <svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.1-5" /><path d="M5 4.5V8h3.5" /></svg>
      </button>
      <button type="button" :class="$style.btn" :title="$t('desktop_lyric__back')" :aria-label="$t('desktop_lyric__back')" @click="colorMode = false">
        <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </button>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import { useI18n } from '@lyric/plugins/i18n'
import { setting } from '@lyric/store/state'
import { updateSetting } from '@lyric/store/action'
import useDrag from './useDrag'
import { lyricUiScale } from './uiScale'
import { lyricDoc } from '@lyric/core/lyric'
import { adjustLyricOffset, resetLyricOffset } from '@lyric/core/mainWindowChannel'

const t = useI18n()
const { handleLyricMouseDown, handleLyricTouchStart } = useDrag()

const isAlwaysOnTop = computed(() => !!setting['desktopLyric.isAlwaysOnTop'])
const isVertical = computed(() => setting['desktopLyric.direction'] == 'vertical')
const directionLabel = computed(() => t(isVertical.value ? 'desktop_lyric__direction_horizontal' : 'desktop_lyric__direction_vertical'))

const lineMode = computed(() => setting['desktopLyric.lineMode'] ?? 'double')
const isStage = computed(() => ['flow', 'steps', 'tilt'].includes(lineMode.value))
const sparks = computed(() => !!setting['desktopLyric.stageSparks'])
const toggleSparks = () => { updateSetting({ 'desktopLyric.stageSparks': !sparks.value }) }
const wordByWord = computed(() => setting['player.lyricHighlight'] != 'line')
const toggleWordByWord = () => { updateSetting({ 'player.lyricHighlight': wordByWord.value ? 'line' : 'word' }) }
const modeList = computed(() => [
  { id: 'single', label: t('desktop_lyric__mode_single') },
  { id: 'double', label: t('desktop_lyric__mode_double') },
  { id: 'extended', label: t('desktop_lyric__mode_extended') },
  { id: 'flow', label: t('lyric_view__style_flow') },
  { id: 'steps', label: t('lyric_view__style_steps') },
  { id: 'tilt', label: t('lyric_view__style_tilt') },
])
// 当前歌词偏移（来自主窗口发来的歌词原文的 [offset:] 标签），以秒显示
const offsetLabel = computed(() => {
  const ms = lyricDoc.value.offset
  return `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${(Math.abs(ms) / 1000).toFixed(1)}s`
})
const setLineMode = id => { if (lineMode.value != id) updateSetting({ 'desktopLyric.lineMode': id }) }
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

// ---- 颜色 ----
const colorMode = ref(false)
const colorGroups = computed(() => [
  {
    key: 'desktopLyric.style.lyricUnplayColor',
    label: t('setting__desktop_lyric_unplay_color'),
    colors: ['rgba(255, 255, 255, 1)', 'rgba(255, 244, 214, 1)', 'rgba(207, 232, 255, 1)', 'rgba(255, 214, 231, 1)', 'rgba(208, 255, 232, 1)', 'rgba(40, 40, 44, 1)'],
  },
  {
    key: 'desktopLyric.style.lyricPlayedColor',
    label: t('setting__desktop_lyric_played_color'),
    colors: ['rgba(255, 255, 255, 1)', 'rgba(255, 196, 64, 1)', 'rgba(7, 197, 86, 1)', 'rgba(57, 203, 255, 1)', 'rgba(255, 92, 168, 1)', 'rgba(179, 136, 255, 1)'],
  },
])
const normalizeColor = color => String(color ?? '').replace(/\s+/g, '').toLowerCase()
const isSameColor = (a, b) => normalizeColor(a) == normalizeColor(b)
// 取色器只认 #rrggbb；设置里存 rgba(...)
const toHex = color => {
  const m = String(color ?? '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff'
  return '#' + m.slice(1, 4).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
}
const toRgba = hex => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 1)`
}
// 恢复默认颜色（与 defaultSetting 中的初始值一致）
const DEFAULT_COLORS = {
  'desktopLyric.style.lyricUnplayColor': 'rgba(255, 255, 255, 1)',
  'desktopLyric.style.lyricPlayedColor': 'rgba(7, 197, 86, 1)',
  'desktopLyric.style.lyricShadowColor': 'rgba(0, 0, 0, 0.18)',
}
const resetColors = () => { updateSetting({ ...DEFAULT_COLORS }) }

// ---- 大小：按歌词字号定基准大小（uiScale），再按窗口大小收缩；缩到 0.72 仍放不下时依次隐藏次要按钮（level 1~3） ----
const MIN_SCALE = 0.72
const BAR_GAP = 16
const dom_bar = ref(null)
const level = ref(0)
const scale = ref(1)
const barStyle = computed(() => ({ transform: `scale(${scale.value})` }))
// 每次调整都有编号：窗口连续缩放时，旧的那次在 await 之后发现已被新的取代就直接放弃
let fitRun = 0
const fit = async() => {
  const run = ++fitRun
  level.value = 0
  await nextTick()
  for (;;) {
    const el = dom_bar.value
    if (!el || run != fitRun) return
    const natural = isVertical.value ? el.offsetHeight : el.offsetWidth
    const avail = (isVertical.value ? window.innerHeight : window.innerWidth) - BAR_GAP
    const desired = lyricUiScale(setting['desktopLyric.style.fontSize'])
    const room = natural > 0 ? avail / natural : desired
    if (room >= Math.min(desired, MIN_SCALE) || level.value >= 3) {
      scale.value = Math.max(0.4, Math.min(desired, room))
      // 告诉外层布局工具栏占了多大，歌词区让出这么多空间
      const size = (isVertical.value ? el.offsetWidth : el.offsetHeight) * scale.value + 8
      document.documentElement.style.setProperty('--lyric-bar-size', `${Math.round(size)}px`)
      return
    }
    level.value++
    await nextTick()
  }
}
const handleResize = () => { void fit() }
watch([isVertical, colorMode, lineMode, offsetLabel, () => setting['desktopLyric.style.fontSize']], () => { void fit() })
onMounted(() => {
  window.addEventListener('resize', handleResize)
  void fit()
})
onBeforeUnmount(() => { window.removeEventListener('resize', handleResize) })
</script>

<style lang="less" module>
.bar {
  display: inline-flex;
  flex-wrap: nowrap;
  white-space: nowrap;
  justify-content: center;
  box-sizing: border-box;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(24, 24, 27, .86);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .08);
  cursor: move;
  transform-origin: 50% 0;
}
// 竖排：工具栏是右侧的一列
.vbar {
  flex-direction: column;
  border-radius: 20px;
  transform-origin: 100% 50%;
  .segment, .offset {
  display: flex;
  align-items: center;
  gap: 0;
}
.offsetValue {
  min-width: 46px;
  padding: 0 4px;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.vbar .offset {
  flex-direction: column;
}
.colorGroup {
    flex-direction: column;
  }
  .divider {
    width: 14px;
    height: 1px;
    margin: 3px 0;
  }
  .chip {
    margin: 4px 0 0;
  }
  .colorLabel {
    margin: 2px 0 4px;
  }
}
.divider {
  flex: none;
  width: 1px;
  height: 14px;
  margin: 0 3px;
  background: rgba(255, 255, 255, .16);
}
// 显示方式：与播放详情页歌词工具栏同样的分段按钮，深色版
.segment {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 15px;
  background: rgba(255, 255, 255, .08);
}
.chip {
  margin-left: 4px;
  background: rgba(255, 255, 255, .08);
  &:disabled {
    opacity: .4;
    cursor: default;
    &:hover {
      color: rgba(255, 255, 255, .6);
    }
  }
}
.seg {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 13px;
  background: none;
  color: rgba(255, 255, 255, .6);
  font-size: 12px;
  line-height: 26px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
  &:hover {
    color: #fff;
  }
}
.segOn {
  color: #fff;
  background: rgba(255, 255, 255, .2);
}
.btn {
  flex: none;
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
.colorGroup {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
}
.colorLabel {
  margin-right: 4px;
  color: rgba(255, 255, 255, .6);
  font-size: 12px;
}
.swatch {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--swatch) content-box;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25);
  cursor: pointer;
  transition: transform .15s ease, border-color .15s ease;
  &:hover {
    transform: scale(1.12);
  }
}
.swatchOn {
  border-color: #fff;
}
// 自定义颜色：彩色圆环里是当前颜色，点开系统取色器
.custom {
  position: relative;
  overflow: hidden;
  background: conic-gradient(#f44, #fd4, #4f6, #4df, #46f, #e4f, #f44);
  &::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--swatch);
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
}
</style>
