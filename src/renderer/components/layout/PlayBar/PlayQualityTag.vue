<template>
  <span v-if="label" :class="$style.qualityTag">{{ label }}</span>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { playQuality, musicInfo } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import { useI18n } from '@renderer/plugins/i18n'

export default {
  setup() {
    const t = useI18n()
    const label = computed(() => {
      if (!musicInfo.id) return ''
      const engineMap = {
        mpv: 'MPV',
        audirvana: 'Audirvana',
        electron: '内置',
      }
      const engine = engineMap[appSetting['player.playEngine']] ?? '内置'
      const quality = playQuality.value
      if (!quality) return engine
      if (quality === 'unknown') return `${t('player__quality_unknown')} · ${engine}`
      const qualityLabels = {
        ape: 'APE',
        wav: 'WAV',
      }
      const qualityKey = `setting__play_quality_${quality}`
      const translated = t(qualityKey)
      const qualityLabel = translated === qualityKey ? qualityLabels[quality] ?? quality : translated
      return `${qualityLabel} · ${engine}`
    })
    return { label }
  },
}
</script>

<style lang="less" module>
.qualityTag {
  flex: none;
  margin-left: 8px;
  padding: 0 5px;
  height: 16px;
  line-height: 16px;
  border-radius: 3px;
  font-size: 10px;
  color: var(--color-primary);
  background-color: var(--color-primary-light-900-alpha-200);
  white-space: nowrap;
}
</style>
