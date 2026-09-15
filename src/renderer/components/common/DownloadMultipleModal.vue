<template>
  <material-modal :show="show" :bg-close="bgClose" :teleport="teleport" @close="handleClose">
    <main :class="$style.main">
      <h2>{{ $t('download__multiple_tip', { len: list.length }) }}<br>{{ $t('download__multiple_tip2') }}</h2>
      <base-btn :class="$style.btn" @click="handleClick('128k')">{{ $t('setting__play_quality_128k') }} · {{ getDownloadFormat('128k') }}</base-btn>
      <base-btn :class="$style.btn" @click="handleClick('320k')">{{ $t('setting__play_quality_320k') }} · {{ getDownloadFormat('320k') }}</base-btn>
      <base-btn :class="$style.btn" @click="handleClick('flac')">{{ $t('setting__play_quality_flac') }} · {{ getDownloadFormat('flac') }}</base-btn>
      <base-btn :class="$style.btn" @click="handleClick('hires')">{{ $t('setting__play_quality_hires') }} · {{ getDownloadFormat('hires') }}</base-btn>
      <base-btn :class="$style.btn" @click="handleClick('atmos')">{{ $t('setting__play_quality_atmos') }} · {{ getDownloadFormat('atmos') }}</base-btn>
      <base-btn :class="$style.btn" @click="handleClick('atmos_plus')">{{ $t('setting__play_quality_atmos_plus') }} · {{ getDownloadFormat('atmos_plus') }}</base-btn>
      <base-btn :class="$style.btn" @click="handleClick('master')">{{ $t('setting__play_quality_master') }} · {{ getDownloadFormat('master') }}</base-btn>
    </main>
  </material-modal>
</template>

<script>
import { createDownloadTasks } from '@renderer/store/download/action'
import { getExt } from '@renderer/worker/download/utils'

export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    bgClose: {
      type: Boolean,
      default: true,
    },
    listId: {
      type: String,
      default: '',
    },
    list: {
      type: Array,
      default() {
        return []
      },
    },
    teleport: {
      type: String,
      default: '#root',
    },
  },
  emits: ['update:show', 'confirm'],
  methods: {
    handleClick(quality) {
      void createDownloadTasks(this.list.filter(item => item.source != 'local'), quality, this.listId)
      this.handleClose()
      this.$emit('confirm')
    },
    handleClose() {
      this.$emit('update:show', false)
    },
    getDownloadFormat(quality) {
      return getExt(quality).toUpperCase()
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px;
  max-width: 400px;
  min-width: 200px;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  max-height: 70vh;
  overflow-y: auto;
  h2 {
    font-size: 13px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
    margin-bottom: 15px;
  }
}

.btn {
  display: block;
  margin-bottom: 15px;
  &:last-child {
    margin-bottom: 0;
  }
}

</style>
