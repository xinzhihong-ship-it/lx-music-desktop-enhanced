<template lang="pug">
dt#play {{ $t('setting__play') }}
dd
  div(:class="$style.engineSection")
    h3#basic_play_engine {{ $t('setting__play_engine') }}
    base-selection(v-model="playEngine" :class="$style.engineSelect" :list="playEngineList" item-key="id" item-name="label" @change="handlePlayEngineChange")
    p(:class="$style.engineDesc")
      span(v-if="playEngine == 'mpv'") {{ $t('setting__play_engine_mpv_desc') }}
      span(v-else-if="playEngine == 'audirvana'") {{ $t('setting__play_engine_audirvana_desc') }}
      span(v-else) {{ $t('setting__play_engine_electron_desc') }}
//- mpv 专属设置
dd(v-if="playEngine == 'mpv'")
  div(:class="$style.mpvSettings")
    div(:class="$style.formItem")
      h3#basic_mpv_path(:class="$style.formLabel") {{ $t('setting__play_mpv_path') }}
      base-input(v-model="mpvPath" :class="$style.formInput" :placeholder="$t('setting__play_mpv_path_placeholder')" @update:model-value="updateSetting({'player.mpv.path': $event})")
      p(:class="$style.formDesc") {{ $t('setting__play_mpv_path_order') }}
    div(:class="$style.formItem")
      h3#basic_mpv_extra_args(:class="$style.formLabel") {{ $t('setting__play_mpv_extra_args') }}
      base-input(v-model="mpvExtraArgs" :class="$style.formInput" :placeholder="$t('setting__play_mpv_extra_args_placeholder')" @update:model-value="handleMpvExtraArgsChange")
      p(:class="$style.formDesc") {{ $t('setting__play_mpv_extra_args_desc') }}
//- Audirvana 专属提示
dd(v-if="playEngine == 'audirvana'")
  p(:class="$style.audirvanaTip") {{ $t('setting__play_playEngine_audirvana_tip') }}

