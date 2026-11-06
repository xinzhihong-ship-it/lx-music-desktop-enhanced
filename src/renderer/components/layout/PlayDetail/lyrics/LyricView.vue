<template>
  <div :class="['right', $style.right]" :style="fontSizeVar" @contextmenu.stop="handleShowMenu">
    <div :class="$style.toolbar" role="toolbar" :aria-label="$t('lyric_view__toolbar')">
      <div :class="$style.segment" role="radiogroup">
        <button
          v-for="item in viewOptions" :key="item.id" type="button" role="radio"
          :class="[$style.segBtn, { [$style.on]: view == item.id }]" :aria-checked="view == item.id"
          @click="setView(item.id)"
        >{{ item.label }}</button>
      </div>
      <div v-if="view == 'stage'" :class="$style.segment" role="radiogroup">
        <button
          v-for="item in styleOptions" :key="item.id" type="button" role="radio"
          :class="[$style.segBtn, { [$style.on]: stageStyle == item.id }]" :aria-checked="stageStyle == item.id"
          @click="setStageStyle(item.id)"
        >{{ item.label }}</button>
      </div>
      <button v-if="view == 'stage'" type="button" :class="[$style.chip, { [$style.on]: sparks }]" :aria-pressed="sparks" @click="toggleSparks">{{ $t('lyric_view__sparks') }}</button>
      <button type="button" :class="[$style.chip, { [$style.on]: background == 'cover' }]" :aria-pressed="background == 'cover'" @click="toggleBackground">{{ $t('lyric_view__bg_cover') }}</button>
    </div>

    <LyricStage v-if="view == 'stage'" :doc="lyricDoc" :style-name="stageStyle" :sparks="sparks" :accent="accent" @search="isShowSearch = true" />
    <LyricScroll v-else :doc="lyricDoc" @search="isShowSearch = true" />

    <LyricMenu v-model="menuVisible" :xy="menuXY" :lyric-info="lyricInfo" @update-lyric="handleUpdateLyric" @search="isShowSearch = true" />
    <LyricSearchModal v-model:show="isShowSearch" :music-info="playMusicInfo.musicInfo" />
  </div>
</template>

<script setup>
// 播放详情页右侧的歌词区：滚动歌词 / 舞台两种视图，右键菜单（字号、偏移、搜索歌词），搜索面板。
import { computed, nextTick, reactive, ref } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { isFullscreen } from '@renderer/store'
import { isShowPlayComment, musicInfo as playerMusicInfo, playMusicInfo } from '@renderer/store/player/state'
import { setMusicInfo } from '@renderer/store/player/action'
import { setLyricOffset } from '@renderer/core/lyric'
import { lyricDoc } from '@renderer/core/lyrics/engine'
import LyricScroll from './LyricScroll.vue'
import LyricStage from './LyricStage.vue'
import LyricMenu from '../components/LyricMenu.vue'
import LyricSearchModal from '../components/LyricSearchModal.vue'

const props = defineProps({
  /** 封面主色背景下的强调色；跟随主题时用主题色 */
  accent: { type: String, default: '' },
})
const t = useI18n()

const view = computed(() => appSetting['playDetail.lyricView'] ?? 'scroll')
const stageStyle = computed(() => appSetting['playDetail.stageStyle'] ?? 'flow')
const sparks = computed(() => !!appSetting['playDetail.stageSparks'])
const background = computed(() => appSetting['playDetail.background'] ?? 'theme')
const accent = computed(() => props.accent || 'var(--color-primary)')

const viewOptions = computed(() => [
  { id: 'scroll', label: t('lyric_view__scroll') },
  { id: 'stage', label: t('lyric_view__stage') },
])
const styleOptions = computed(() => [
  { id: 'flow', label: t('lyric_view__style_flow') },
  { id: 'steps', label: t('lyric_view__style_steps') },
  { id: 'tilt', label: t('lyric_view__style_tilt') },
])
const setView = id => { if (view.value != id) updateSetting({ 'playDetail.lyricView': id }) }
const setStageStyle = id => { if (stageStyle.value != id) updateSetting({ 'playDetail.stageStyle': id }) }
const toggleSparks = () => { updateSetting({ 'playDetail.stageSparks': !sparks.value }) }
const toggleBackground = () => { updateSetting({ 'playDetail.background': background.value == 'cover' ? 'theme' : 'cover' }) }

const fontSizeVar = computed(() => {
  let size = (appSetting['playDetail.style.fontSize'] ?? 140) / 100
  if (isFullscreen.value) size *= 1.4
  return { '--playDetail-lrc-font-size': `${isShowPlayComment.value ? size * 0.82 : size}rem` }
})

// ---- 右键菜单（沿用原有的字号 / 偏移 / 搜索） ----
const isShowSearch = ref(false)
const menuVisible = ref(false)
const menuXY = reactive({ x: 0, y: 0 })
const lyricInfo = reactive({ lyric: '', tlyric: '', rlyric: '', lxlyric: '', rawlyric: '', musicInfo: null })
const handleShowMenu = event => {
  // 歌词还没加载完时这些字段可能是 null，菜单会对它们做正则匹配
  lyricInfo.lyric = playerMusicInfo.lrc ?? ''
  lyricInfo.tlyric = playerMusicInfo.tlrc ?? ''
  lyricInfo.rlyric = playerMusicInfo.rlrc ?? ''
  lyricInfo.lxlyric = playerMusicInfo.lxlrc ?? ''
  lyricInfo.rawlyric = playerMusicInfo.rawlrc ?? ''
  lyricInfo.musicInfo = playMusicInfo.musicInfo
  menuXY.x = event.pageX
  menuXY.y = event.pageY
  if (menuVisible.value) return
  void nextTick(() => { menuVisible.value = true })
}
const handleUpdateLyric = ({ lyric, tlyric, rlyric, lxlyric, offset }) => {
  setMusicInfo({ lrc: lyric, tlrc: tlyric, rlrc: rlyric, lxlrc: lxlyric })
  setLyricOffset(offset)
}
</script>

<style lang="less" module>
.right {
  // 只收缩不伸展：左栏 40% + 间距 + 60% 会超出（固定 60% 时右侧被裁掉）；打开评论时页面把它压到 30%，不能再撑开
  flex: 0 1 60%;
  position: relative;
  min-width: 0;
  transition: flex-basis .3s ease;
  &:hover .toolbar, .toolbar:focus-within {
    opacity: 1;
  }
}
.toolbar {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  opacity: 0;
  transition: opacity .2s ease;
}
.segment {
  display: flex;
  padding: 2px;
  border-radius: 14px;
  background-color: var(--color-primary-alpha-900);
}
.segBtn, .chip {
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 12px;
  background: none;
  color: var(--color-font-label);
  font-size: 12px;
  cursor: pointer;
  transition: background-color .2s ease, color .2s ease;
  &:hover {
    color: var(--color-font);
  }
  &.on {
    color: var(--color-font);
    background-color: var(--color-primary-alpha-700);
  }
}
.chip {
  background-color: var(--color-primary-alpha-900);
}
</style>
