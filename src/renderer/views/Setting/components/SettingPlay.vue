<template lang="pug">
dt#play {{ $t('setting__play') }}
dd
  div(:class="$style.engineSection")
    h3#basic_play_engine {{ $t('setting__play_engine') }}
    base-selection(:class="$style.engineSelect" v-model="playEngine" :list="playEngineList" item-key="id" item-name="label" @change="handlePlayEngineChange")
    p(:class="$style.engineDesc")
      span(v-if="playEngine == 'mpv'") {{ $t('setting__play_engine_mpv_desc') }}
      span(v-else) {{ $t('setting__play_engine_electron_desc') }}
//- mpv 专属设置
dd(v-if="playEngine == 'mpv'")
  div(:class="$style.mpvSettings")
    div(:class="$style.formItem")
      h3#basic_mpv_path(:class="$style.formLabel") {{ $t('setting__play_mpv_path') }}
      base-input(:class="$style.formInput" v-model="mpvPath" :placeholder="$t('setting__play_mpv_path_placeholder')" @update:model-value="updateSetting({'player.mpv.path': $event})")
      p(:class="$style.formDesc") {{ $t('setting__play_mpv_path_order') }}
    div(:class="$style.formItem")
      h3#basic_mpv_extra_args(:class="$style.formLabel") {{ $t('setting__play_mpv_extra_args') }}
      base-input(:class="$style.formInput" v-model="mpvExtraArgs" :placeholder="$t('setting__play_mpv_extra_args_placeholder')" @update:model-value="handleMpvExtraArgsChange")
      p(:class="$style.formDesc") {{ $t('setting__play_mpv_extra_args_desc') }}
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
    base-selection.gap-left(v-model="mediaDeviceId" :list="mediaDevices" item-key="deviceId" item-name="label" @change="handleMediaDeviceIdChnage")
</template>

<script>
import { ref, onBeforeUnmount, watch, computed } from '@common/utils/vueTools'
import { hasInitedAdvancedAudioFeatures, setMediaDeviceId } from '@renderer/plugins/player'
import * as mpvPlayer from '@renderer/plugins/player/mpv'
import { dialog } from '@renderer/plugins/Dialog'
import showTip from '@renderer/plugins/Tips/Tips'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, saveMediaDeviceId, updateSetting } from '@renderer/store/setting'
import { setPowerSaveBlocker } from '@renderer/core/player/utils'
import { isPlay, playMusicInfo } from '@renderer/store/player/state'
import { TRY_QUALITYS_LIST } from '@renderer/core/music/utils'
import { isMac } from '@common/utils'


export default {
  name: 'SettingPlay',
  setup() {
    const t = useI18n()
    const playQualityList = [...TRY_QUALITYS_LIST, '128k'].reverse()

    const playEngineList = [
      { id: 'electron', label: t('setting__play_engine_electron') },
      { id: 'mpv', label: t('setting__play_engine_mpv') },
    ]
    const playEngine = ref(appSetting['player.playEngine'])
    // 临时诊断：确认 playEngine 与 appSetting 是否一致
    const playEngineDebug = computed(() => JSON.stringify({
      playEngine: playEngine.value,
      appEngine: appSetting['player.playEngine'],
      isMpv: playEngine.value == 'mpv',
    }))
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

    const mpvExtraArgs = ref(appSetting['player.mpv.extraArgs'].join(' '))
    const handleMpvExtraArgsChange = (val) => {
      mpvExtraArgs.value = val
      updateSetting({ 'player.mpv.extraArgs': val.split(/\s+/).filter(Boolean) })
    }
    watch(() => appSetting['player.mpv.extraArgs'], val => {
      mpvExtraArgs.value = val.join(' ')
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
    const loadMpvAudioDevices = () => {
      mpvPlayer.listAudioDevices().then(devices => {
        mpvAudioDevices.value = devices
      }).catch(() => {})
    }
    // 引擎切换到 mpv 时加载设备列表
    watch(() => appSetting['player.playEngine'], val => {
      if (val == 'mpv') loadMpvAudioDevices()
    })
    if (isMpvEngine()) loadMpvAudioDevices()

    const handleMediaDeviceIdChnage = async() => {
      // mpv 模式：通过 --audio-device 参数切换，不走 Electron API
      if (isMpvEngine()) {
        let deviceLabel = ''
        for (const d of mediaDevices.value) {
          if (d.deviceId === mediaDeviceId.value) { deviceLabel = d.label; break }
        }
        const label = deviceLabel || mediaDeviceId.value
        updateSetting({
          'player.mediaDeviceId': mediaDeviceId.value,
          'player.mpv.extraArgs': updateMpvDeviceArg(appSetting['player.mpv.extraArgs'], mediaDeviceId.value, label),
        })
        // 销毁旧 mpv 进程，下次播放用新设备重建
        mpvPlayer.destroy().catch(() => {})
        window.app_event.stop()
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

    // 将 Web Audio 设备 label 映射到 mpv 设备 ID（如 coreaudio/AppleUSBAudioEngine:...）
    const resolveMpvDevice = (label) => {
      if (!label) return null
      for (const d of mpvAudioDevices.value) {
        if (d.name === label) return d.id
      }
      // 也尝试通过名称包含关系匹配（处理设备名格式不一致的情况）
      for (const d of mpvAudioDevices.value) {
        if (label.includes(d.name) || d.name.includes(label)) return d.id
      }
      // 如果没有匹配到，直接返回 label（让 mpv 自己解析）
      console.warn('无法映射设备名称:', label, '可用设备:', mpvAudioDevices.value)
      return label
    }

    const updateMpvDeviceArg = (currentArgs, deviceId, label) => {
      const filtered = currentArgs.filter(a => !a.startsWith('--audio-device='))
      if (deviceId && deviceId !== 'default' && deviceId !== 'Default' && deviceId !== 'communications') {
        const mpvId = resolveMpvDevice(label)
        filtered.push(`--audio-device=${mpvId || label}`)
      }
      return filtered
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
      mediaDevices,
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
      playEngineDebug,
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
</style>
