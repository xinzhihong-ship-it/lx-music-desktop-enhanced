<template>
  <div ref="stage" :class="[$style.stage, { [$style.videoOnlyFullscreen]: props.fullscreen }]" @dblclick.stop.prevent="emit('toggle-fullscreen')" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import { isFullscreen } from '@renderer/store'
import * as mpvVideoPlayer from '@renderer/plugins/player/mpvVideo'

const props = defineProps({ fullscreen: Boolean })
const emit = defineEmits(['toggle-fullscreen'])
const stage = ref(null)
let observer = null
let removeDoubleClick = null

const syncBounds = () => {
  if (!stage.value) return
  const rect = stage.value.getBoundingClientRect()
  void mpvVideoPlayer.setBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  }).catch(() => {})
}

onMounted(() => {
  removeDoubleClick = mpvVideoPlayer.onDoubleClick(() => { emit('toggle-fullscreen') })
  void mpvVideoPlayer.init().then(async() => {
    await mpvVideoPlayer.setVisible(true)
  }).catch(err => {
    console.error('mpv video init failed', err)
  })
  observer = new ResizeObserver(syncBounds)
  observer.observe(stage.value)
  window.addEventListener('resize', syncBounds)
  syncBounds()
})

watch(isFullscreen, () => {
  setTimeout(syncBounds)
})

onBeforeUnmount(() => {
  removeDoubleClick?.()
  removeDoubleClick = null
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', syncBounds)
  void mpvVideoPlayer.setVisible(false).catch(() => {})
})
</script>

<style lang="less" module>
.stage {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #000;
  z-index: 1;
}
.videoOnlyFullscreen {
  position: absolute;
  inset: 0 0 100px;
}
</style>
