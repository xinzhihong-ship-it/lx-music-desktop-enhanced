<template lang="pug">
dt#folia_stage {{ $t('setting__folia_stage') }}
dd.gap-top
  div
    .p
      base-checkbox(id="setting_folia_stage_enable" :model-value="appSetting['foliaStage.enable']" :label="$t('setting__folia_stage_enable')" @update:model-value="updateSetting({ 'foliaStage.enable': $event })")
    .p.gap-top.small
      | {{ $t('setting__folia_stage_status') }}
      span {{ statusText }}
    .p.small {{ $t('setting__folia_stage_tip') }}
</template>

<script>
// 设置 → 开放 API 页里的「Folia 歌词舞台」：开关与连接状态（主进程 modules/foliaStage 负责推送）
import { computed, onBeforeUnmount, onMounted, ref } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { getFoliaStageStatus } from '@renderer/utils/ipc'

const STATUS_REFRESH_MS = 2000

export default {
  name: 'SettingFoliaStage',
  setup() {
    const t = useI18n()
    const status = ref({ state: 'disabled', port: null, detached: false })
    let timer = null

    const refresh = async() => {
      try {
        status.value = await getFoliaStageStatus()
      } catch {}
    }

    const statusText = computed(() => {
      switch (status.value.state) {
        case 'connected':
          return status.value.detached
            ? t('setting__folia_stage_status_detached')
            : t('setting__folia_stage_status_connected', { port: status.value.port })
        case 'waiting': return t('setting__folia_stage_status_waiting')
        default: return t('setting__folia_stage_status_disabled')
      }
    })

    onMounted(() => {
      void refresh()
      timer = setInterval(() => { void refresh() }, STATUS_REFRESH_MS)
    })
    onBeforeUnmount(() => {
      if (timer) clearInterval(timer)
    })

    return {
      appSetting,
      updateSetting,
      statusText,
    }
  },
}
</script>