dd
  .gap-top(v-if="playEngine == 'mpv'")
    base-checkbox(id="setting_mpv_bit_perfect" :model-value="appSetting['player.mpv.bitPerfectMode']" :label="$t('setting__play_mpv_bit_perfect')" @update:model-value="handleMpvBitPerfectChange")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_mpv_bit_perfect_tip')")
  .gap-top
    base-checkbox(id="setting_player_startup_auto_play" :model-value="appSetting['player.startupAutoPlay']" :label="$t('setting__play_startup_auto_play')" @update:model-value="updateSetting({'player.startupAutoPlay': $event})")
  .gap-top
    base-checkbox(id="setting_player_power_save_blocker" :model-value="appSetting['player.powerSaveBlocker']" :label="$t('setting__play_power_save_blocker')" @update:model-value="handleUpdatePowerSaveBlocker")
  .gap-top
    base-checkbox(id="setting_player_save_play_time" :model-value="appSetting['player.isSavePlayTime']" :label="$t('setting__play_save_play_time')" @update:model-value="updateSetting({'player.isSavePlayTime': $event})")
  .gap-top
    base-checkbox(id="setting_player_auto_clean_played_list" :model-value="appSetting['player.isAutoCleanPlayedList']" :label="$t('setting__play_auto_clean_played_list')" @update:model-value="updateSetting({'player.isAutoCleanPlayedList': $event})")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_auto_clean_played_list_tip')")
  .gap-top
    base-checkbox(id="setting_player_lyric_transition" :model-value="appSetting['player.isShowLyricTranslation']" :label="$t('setting__play_lyric_transition')" @update:model-value="updateSetting({'player.isShowLyricTranslation': $event})")
  .gap-top
    base-checkbox(id="setting_player_lyric_roma" :model-value="appSetting['player.isShowLyricRoma']" :label="$t('setting__play_lyric_roma')" @update:model-value="updateSetting({'player.isShowLyricRoma': $event})")
  .gap-top
    base-checkbox(id="setting_player_awap_lyric_trans_roma" :model-value="appSetting['player.isSwapLyricTranslationAndRoma']" :label="$t('setting__player_swap_lyric_trans_roma')" @update:model-value="updateSetting({'player.isSwapLyricTranslationAndRoma': $event})")
  .gap-top
    base-checkbox(id="setting_player_auto_skip_on_error" :model-value="appSetting['player.autoSkipOnError']" :label="$t('setting__play_auto_skip_on_error')" @update:model-value="updateSetting({'player.autoSkipOnError': $event})")
  .gap-top
    base-checkbox(id="setting_player_lyric_s2t" :model-value="appSetting['player.isS2t']" :label="$t('setting__play_lyric_s2t')" @update:model-value="updateSetting({'player.isS2t': $event})")
  .gap-top
    base-checkbox(id="setting_player_lyric_play_lxlrc" :model-value="appSetting['player.isPlayLxlrc']" :label="$t('setting__play_lyric_lxlrc')" @update:model-value="updateSetting({'player.isPlayLxlrc': $event})")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_lyric_lxlrc_tip')")
  .gap-top
    base-checkbox(id="setting_player_showTaskProgess" :model-value="appSetting['player.isShowTaskProgess']" :label="$t('setting__play_task_bar')" @update:model-value="updateSetting({'player.isShowTaskProgess': $event})")
  .gap-top(v-if="isMac")
    base-checkbox(id="setting_player_showStatusBarLyric" :model-value="appSetting['player.isShowStatusBarLyric']" :label="$t('setting__play_statusbar_lyric')" @update:model-value="updateSetting({'player.isShowStatusBarLyric': $event})")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_statusbar_lyric_tip')")
  .gap-top
    base-checkbox(id="setting_player_isMaxOutputChannelCount" :model-value="isMaxOutputChannelCount" :label="$t('setting__play_max_output_channel_count')" @update:model-value="handleUpdateMaxOutputChannelCount")
  .gap-top
    base-checkbox(id="setting_player_isMediaDeviceRemovedStopPlay" :model-value="appSetting['player.isMediaDeviceRemovedStopPlay']" :label="$t('setting__play_mediaDevice_remove_stop_play')" @update:model-value="updateSetting({'player.isMediaDeviceRemovedStopPlay': $event})")

dd
  h3#basic_play_quality {{ $t('setting__play_playQuality') }}
  div
    base-checkbox.gap-left(
      v-for="item in playQualityList" :id="`setting_play_quality_${item}`" :key="item"
      name="setting_play_quality" need :model-value="appSetting['player.playQuality']" :value="item" :label="item"
      @update:model-value="updateSetting({'player.playQuality': $event})")

dd(:aria-label="$t('setting__play_mediaDevice_title')")
  h3#play_mediaDevice {{ $t('setting__play_mediaDevice') }}
  div
    template(v-if="playEngine == 'mpv'")
      // MPV 模式下 base-selection 下拉框有渲染问题，先用原生 select 保证功能可用
      select(v-model="mediaDeviceId" :class="$style.mpvDeviceSelect" @change="handleMediaDeviceIdChnage")
        option(v-for="item in mediaDevices" :key="item.deviceId" :value="item.deviceId") {{ item.label }}
    template(v-else-if="playEngine == 'audirvana'")
      p(:class="$style.audirvanaDeviceTip") {{ $t('setting__play_audirvana_device_tip') }}
    template(v-else)
      base-selection.gap-left(v-model="mediaDeviceId" :list="mediaDevices" item-key="deviceId" item-name="label" @change="handleMediaDeviceIdChnage")
</template>

<script>
import { ref, onBeforeUnmount, onMounted, watch, computed } from '@common/utils/vueTools'
import { hasInitedAdvancedAudioFeatures, setMediaDeviceId } from '@renderer/plugins/player'
import * as mpvPlayer from '@renderer/plugins/player/mpv'
import { dialog } from '@renderer/plugins/Dialog'
import showTip from '@renderer/plugins/Tips/Tips'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, saveMediaDeviceId, updateSetting } from '@renderer/store/setting'
import { restartApp } from '@renderer/utils/ipc'
import { setPowerSaveBlocker } from '@renderer/core/player/utils'
import { isPlay, playMusicInfo } from '@renderer/store/player/state'
import { TRY_QUALITYS_LIST } from '@renderer/core/music/utils'
import { isMac, log } from '@common/utils'


