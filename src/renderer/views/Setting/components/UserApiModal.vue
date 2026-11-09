<template lang="pug">
material-modal(:show="modelValue" bg-close teleport="#view" @close="handleClose")
  main.scroll(:class="$style.main")
    h2 {{ $t('user_api__title') }}
    p(v-if="apiList.length" :class="$style.orderTip") {{ $t('user_api__order_tip') }}
    ul.scroll(v-if="apiList.length" ref="domApiList" :class="$style.content")
      li(v-for="(api, index) in apiList" :key="api.id" :data-api-id="api.id" :class="[$style.listItem, {[$style.active]: appSetting['common.apiSource'] == api.id}]")
        button.user-api-drag-handle(type="button" :class="$style.dragHandle" :disabled="isSavingOrder" :aria-label="$t('user_api__drag', { name: api.name })" :title="$t('user_api__drag', { name: api.name })") ⋮⋮
        div(:class="$style.listLeft")
          h3
            | {{ api.name }}
            span(v-if="api.version") {{ /^\d/.test(api.version) ? `v${api.version}` : api.version }}
            span(v-if="api.author") {{ api.author }}
          p {{ api.description }}
          div
            base-checkbox(:id="`user_api_${api.id}`" v-model="api.allowShowUpdateAlert" :disabled="isSavingOrder" :class="$style.checkbox" :label="$t('user_api__allow_show_update_alert')" @change="handleChangeAllowUpdateAlert(api, $event)")
        div(:class="$style.listActions")
          div(:class="$style.moveActions")
            base-btn(min outline :disabled="isSavingOrder || index == 0" :aria-label="$t('user_api__move_up', { name: api.name })" :title="$t('user_api__move_up', { name: api.name })" @click.stop="handleMove(api.id, -1)") ↑
            base-btn(min outline :disabled="isSavingOrder || index == apiList.length - 1" :aria-label="$t('user_api__move_down', { name: api.name })" :title="$t('user_api__move_down', { name: api.name })" @click.stop="handleMove(api.id, 1)") ↓
          base-btn(min outline @click.stop="api.importSource?.type == 'online' ? handleCopyUrl(api) : handleExport(api)") {{ api.importSource?.type == 'online' ? $t('user_api__btn_copy_link') : $t('user_api__btn_export') }}
          base-btn(:class="$style.listBtn" outline :disabled="isSavingOrder" :aria-label="$t('user_api__btn_remove')" @click.stop="handleRemove(index)")
            svg(v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
              use(xlink:href="#icon-delete")
    div(v-else :class="$style.content")
      div(:class="$style.noitem") {{ $t('user_api__noitem') }}
    div(:class="$style.note")
      p(:class="[$style.ruleLink]")
        | {{ $t('user_api__readme') }}
        span.hover.underline(aria-label="https://lxmusic.toside.cn/desktop/custom-source" @click="handleOpenUrl('https://lyswhut.github.io/lx-music-doc/desktop/custom-source')") FAQ
      p {{ $t('user_api__note') }}
    div(:class="$style.footer")
      base-btn(:class="$style.footerBtn" :disabled="isSavingOrder" @click="isShowOnlineImportModal = true") {{ $t('user_api__btn_import_online') }}
      base-btn(:class="$style.footerBtn" :disabled="isSavingOrder" @click="handleImport") {{ $t('user_api__btn_import') }}
      //- base-btn(:class="$style.footerBtn" @click="handleExport") {{ $t('user_api__btn_export') }}
    UserApiOnlineImportModal(v-model:show="isShowOnlineImportModal" @import="importUserApi")
</template>

<script>
import { exportUserApi, importUserApi, openSaveDir, removeUserApi, moveUserApi, moveUserApiBefore, showSelectDialog, setAllowShowUserApiUpdateAlert } from '@renderer/utils/ipc'
import { writeRendererLog } from '@common/rendererIpc'
import { readFile } from '@common/utils/nodejs'
import { clipboardWriteText, openUrl } from '@common/utils/electron'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { userApi } from '@renderer/store'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { computed, ref, watch, useCssModule } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import Sortable from '@renderer/utils/sortable'
import { clearDownKeys } from '@renderer/event'

import UserApiOnlineImportModal from './UserApiOnlineImportModal.vue'

export default {
  components: {
    UserApiOnlineImportModal,
  },
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue'],
  setup() {
    const isShowOnlineImportModal = ref(false)
    const isSavingOrder = ref(false)
    const apiList = computed(() => userApi.list)
    const domApiList = ref(null)
    const style = useCssModule()
    const t = useI18n()
    watch(domApiList, (element, _previous, onCleanup) => {
      if (!element) return
      const sortable = Sortable.create(element, {
        handle: '.user-api-drag-handle',
        draggable: 'li',
        dataIdAttr: 'data-api-id',
        ghostClass: style.dragging,
        animation: 150,
        forceFallback: true,
        fallbackOnBody: true,
        scroll: element,
        disabled: isSavingOrder.value,
        onStart() { window.app_event.dragStart() },
        onEnd(event) {
          window.app_event.dragEnd()
          clearDownKeys()
          if (event.oldIndex == event.newIndex) return
          const id = event.item.dataset.apiId
          const beforeId = event.item.nextElementSibling?.dataset.apiId ?? null
          // Restore Sortable's DOM mutation before Vue applies the saved list.
          sortable.sort(userApi.list.map(api => api.id))
          isSavingOrder.value = true
          void moveUserApiBefore(id, beforeId).then(list => {
            userApi.list = list
          }).catch(err => {
            void dialog(t('user_api__order_failed', { message: err?.message ?? String(err) }))
          }).finally(() => { isSavingOrder.value = false })
        },
      })
      const stop = watch(isSavingOrder, value => { sortable.option('disabled', value) })
      onCleanup(() => { stop(); sortable.destroy() })
    }, { flush: 'post' })

    return {
      userApi,
      apiList,
      appSetting,
      isShowOnlineImportModal,
      isSavingOrder,
      domApiList,
    }
  },
  methods: {
    async handleMove(id, direction) {
      if (this.isSavingOrder) return
      this.isSavingOrder = true
      try {
        userApi.list = await moveUserApi(id, direction)
      } catch (err) {
        void dialog(this.$t('user_api__order_failed', { message: err?.message ?? String(err) }))
      } finally {
        this.isSavingOrder = false
      }
    },
    async importUserApi(params) {
      writeRendererLog('[UserApiModal importUserApi] called, script length:', params.script?.length, 'type:', typeof params.script)
      return importUserApi(params).then(({ apiList }) => {
        console.log('[UserApiModal importUserApi] success, apiList length:', apiList?.length)
        userApi.list = apiList
      }).catch((err) => {
        writeRendererLog('[UserApiModal importUserApi] catch error:', err)
        console.error('[UserApiModal importUserApi] error:', err)
        const typeInfo = `type=${typeof err}, isError=${err instanceof Error}, toString=${Object.prototype.toString.call(err)}`
        const rawValue = `raw=${String(err)}`
        const message = String(err?.message ?? err)
        const detail = (() => {
          try {
            return JSON.stringify(err, Object.getOwnPropertyNames(err), 2)
          } catch {
            return String(err)
          }
        })()
        const stack = err?.stack ? String(err.stack) : ''
        const fullMessage = `${message}\n\n${typeInfo}\n${rawValue}\n\nDetail:\n${detail}${stack ? '\n\nStack:\n' + stack : ''}`
        void dialog(this.$t('user_api_import__failed', { message: fullMessage }))
      })
    },
    handleImport() {
      void showSelectDialog({
        title: this.$t('user_api__import_file'),
        properties: ['openFile'],
        filters: [
          { name: 'LX API File', extensions: ['js'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(async result => {
        if (result.canceled) return
        return readFile(result.filePaths[0]).then(async data => {
          return this.importUserApi({ script: data.toString(), importSource: { type: 'local' } })
        })
      })
    },
    handleCopyUrl(api) {
      if (api.importSource?.type == 'online') clipboardWriteText(api.importSource.url)
    },
    async handleExport(api) {
      const fileName = `${api.name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'lx-music-source'}.js`
      const result = await openSaveDir({
        title: this.$t('user_api__btn_export'),
        defaultPath: fileName,
        filters: [{ name: 'JavaScript', extensions: ['js'] }],
      })
      if (result.canceled) return
      const path = result.filePath.endsWith('.js') ? result.filePath : `${result.filePath}.js`
      try {
        await exportUserApi({ id: api.id, path })
        await dialog({ message: this.$t('user_api_export__success') })
      } catch (err) {
        await dialog({ message: this.$t('user_api_export__failed', { message: err?.message ?? String(err) }) })
      }
    },
    async handleRemove(index) {
      const api = this.apiList[index]
      if (!api) return
      if (appSetting['common.apiSource'] == api.id) {
        let backApi = apiSourceInfo.find(api => !api.disabled)
        if (!backApi) backApi = userApi.list[0]
        updateSetting({ 'common.apiSource': backApi?.id ?? '' })
      }
      userApi.list = await removeUserApi([api.id])
    },
    handleClose() {
      this.$emit('update:modelValue', false)
    },
    handleOpenUrl(url) {
      void openUrl(url)
    },
    handleChangeAllowUpdateAlert(api, enable) {
      void setAllowShowUserApiUpdateAlert(api.id, enable)
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px 8px;
  max-width: 550px;
  min-width: 300px;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  // max-height: 100%;
  // overflow: hidden;
  h2 {
    font-size: 16px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
  }
}

.name {
  color: var(--color-primary);
}

.checkbox {
  margin-top: 3px;
  font-size: 14px;
  opacity: .86;
}

.content {
  flex: auto;
  min-height: 80px;
  max-height: 100%;
  margin-top: 15px;
  padding: 0 7px;
}
.listItem {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  transition: background-color 0.2s ease;
  padding: 15px 10px;
  border-radius: @radius-border;
  &:hover {
    background-color: var(--color-primary-background-hover);
  }
  &.active {
    background-color: var(--color-primary-background-active);
  }
  h3 {
    font-size: 15px;
    color: var(--color-font);
    word-break: break-all;
    span {
      font-size: 12px;
      color: var(--color-font-label);
      margin-left: 6px;
    }
  }
  p {
    margin-top: 5px;
    font-size: 14px;
    color: var(--color-font-label);
    word-break: break-all;
  }
}
.noitem {
  height: 100px;
  font-size: 18px;
  color: var(--color-font-label);
  display: flex;
  justify-content: center;
  align-items: center;
}
.listLeft {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
}
.listBtn {
  flex: none;
  height: 30px;
  width: 30px;
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  svg {
    width: 60%;
  }
}
.listActions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.moveActions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dragHandle {
  flex: none;
  padding: 8px 4px;
  margin-right: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-font-label);
  font-size: 18px;
  cursor: grab;
  touch-action: none;
  &:active { cursor: grabbing; }
  &:disabled { cursor: default; opacity: .4; }
  &:focus-visible { outline: 2px solid var(--color-primary); }
}
.dragging { opacity: .35; }
.orderTip {
  margin: 10px 7px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-font-label);
}
.note {
  padding: 0 7px;
  margin-top: 15px;
  font-size: 12px;
  line-height: 1.25;
  color: var(--color-font);
  p {
    + p {
      margin-top: 5px;
    }
  }
}
.footer {
  padding: 0 7px;
  margin-top: 15px;
  display: flex;
  flex-flow: row nowrap;
}
.footerBtn {
  flex: auto;
  height: 36px;
  line-height: 36px;
  padding: 0 10px !important;
  width: 150px;
  .mixin-ellipsis-1();
  + .footerBtn {
    margin-left: 15px;
  }
}
.ruleLink {
  .mixin-ellipsis-1();
}

</style>
