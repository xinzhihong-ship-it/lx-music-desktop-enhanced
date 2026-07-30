<template lang="pug">
dd
  h3 {{ $t('setting__webdav_title') }}
  div
    base-checkbox(
      id="setting_webdav_enable"
      :model-value="appSetting['sync.webdav.enable']"
      :label="$t('setting__webdav_enable')"
      @update:model-value="setSetting('sync.webdav.enable', $event)"
    )
    base-checkbox.gap-left(
      id="setting_webdav_auto_sync"
      :disabled="!appSetting['sync.webdav.enable']"
      :model-value="appSetting['sync.webdav.autoSync']"
      :label="$t('setting__webdav_auto_sync')"
      @update:model-value="setSetting('sync.webdav.autoSync', $event)"
    )

    .p.gap-top
      .p.small {{ $t('setting__webdav_url') }}
      base-input.gap-left(
        :class="$style.input"
        :model-value="appSetting['sync.webdav.url']"
        placeholder="https://dav.example.com/"
        @update:model-value="setSetting('sync.webdav.url', $event)"
      )
    .p
      .p.small {{ $t('setting__webdav_username') }}
      base-input.gap-left(
        :class="$style.input"
        :model-value="appSetting['sync.webdav.username']"
        @update:model-value="setSetting('sync.webdav.username', $event)"
      )
    .p
      .p.small {{ $t('setting__webdav_password') }}
      base-input.gap-left(
        :class="$style.input"
        type="password"
        :trim="false"
        :model-value="appSetting['sync.webdav.password']"
        @update:model-value="setSetting('sync.webdav.password', $event)"
      )
    .p
      .p.small {{ $t('setting__webdav_path') }}
      base-input.gap-left(
        :class="$style.input"
        :model-value="appSetting['sync.webdav.path']"
        placeholder="/LX_Music/"
        @update:model-value="setSetting('sync.webdav.path', $event)"
      )

    .p.gap-top(:class="$style.buttons")
      base-btn.btn(min :disabled="!!busy" @click="run('test', testWebDAVConnection, 'setting__webdav_test_success')") {{ $t('setting__webdav_test') }}
      base-btn.btn(min :disabled="!!busy" @click="run('sync', () => syncWebDAVLists(true), 'setting__webdav_sync_success')") {{ $t('setting__webdav_sync_now') }}
    .p(:class="$style.buttons")
      base-btn.btn(min :disabled="!!busy" @click="confirmRun('uploadSettings', 'setting__webdav_upload_settings_confirm', uploadWebDAVSettings, 'setting__webdav_upload_success')") {{ $t('setting__webdav_upload_settings') }}
      base-btn.btn(min :disabled="!!busy" @click="confirmRun('downloadSettings', 'setting__webdav_download_settings_confirm', downloadWebDAVSettings, 'setting__webdav_download_success')") {{ $t('setting__webdav_download_settings') }}
    .p(:class="$style.buttons")
      base-btn.btn(min :disabled="!!busy" @click="confirmRun('uploadLists', 'setting__webdav_upload_lists_confirm', uploadWebDAVLists, 'setting__webdav_upload_success')") {{ $t('setting__webdav_upload_lists') }}
      base-btn.btn(min :disabled="!!busy" @click="confirmRun('downloadLists', 'setting__webdav_download_lists_confirm', downloadWebDAVLists, 'setting__webdav_download_success')") {{ $t('setting__webdav_download_lists') }}
    .p.small {{ $t('setting__webdav_last_sync', { time: lastSyncTime }) }}
    .p.small {{ $t('setting__webdav_security_tip') }}
</template>

<script setup>
import { computed, ref } from '@common/utils/vueTools'
import { dateFormat } from '@common/utils/common'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { dialog } from '@renderer/plugins/Dialog'
import {
  testWebDAVConnection,
  syncWebDAVLists,
  uploadWebDAVSettings,
  downloadWebDAVSettings,
  uploadWebDAVLists,
  downloadWebDAVLists,
} from '@renderer/core/webdavSync'

const busy = ref('')
const lastSyncTime = computed(() => appSetting['sync.webdav.lastSyncTime']
  ? dateFormat(new Date(appSetting['sync.webdav.lastSyncTime']), 'Y-M-D h:m:s')
  : window.i18n.t('setting__webdav_never'))

const setSetting = (key, value) => {
  Object.assign(appSetting, { [key]: value })
  updateSetting({ [key]: value })
}

const run = async(name, action, successKey) => {
  if (busy.value) return
  busy.value = name
  try {
    await action()
    await dialog({ message: window.i18n.t(successKey) })
  } catch (error) {
    await dialog({ message: `${window.i18n.t('setting__webdav_sync_failed')}: ${error?.message ?? String(error)}` })
  } finally {
    busy.value = ''
  }
}

const confirmRun = async(name, confirmKey, action, successKey) => {
  const confirmed = await dialog.confirm({
    message: window.i18n.t(confirmKey),
    cancelButtonText: window.i18n.t('cancel_button_text'),
    confirmButtonText: window.i18n.t('confirm_button_text'),
  })
  if (confirmed) await run(name, action, successKey)
}
</script>

<style lang="less" module>
.input {
  min-width: 380px;
}
.buttons {
  display: flex;
  gap: 8px;
}
</style>
