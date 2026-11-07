<template lang="pug">
dt#play_detail {{ $t('setting__lyric_display') }}
dd
  h3#lyric_content {{ $t('setting__lyric_content') }}
  div
    .gap-top
      span(style="margin-right: 10px; color: var(--color-font-label)") {{ $t('setting__lyric_highlight') }}
      base-checkbox.gap-left(id="setting_lyric_highlight_word" :model-value="appSetting['player.lyricHighlight']" need value="word" :label="$t('setting__lyric_highlight_word')" @update:model-value="updateSetting({ 'player.lyricHighlight': $event })")
      base-checkbox.gap-left(id="setting_lyric_highlight_line" :model-value="appSetting['player.lyricHighlight']" need value="line" :label="$t('setting__lyric_highlight_line')" @update:model-value="updateSetting({ 'player.lyricHighlight': $event })")
    .gap-top
      base-checkbox(id="setting_player_lyric_transition" :model-value="appSetting['player.isShowLyricTranslation']" :label="$t('setting__play_lyric_transition')" @update:model-value="updateSetting({'player.isShowLyricTranslation': $event})")
    .gap-top
      base-checkbox(id="setting_player_lyric_roma" :model-value="appSetting['player.isShowLyricRoma']" :label="$t('setting__play_lyric_roma')" @update:model-value="updateSetting({'player.isShowLyricRoma': $event})")
    .gap-top
      base-checkbox(id="setting_player_awap_lyric_trans_roma" :model-value="appSetting['player.isSwapLyricTranslationAndRoma']" :label="$t('setting__player_swap_lyric_trans_roma')" @update:model-value="updateSetting({'player.isSwapLyricTranslationAndRoma': $event})")
    .gap-top
      base-checkbox(id="setting_player_lyric_s2t" :model-value="appSetting['player.isS2t']" :label="$t('setting__play_lyric_s2t')" @update:model-value="updateSetting({'player.isS2t': $event})")
    .gap-top(v-if="isMac")
      base-checkbox(id="setting_player_showStatusBarLyric" :model-value="appSetting['player.isShowStatusBarLyric']" :label="$t('setting__play_statusbar_lyric')" @update:model-value="updateSetting({'player.isShowStatusBarLyric': $event})")
      svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_statusbar_lyric_tip')" :title="$t('setting__play_statusbar_lyric_tip')")

dd
  h3#lyric_view_mode {{ $t('setting__lyric_view_mode') }}
  div
    base-checkbox.gap-left(
      v-for="item in modeList" :id="'setting_lyric_view_mode_' + item.id" :key="item.id" :model-value="mode" name="setting_lyric_view_mode"
      need :label="item.label" :value="item.id" @update:model-value="setMode")
  div(style="margin-top: 10px")
    .gap-top
      base-checkbox(id="setting_lyric_stage_sparks" :model-value="!!appSetting['playDetail.stageSparks']" :label="$t('setting__lyric_stage_sparks')" @update:model-value="updateSetting({'playDetail.stageSparks': $event})")
    .gap-top
      base-checkbox(id="setting_lyric_bg_cover" :model-value="appSetting['playDetail.background'] == 'cover'" :label="$t('setting__lyric_bg_cover')" @update:model-value="updateSetting({'playDetail.background': $event ? 'cover' : 'theme'})")

dd
  h3#play_detail_align {{ $t('setting__play_detail_align') }}
  div
    base-checkbox.gap-left(id="setting_play_detail_align_left" :model-value="appSetting['playDetail.style.align']" need value="left" :label="$t('setting__play_detail_align_left')" @update:model-value="updateSetting({ 'playDetail.style.align': $event })")
    base-checkbox.gap-left(id="setting_play_detail_align_center" :model-value="appSetting['playDetail.style.align']" need value="center" :label="$t('setting__play_detail_align_center')" @update:model-value="updateSetting({ 'playDetail.style.align': $event })")
    base-checkbox.gap-left(id="setting_play_detail_align_right" :model-value="appSetting['playDetail.style.align']" need value="right" :label="$t('setting__play_detail_align_right')" @update:model-value="updateSetting({ 'playDetail.style.align': $event })")

</template>

<script>
// 歌词显示：歌词内容（翻译 / 罗马音 / 繁体 / 状态栏）、播放详情页的显示方式与效果、对齐
import { computed } from '@common/utils/vueTools'
import { isMac } from '@common/utils'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { useI18n } from '@renderer/plugins/i18n'

export default {
  name: 'SettingPlayDetail',
  setup() {
    const t = useI18n()
    // 与歌词区工具栏一致：滚动 + 三种舞台风格合成一组
    const mode = computed(() => appSetting['playDetail.lyricView'] == 'stage' ? (appSetting['playDetail.stageStyle'] ?? 'flow') : 'scroll')
    const modeList = computed(() => [
      { id: 'scroll', label: t('lyric_view__scroll') },
      { id: 'flow', label: t('lyric_view__style_flow') },
      { id: 'steps', label: t('lyric_view__style_steps') },
      { id: 'tilt', label: t('lyric_view__style_tilt') },
    ])
    const setMode = id => {
      if (id == 'scroll') updateSetting({ 'playDetail.lyricView': 'scroll' })
      else updateSetting({ 'playDetail.lyricView': 'stage', 'playDetail.stageStyle': id })
    }

    return {
      appSetting,
      updateSetting,
      isMac,
      mode,
      modeList,
      setMode,
    }
  },
}
</script>
