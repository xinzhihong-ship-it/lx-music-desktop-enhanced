<template>
  <div :class="$style.root" aria-hidden="true">
    <transition enter-active-class="animated-slow fadeIn" leave-active-class="animated-slow fadeOut">
      <div :key="layerKey" :class="$style.layer" :style="{ backgroundImage: `linear-gradient(180deg, ${palette.top}, ${palette.bottom})` }">
        <img v-if="pic" :src="pic" :class="$style.cover" alt="">
      </div>
    </transition>
    <div :class="$style.shade" />
  </div>
</template>

<script setup>
// 播放详情页的封面主色背景：主色的深色渐变（上浅下深）+ 很淡的模糊封面，底部再压暗一点给播放栏。
// 每张封面只取色一次（缓存）；跨域图片无法读取像素时退回灰色，模糊封面照常显示。
import { ref, watch } from '@common/utils/vueTools'
import { backdropPalette, dominantColor } from '@common/utils/lyrics'

const props = defineProps({
  pic: { type: String, default: '' },
})
const emit = defineEmits(['palette'])

const SAMPLE_SIZE = 24
const FALLBACK = { r: 120, g: 120, b: 130 }
const cache = new Map()

const palette = ref(backdropPalette(FALLBACK))
const layerKey = ref('')

const sampleTint = async url => {
  if (!url) return FALLBACK
  if (cache.has(url)) return cache.get(url)
  const tint = await new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE_SIZE
        canvas.height = SAMPLE_SIZE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        resolve(dominantColor(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data))
      } catch {
        resolve(FALLBACK) // 跨域图片：画布被污染，读不了像素
      }
    }
    img.onerror = () => { resolve(FALLBACK) }
    img.src = url
  })
  if (cache.size > 50) cache.clear()
  cache.set(url, tint)
  return tint
}

let requestId = 0
watch(() => props.pic, async pic => {
  const id = ++requestId
  const tint = await sampleTint(pic)
  if (id != requestId) return
  palette.value = backdropPalette(tint)
  layerKey.value = pic || 'none'
  emit('palette', palette.value)
}, { immediate: true })
</script>

<style lang="less" module>
.root {
  position: absolute;
  inset: 0;
  // 与原背景一致：在容器的层叠上下文里垫在所有内容之下
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  background-color: #111;
}
.layer {
  position: absolute;
  inset: 0;
}
.cover {
  position: absolute;
  inset: -10%;
  width: 120%;
  height: 120%;
  object-fit: cover;
  filter: blur(60px) saturate(1.2);
  opacity: .14;
}
.shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, .18) 100%);
}
</style>
