<template lang="pug">
material-modal(:show="modelValue" bg-close teleport="#view" height="86%" max-height="90%" @close="handleClose")
  main.scroll(:class="$style.main")
    h2 {{ $t('account__title') }}

    div(:class="$style.section")
      h3(:class="$style.sectionTitle") {{ $t('account__saved_accounts') }}
      ul.scroll(v-if="accounts.length" :class="$style.accountList")
        li(v-for="account in accounts" :key="account.id" :class="$style.accountItem")
          img(v-if="account.avatar" :src="account.avatar" :class="$style.accountAvatar")
          div(v-else :class="$style.accountAvatar")
          div(:class="$style.accountInfo")
            h4 {{ account.nickname }}
            p {{ sourceName(account.source) }}
          base-btn(:class="$style.accountRemove" outline :aria-label="$t('account__btn_remove')" @click.stop="handleRemove(account.id)")
            svg(v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
              use(xlink:href="#icon-delete")
      div(v-else :class="$style.empty") {{ $t('account__noitem') }}

    div(:class="[$style.section, $style.sectionGrow]")
      h3(:class="$style.sectionTitle") {{ $t('account__add_account') }}
      div(:class="$style.sourceRow")
        span {{ $t('account__source_label') }}
        base-selection(v-model="form.source" :list="sourceList" item-key="id" item-name="name")

      div(:class="$style.methodTabs")
        button(
          v-for="method in methodList"
          :key="method.id"
          :class="[$style.methodTab, { [$style.methodTabActive]: form.method === method.id }]"
          @click="form.method = method.id"
        ) {{ method.name }}

      div(:class="$style.formBody")
        div(v-if="form.method === 'qrcode'" :class="$style.qrcodeSection")
          div(v-if="qrState.qrUrl" :class="$style.qrcodeCard")
            img(:src="qrState.qrUrl" :class="$style.qrcodeImg" @error="handleQrImageError")
            div(v-if="qrState.status === 'confirmed'" :class="$style.qrcodeMask")
              svg-icon(:class="$style.qrcodeSuccessIcon" name="check")
              span {{ $t('account__qrcode_confirmed') }}
          div(v-else :class="$style.qrcodeCard")
            div(:class="$style.qrcodePlaceholder")
              svg-icon(:class="$style.qrcodeLoadingIcon" name="loading")
          p(:class="$style.qrcodeStatus") {{ qrStatusText }}
          base-btn(v-if="qrState.status === 'expired' || qrState.status === 'failed'" outline @click="startQrLogin") {{ $t('account__qrcode_refresh') }}

        div(v-else-if="form.method === 'cookie'" :class="$style.formSection")
          label(:class="$style.fieldLabel")
            span Cookie
            textarea(v-model="form.cookie" :class="$style.cookieInput" :placeholder="$t('account__cookie_placeholder')")

      div(v-if="error" :class="$style.error") {{ error }}

    div(:class="$style.footer")
      base-btn(v-if="form.method !== 'qrcode'" :class="$style.footerBtn" :disabled="isLoading" @click="handleLogin") {{ isLoading ? $t('account__logining') : $t('account__login') }}
</template>

<script>
import { ref, reactive, computed, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { accounts, loadAccounts, removeAccount } from '@renderer/store/account'
import { checkAccountQrCode, createAccountQrCode, loginAccount } from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'

const QR_STATUS_TEXT_MAP = {
  waiting: 'account__qrcode_waiting',
  scanned: 'account__qrcode_scanned',
  confirmed: 'account__qrcode_confirmed',
  expired: 'account__qrcode_expired',
  failed: 'account__qrcode_failed',
}

export default {
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const form = reactive({
      source: 'wy',
      method: 'qrcode',
      cookie: '',
    })
    const error = ref('')
    const isLoading = ref(false)
    const sourceList = computed(() => [
      { id: 'wy', name: '网易云音乐' },
      { id: 'tx', name: 'QQ音乐' },
      { id: 'kg', name: '酷狗音乐' },
    ])
    const methodList = computed(() => {
      const nameMap = {
        qrcode: '二维码',
        cookie: 'Cookie',
      }
      return ['qrcode', 'cookie'].map(id => ({ id, name: nameMap[id] ?? id }))
    })
    const qrState = reactive({
      key: '',
      qrUrl: '',
      status: 'waiting',
      message: '',
    })
    const qrStatusText = computed(() => {
      if (qrState.status === 'waiting' && form.source === 'tx') return window.i18n.t('account__qrcode_waiting_tx')
      const key = QR_STATUS_TEXT_MAP[qrState.status]
      return key ? window.i18n.t(key) + (qrState.message ? ` (${qrState.message})` : '') : qrState.message || ''
    })
    let qrTimer = null

    const sourceName = (source) => {
      return { wy: '网易云音乐', kg: '酷狗音乐', tx: 'QQ音乐' }[source] ?? source
    }

    const stopQrLogin = () => {
      if (qrTimer) {
        clearTimeout(qrTimer)
        qrTimer = null
      }
    }

    const resetQrState = () => {
      qrState.key = ''
      qrState.qrUrl = ''
      qrState.status = 'waiting'
      qrState.message = ''
      stopQrLogin()
    }

    const handleQrImageError = () => {
      qrState.status = 'failed'
      qrState.message = '二维码图片加载失败'
    }

    const handleQrConfirmed = async() => {
      stopQrLogin()
      await loadAccounts()
      resetQrState()
    }

    const pollQrCodeStatus = async(source = form.source, requestId = qrState.key) => {
      if (!requestId || source !== form.source || requestId !== qrState.key) return
      try {
        const result = await checkAccountQrCode(source, requestId)
        if (source !== form.source || requestId !== qrState.key) return
        qrState.status = result.status
        qrState.message = result.message ?? ''
        if (result.status === 'confirmed') {
          if (result.account) await handleQrConfirmed()
          return
        }
        if (result.status === 'expired' || result.status === 'failed') return
        qrTimer = setTimeout(() => { void pollQrCodeStatus(source, requestId) }, 2000)
      } catch (err) {
        console.error('[AccountModal] QR poll failed:', err?.message ?? err)
        qrState.status = 'failed'
        qrState.message = err?.message || '二维码登录失败'
      }
    }

    const startQrLogin = async() => {
      error.value = ''
      resetQrState()
      const source = form.source
      try {
        const state = await createAccountQrCode(source)
        if (source !== form.source) return
        qrState.key = state.key
        qrState.qrUrl = state.qrUrl
        qrState.status = state.status
        if (!state.qrUrl) {
          qrState.status = 'failed'
          qrState.message = '未获取到二维码图片'
        } else {
          qrTimer = setTimeout(() => { void pollQrCodeStatus(source, state.key) }, 2000)
        }
      } catch (err) {
        console.error('[AccountModal] create QR failed:', err?.message ?? err)
        qrState.status = 'failed'
        qrState.message = err?.message || '获取二维码失败'
      }
    }

    const handleLogin = async() => {
      error.value = ''
      try {
        isLoading.value = true
        if (!form.cookie.trim()) {
          error.value = window.i18n.t('account__cookie_required')
          return
        }
        await loginAccount({ source: form.source, method: 'cookie', cookie: form.cookie.trim() })
        await loadAccounts()
        form.cookie = ''
      } catch (err) {
        console.error('[AccountModal] login failed:', err?.message ?? err)
        error.value = err?.message || window.i18n.t('account__login_failed')
      } finally {
        isLoading.value = false
      }
    }

    const handleRemove = async(id) => {
      try {
        await removeAccount(id)
      } catch (err) {
        void dialog(window.i18n.t('account__remove_failed', { message: err?.message ?? '' }))
      }
    }

    const handleClose = () => {
      emit('update:modelValue', false)
    }

    watch(() => form.source, () => {
      const wasQrCode = form.method === 'qrcode'
      resetQrState()
      error.value = ''
      form.cookie = ''
      form.method = 'qrcode'
      if (props.modelValue && wasQrCode) void startQrLogin()
    })

    watch(() => form.method, (method) => {
      resetQrState()
      error.value = ''
      if (props.modelValue && method === 'qrcode') void startQrLogin()
    })

    watch(() => props.modelValue, (visible) => {
      if (!visible) {
        stopQrLogin()
        error.value = ''
      } else if (form.method === 'qrcode') {
        void startQrLogin()
      }
    })

    onBeforeUnmount(() => {
      stopQrLogin()
    })

    return {
      accounts,
      form,
      error,
      isLoading,
      sourceList,
      methodList,
      qrState,
      qrStatusText,
      sourceName,
      startQrLogin,
      handleLogin,
      handleRemove,
      handleClose,
      handleQrImageError,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 20px 22px;
  width: min(640px, 92vw);
  min-width: 340px;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
  overflow: hidden;

  h2 {
    font-size: 18px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
    margin-bottom: 6px;
    font-weight: 600;
  }
}

.section {
  margin-top: 12px;
}

.sectionGrow {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
}

.sectionTitle {
  font-size: 13px;
  color: var(--color-font-label);
  margin-bottom: 8px;
  font-weight: 500;
}

.accountList {
  max-height: 100px;
  overflow-y: auto;
}

.accountItem {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  transition: background-color 0.2s ease;
  padding: 10px;
  border-radius: @radius-border;
  background: var(--color-primary-background);
  margin-bottom: 8px;

  &:hover {
    background-color: var(--color-primary-background-hover);
  }
}

.accountAvatar {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--color-primary-background-hover);
  object-fit: cover;
  margin-right: 10px;
}

.accountInfo {
  flex: auto;
  min-width: 0;

  h4 {
    font-size: 14px;
    color: var(--color-font);
    word-break: break-all;
  }

  p {
    font-size: 12px;
    color: var(--color-font-label);
    margin-top: 2px;
  }
}

.accountRemove {
  flex: none;
  margin-left: 10px;

  svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
}

.empty {
  font-size: 13px;
  color: var(--color-font-label);
  text-align: center;
  padding: 16px 0;
  background: var(--color-primary-background);
  border-radius: @radius-border;
}

.sourceRow {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;

  span {
    font-size: 13px;
    color: var(--color-font);
    flex: none;
    font-weight: 500;
  }
}

.methodTabs {
  display: flex;
  flex-flow: row nowrap;
  gap: 6px;
  margin-bottom: 12px;
  padding: 4px;
  background: var(--color-primary-background);
  border-radius: @radius-border;
}

.methodTab {
  flex: 1;
  padding: 8px 6px;
  border-radius: @radius-border;
  border: none;
  background: transparent;
  color: var(--color-font-label);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;

  &:hover {
    background: var(--color-primary-background-hover);
    color: var(--color-font);
  }

  &:active {
    transform: translateY(1px);
  }
}

.methodTabActive {
  background: var(--color-primary);
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

  &:hover {
    background: var(--color-primary);
    color: #fff;
  }
}

.formBody {
  flex: 1 1 auto;
  min-height: 200px;
  overflow-y: auto;
  background: var(--color-primary-background);
  border-radius: @radius-border;
  padding: 14px;
  display: flex;
  flex-flow: column nowrap;
  justify-content: flex-start;
}

.formSection {
  display: flex;
  flex-flow: column nowrap;
  gap: 16px;
}

.fieldLabel {
  display: flex;
  flex-flow: column nowrap;
  gap: 6px;
  color: var(--color-font-label);
  font-size: 13px;
  font-weight: 500;

  span {
    padding-left: 2px;
  }
}

.smsFieldLabel {
  flex: auto;
  min-width: 0;
}

.cookieInput {
  width: 100%;
  min-height: 130px;
  padding: 12px;
  border: 1px solid var(--color-primary-background-hover);
  border-radius: @radius-border;
  background: var(--color-primary-background);
  color: var(--color-font);
  font-size: 13px;
  resize: vertical;
  line-height: 1.5;
  overflow-x: hidden;
  word-break: break-all;
}

.qrcodeSection {
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  gap: 8px;
}

.qrcodeCard {
  position: relative;
  width: 160px;
  height: 160px;
  border-radius: @radius-border;
  overflow: hidden;
  background: #fff;
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.qrcodeImg {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qrcodePlaceholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-background-hover);
}

.qrcodeLoadingIcon {
  width: 32px;
  height: 32px;
  color: var(--color-font-label);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.qrcodeMask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  color: var(--color-success);
  font-size: 14px;
  text-align: center;
  gap: 6px;
}

.qrcodeSuccessIcon {
  width: 40px;
  height: 40px;
}

.qrcodeStatus {
  font-size: 13px;
  color: var(--color-font-label);
  text-align: center;
  line-height: 1.4;
}

.smsRow {
  display: flex;
  flex-flow: row nowrap;
  gap: 12px;
  align-items: flex-end;
}

.smsBtn {
  flex: none;
  min-width: 110px;
  height: 38px;
  margin-bottom: 0;
}

.error {
  margin-top: 12px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-error);
  text-align: center;
  background: rgba(var(--color-error-rgb, 244, 67, 54), 0.08);
  border-radius: @radius-border;
  line-height: 1.5;
}

.footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}

.footerBtn {
  min-width: 90px;
}
</style>