export default {
  name: 'SettingPlay',
  setup() {
    const t = useI18n()
    const playQualityList = [...TRY_QUALITYS_LIST, '128k'].reverse()

    // Audirvana 仅 macOS 可用（主进程在非 mac 平台直接 reject），其他平台不展示该选项
    const playEngineList = [
      { id: 'electron', label: t('setting__play_engine_electron') },
      { id: 'mpv', label: t('setting__play_engine_mpv') },
      ...(isMac ? [{ id: 'audirvana', label: t('setting__play_engine_audirvana') }] : []),
    ]
    const playEngine = ref(appSetting['player.playEngine'])
    const handlePlayEngineChange = async() => {
      const newEngine = playEngine.value
      const oldEngine = appSetting['player.playEngine']
      if (newEngine == oldEngine) return

      if (isPlay.value) {
        const confirm = await dialog.confirm({
          message: t('setting__play_engine_tip'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        })
        if (!confirm) {
          playEngine.value = oldEngine
          return
        }
        window.app_event.stop()
      }

      updateSetting({ 'player.playEngine': newEngine })

      // 切换到 Audirvana 需要重启应用，避免 renderer 状态混乱
      if (newEngine == 'audirvana') {
        restartApp()
        return
      }

      // 切换到 electron 时强制刷新音频 URL，避免 gettingUrlId 缓存导致 play() 跳过获取
      if (newEngine == 'electron' && playMusicInfo.musicInfo) {
        import('@renderer/core/player/action').then(m => {
          m.setMusicUrl(playMusicInfo.musicInfo, true)
        }).catch(() => {})
      }
    }
    watch(() => appSetting['player.playEngine'], val => {
      playEngine.value = val
    })

    const mpvPath = ref(appSetting['player.mpv.path'])
    watch(() => appSetting['player.mpv.path'], val => { mpvPath.value = val })

    // --audio-device 由程序统一通过 player.mediaDeviceId 管理，不再出现在 extraArgs 里。
    // 支持用双引号包裹带空格的参数值，并清理旧配置里被错误拆分的 --audio-device 值。
    const splitExtraArgs = (str) => {
      const args = []
      const regex = /[^\s"]+|"([^"]*)"/g
      let match
      while ((match = regex.exec(str)) != null) {
        args.push(match[1] ?? match[0])
      }
      return args.filter(Boolean)
    }
    const filterAudioDeviceArg = (args) => {
      const result = []
      let skipValue = false
      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (skipValue) {
          if (a.startsWith('--')) {
            skipValue = false
          } else {
            continue
          }
        }
        if (a.startsWith('--audio-device=')) {
          // 旧配置里带空格的 device id 可能被拆成多个 token，一并跳过后续非选项 token
          skipValue = true
          continue
        }
        if (a === '--audio-device') {
          skipValue = true
          continue
        }
        result.push(a)
      }
      return result
    }
    const cleanExtraArgs = (str) => filterAudioDeviceArg(splitExtraArgs(str))
    const mpvExtraArgs = ref(cleanExtraArgs(appSetting['player.mpv.extraArgs'].join(' ')).join(' '))
    const handleMpvExtraArgsChange = (val) => {
      const cleaned = cleanExtraArgs(val)
      mpvExtraArgs.value = cleaned.join(' ')
      updateSetting({ 'player.mpv.extraArgs': cleaned })
      void restartMpvForSettingChange()
    }
    watch(() => appSetting['player.mpv.extraArgs'], val => {
      mpvExtraArgs.value = cleanExtraArgs(val.join(' ')).join(' ')
    })

    // 切换影响 MPV 启动参数的设置时，后台重建 mpv 进程并恢复播放状态。
    const restartMpvForSettingChange = async() => {
      if (!isMpvEngine()) return
      try {
        await mpvPlayer.restart(isPlay.value)
      } catch (err) {
        console.error('[SettingPlay] restart failed:', err)
        showTip({
          message: 'MPV 重建失败：' + (err?.message ?? err),
          position: { top: 80, left: window.innerWidth / 2 },
          autoCloseTime: 3000,
        }, { beforeClose: () => {} })
      }
    }
    const handleMpvBitPerfectChange = (val) => {
      updateSetting({ 'player.mpv.bitPerfectMode': val })
      void restartMpvForSettingChange()
    }
    const mediaDevices = ref([])
    const getMediaDevice = async() => {
      const devices = await navigator.mediaDevices.enumerateDevices()
      let audioDevices = devices.filter(device => device.kind === 'audiooutput')
      mediaDevices.value = audioDevices
    }
    void getMediaDevice()

    navigator.mediaDevices.addEventListener('devicechange', getMediaDevice)
    onBeforeUnmount(() => {
      navigator.mediaDevices.removeEventListener('devicechange', getMediaDevice)
    })

    const mediaDeviceId = ref(appSetting['player.mediaDeviceId'])
    const isMpvEngine = () => appSetting['player.playEngine'] == 'mpv'

    // mpv 设备列表（从 main process 获取）
    const mpvAudioDevices = ref([])
    const loadMpvAudioDevices = async() => {
      try {
        log.info('[SettingPlay] loading mpv audio devices...')
        const devices = await mpvPlayer.listAudioDevices()
        log.info('[SettingPlay] mpv audio devices:', devices)
        mpvAudioDevices.value = devices
        // 如果当前保存的 ID 不在 MPV 设备列表里（比如旧配置残留），重置为默认
        const ids = devices.map(d => d.id)
        if (!ids.includes(mediaDeviceId.value)) {
          mediaDeviceId.value = 'default'
          updateSetting({ 'player.mediaDeviceId': 'default' })
        }
      } catch (err) {
        log.error('[SettingPlay] load mpv audio devices failed:', err)
      }
    }

    // 当前引擎对应的设备列表：MPV 模式用 mpv 自己的设备 ID，内置模式用 Web Audio 设备
    const currentMediaDevices = computed(() => {
      if (isMpvEngine()) {
        // 保持 player.mediaDeviceId='default' 在下拉框中有对应项，避免切到 MPV 后显示为空
        const list = [{ deviceId: 'default', label: t('setting__play_mediaDevice_default') ?? '默认设备' }]
        for (const d of mpvAudioDevices.value) {
          if (d.id !== 'auto') list.push({ deviceId: d.id, label: d.name })
        }
        return list
      }
      return mediaDevices.value
    })

    // 引擎切换时加载对应设备列表；切换到 MPV 时若当前 ID 不在 MPV 列表则重置为默认
    watch(() => appSetting['player.playEngine'], async(val, oldVal) => {
      if (val == 'mpv') {
        await loadMpvAudioDevices()
        const ids = mpvAudioDevices.value.map(d => d.id)
        if (!ids.includes(mediaDeviceId.value)) {
          mediaDeviceId.value = 'default'
          updateSetting({ 'player.mediaDeviceId': 'default' })
        }
      }
    })
    // 设置页打开时若已是 MPV 模式，主动加载一次设备列表
    if (isMpvEngine()) void loadMpvAudioDevices()
    // 有时设置项在组件 setup 之后才合并完成，再兜底一次
    onMounted(() => {
      if (isMpvEngine()) void loadMpvAudioDevices()
      // 清理旧配置里被错误拆分的 --audio-device 参数
      const cleaned = cleanExtraArgs(appSetting['player.mpv.extraArgs'].join(' '))
      if (cleaned.length !== appSetting['player.mpv.extraArgs'].length) {
        updateSetting({ 'player.mpv.extraArgs': cleaned })
      }
    })

    const handleMediaDeviceIdChnage = async() => {
      // mpv 模式：直接保存 mpv 设备 ID，由主进程在启动 mpv 时拼接 --audio-device，不再污染 extraArgs
      if (isMpvEngine()) {
        log.info('[SettingPlay] mediaDeviceId changed to:', mediaDeviceId.value, 'isPlay:', isPlay.value)
        updateSetting({ 'player.mediaDeviceId': mediaDeviceId.value })
        // 正在播放时才需要 restart 让新设备立即生效；未播放时只需保存，下次播放自动用新设备
        if (isPlay.value) {
          void mpvPlayer.restart(true).catch(err => {
            log.error('[SettingPlay] mpv restart failed:', err)
          })
        }
        return
      }
      // Electron 模式：走原有逻辑
      if (hasInitedAdvancedAudioFeatures()) {
        await dialog({
          message: t('setting__play_media_device_error_tip'),
          confirmButtonText: t('alert_button_text'),
        })
        mediaDeviceId.value = appSetting['player.mediaDeviceId']
      } else if (appSetting['player.audioVisualization']) {
        const confirm = await dialog.confirm({
          message: t('setting__play_media_device_tip'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        })
        if (confirm) {
          updateSetting({
            'player.audioVisualization': false,
            'player.mediaDeviceId': mediaDeviceId.value,
          })
        } else {
          mediaDeviceId.value = appSetting['player.mediaDeviceId']
        }
      } else {
        appSetting['player.mediaDeviceId'] = mediaDeviceId.value
      }
    }

    watch(() => appSetting['player.mediaDeviceId'], val => {
      mediaDeviceId.value = val
    })

    const handleUpdatePowerSaveBlocker = (enabled) => {
      if (enabled) {
        if (isPlay.value) setPowerSaveBlocker(true, true)
      } else {
        setPowerSaveBlocker(false, true)
      }
      updateSetting({ 'player.powerSaveBlocker': enabled })
    }

    const isMaxOutputChannelCount = ref(appSetting['player.isMaxOutputChannelCount'])
    const handleUpdateMaxOutputChannelCount = async(enabled) => {
      isMaxOutputChannelCount.value = enabled
      if (appSetting['player.mediaDeviceId'] != 'default') {
        const confirm = await dialog.confirm({
          message: t('setting__play_advanced_audio_features_tip'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        })
        if (!confirm) {
          isMaxOutputChannelCount.value = false
          return
        }
        await setMediaDeviceId('default').catch(_ => _)
        saveMediaDeviceId('default')
      }
      updateSetting({ 'player.isMaxOutputChannelCount': enabled })
    }


    return {
      appSetting,
      updateSetting,
      mediaDevices: currentMediaDevices,
      mediaDeviceId,
      handleMediaDeviceIdChnage,
      handleUpdatePowerSaveBlocker,
      isMaxOutputChannelCount,
      handleUpdateMaxOutputChannelCount,
      playQualityList,
      playEngineList,
      playEngine,
      handlePlayEngineChange,
      mpvPath,
      mpvExtraArgs,
      handleMpvExtraArgsChange,
      handleMpvBitPerfectChange,
      isMac,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.engineSection {
  // 复用全局 dd > div 的 15px 水平内边距，使标题、下拉框、说明左对齐
}
.engineSelect {
  --selection-width: 260px;
  margin-top: 3px;
}
.engineDesc {
  margin-top: 6px;
  margin-bottom: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-font-label);
}

.mpvSettings {
  margin-top: 16px;
}

.formItem {
  margin-bottom: 16px;
  &:last-child {
    margin-bottom: 0;
  }
}

.formLabel {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
  line-height: 1.4;
  color: var(--color-button-font);
}

.formInput {
  width: 100%;
  max-width: 520px;
  box-sizing: border-box;
}

.formDesc {
  margin-top: 4px;
  margin-bottom: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-font-label);
}

.audirvanaTip {
  font-size: 12px;
  color: var(--color-font-label);
  line-height: 1.6;
  margin-top: 8px;
}
.audirvanaDeviceTip {
  font-size: 12px;
  color: var(--color-font-label);
  line-height: 1.6;
  margin: 0;
}
.mpvDeviceSelect {
  width: 100%;
  max-width: 300px;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--color-button-font);
  background-color: var(--color-button-background);
  border: none;
  border-radius: @form-radius;
  outline: none;
  cursor: pointer;
}
</style>
