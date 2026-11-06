<template>
  <span v-for="(word, index) in words" :key="index" :class="$style.word" :style="{ opacity: opacityOf(word) }">{{ word.text }}</span>
</template>

<script setup>
// 当前行的逐字变亮：只有这个组件读取逐帧更新的歌词位置，父组件（整页歌词）不随之重绘
import { inject } from '@common/utils/vueTools'
import { wordProgress } from '@common/utils/lyrics'

defineProps({
  words: { type: Array, required: true },
})
const position = inject('lyricPosition')
const opacityOf = word => 0.38 + 0.62 * wordProgress(word, position.value)
</script>

<style lang="less" module>
.word {
  white-space: pre-wrap;
}
</style>
