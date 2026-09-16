<template>
  <span v-if="label" :class="$style.qualityTag" :aria-label="tip || null">{{ label }}</span>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { playQuality, playQualityActual, musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import { useI18n } from '@renderer/plugins/i18n'
import { platformQualityBySoftware } from '@common/quality/platformQualitys'
import { qualityShortLabel, qualityFullLabel } from '@renderer/core/quality/labels'

export default {
  setup() {
    const t = useI18n()

    // 当前正在播放的档位：优先探测到的实际档位，未探测到或证据不足时沿用请求档位。
    const currentQuality = computed(() => playQualityActual.value || playQuality.value)

    // 正在播放的歌曲来源平台。musicInfo（播放栏状态）里没有 source，要从播放歌曲本身取。
    const currentSource = computed(() => playMusicInfo.musicInfo?.source ?? null)

    // 平台自己的档位名。同一个软件档位在不同平台叫法不同（同为 24bit 无损，酷狗叫
    // Hi-Res、网易叫高清臻音），所以这里按当前播放平台反查，而不是显示软件档位名。
    const platformEntries = computed(() => {
      const quality = currentQuality.value
      const source = currentSource.value
      if (!quality || quality === 'unknown' || !source) return []
      return platformQualityBySoftware(source, quality)
    })

    const label = computed(() => {
      if (!musicInfo.id) return ''
      const engineMap = {
        mpv: 'MPV',
        audirvana: 'Audirvana',
        electron: '内置',
      }
      const engine = engineMap[appSetting['player.playEngine']] ?? '内置'
      const quality = currentQuality.value
      if (!quality) return engine
      if (quality === 'unknown') return `${t('player__quality_unknown')} · ${engine}`
      const short = qualityShortLabel(t, quality)
      const entries = platformEntries.value
      // 一个软件档位在该平台只对应一个档位时，显示「平台档位名 (软件短标签)」；
      // 对应多个时（网易的 hires 同时是 Hi-Res 与高清臻音）只显示软件短标签，
      // 完整候选放到悬停提示里，避免标签过长。
      const qualityLabel = entries.length === 1 ? `${t(entries[0].nameKey)} (${short})` : short
      return `${qualityLabel} · ${engine}`
    })

    // 悬停说明：说清这个档位在当前平台叫什么、在软件里是哪个档位。
    const tip = computed(() => {
      const quality = currentQuality.value
      if (!quality || quality === 'unknown') return ''
      const lines = []
      const entries = platformEntries.value
      if (entries.length) {
        const sourceName = t(`source_${currentSource.value}`)
        lines.push(`${sourceName}：${entries.map(entry => t(entry.nameKey)).join(' / ')}`)
        const notes = entries.map(entry => entry.noteKey).filter(Boolean)
        for (const noteKey of notes) lines.push(t(noteKey))
      }
      const short = qualityShortLabel(t, quality)
      const full = qualityFullLabel(t, quality)
      lines.push(short === full ? full : `${short}（${full}）`)
      return lines.join('\n')
    })

    return { label, tip }
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
