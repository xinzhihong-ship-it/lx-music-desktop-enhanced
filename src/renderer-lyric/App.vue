<template>
  <div id="container" :class="[{ lock: setting['desktopLyric.isLock'] }, { hide: isHide || isHoverHide }]">
    <div id="main">
      <div class="lyric-area">
        <layout-karaoke-lyric />
      </div>
      <div v-if="!setting['desktopLyric.isLock']" class="control-bar">
        <layout-control-bar />
      </div>
      <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut">
        <common-audio-visualizer v-if="setting['desktopLyric.audioVisualization']" />
      </transition>
    </div>
    <template v-if="isShowResize">
      <div class="resize resize-left" @mousedown.self="handleMouseDown('left', $event)" @touchstart.self="handleTouchDown('left', $event)" />
      <div class="resize resize-top" @mousedown.self="handleMouseDown('top', $event)" @touchstart.self="handleTouchDown('top', $event)" />
      <div class="resize resize-right" @mousedown.self="handleMouseDown('right', $event)" @touchstart.self="handleTouchDown('right', $event)" />
      <div class="resize resize-bottom" @mousedown.self="handleMouseDown('bottom', $event)" @touchstart.self="handleTouchDown('bottom', $event)" />
      <div class="resize resize-top-left" @mousedown.self="handleMouseDown('top-left', $event)" @touchstart.self="handleTouchDown('top-left', $event)" />
      <div class="resize resize-top-right" @mousedown.self="handleMouseDown('top-right', $event)" @touchstart.self="handleTouchDown('top-right', $event)" />
      <div class="resize resize-bottom-left" @mousedown.self="handleMouseDown('bottom-left', $event)" @touchstart.self="handleTouchDown('bottom-left', $event)" />
      <div class="resize resize-bottom-right" @mousedown.self="handleMouseDown('bottom-right', $event)" @touchstart.self="handleTouchDown('bottom-right', $event)" />
    </template>
    <layout-icons />
  </div>
</template>

<script setup>
import useWindowSize from '@lyric/useApp/useWindowSize'
import useHoverHide from '@lyric/useApp/useHoverHide'
import { onMounted } from '@common/utils/vueTools'
import { setting } from '@lyric/store/state'
import { sendConnectMainWindowEvent } from '@lyric/utils/ipc'
import useCommon from '@lyric/useApp/useCommon'
import useLyric from '@lyric/useApp/useLyric'
import useTheme from '@lyric/useApp/useTheme'
import { init as initLyricPlayer } from '@lyric/core/lyric'
import usePauseHide from '@lyric/useApp/usePauseHide'

const isShowResize = window.os != 'windows'
useCommon()
const { handleMouseDown, handleTouchDown } = useWindowSize()
const isHoverHide = useHoverHide()
useLyric()
useTheme()
const isHide = usePauseHide()


onMounted(() => {
  initLyricPlayer()
  sendConnectMainWindowEvent()
})

</script>

<style lang="less">
@import './assets/styles/index.less';
@import './assets/styles/layout.less';

body {
  user-select: none;
  height: 100vh;
  box-sizing: border-box;
}
#root {
  height: 100%;
}

#container {
  box-sizing: border-box;
  height: 100%;
  transition: opacity .3s ease;
  opacity: 1;
  &.hide {
    opacity: .05;

    &:not(.lock):hover {
      opacity: 1;
    }
  }
}

@resize-width: 6px;
.resize {
  z-index: 2;
}
.resize-left {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: @resize-width;
  cursor: ew-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-right {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  width: @resize-width;
  cursor: ew-resize;
}
.resize-top {
  position: absolute;
  left: 0;
  top: 0;
  height: 4px;
  width: 100%;
  cursor: ns-resize;
}
.resize-bottom {
  position: absolute;
  left: 0;
  bottom: 0;
  height: @resize-width;
  width: 100%;
  cursor: ns-resize;
}
.resize-top-left {
  position: absolute;
  left: 0;
  top: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nwse-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-top-right {
  position: absolute;
  right: 0;
  top: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nesw-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-bottom-left {
  position: absolute;
  left: 0;
  bottom: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nesw-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-bottom-right {
  position: absolute;
  right: 0;
  bottom: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nwse-resize;
  // background-color: rgba(0, 0, 0, 1);
}

// 平时完全透明，只显示歌词；鼠标移入（未锁定）时出现一层深色圆角底板和顶部的工具栏
#main {
  position: relative;
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  border-radius: 16px;
  overflow: hidden;
  background-color: transparent;
  transition: background-color .25s ease, box-shadow .25s ease;

  &:hover {
    background-color: rgba(16, 16, 18, .42);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08);
    .control-bar {
      opacity: 1;
      transform: translate(-50%, 0);
      pointer-events: auto;
    }
  }
}
#container.lock #main:hover {
  background-color: transparent;
  box-shadow: none;
}

// 工具栏出现时歌词整体下移，不被工具栏挡住
.lyric-area {
  position: absolute;
  inset: 0;
  transition: top .2s ease;
}
#container:not(.lock) #main:hover .lyric-area {
  top: 46px;
}

.control-bar {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 1;
  opacity: 0;
  transform: translate(-50%, -6px);
  pointer-events: none;
  transition: opacity .2s ease, transform .2s ease;
}
</style>
