<template lang="pug">
material-modal(:show="modelValue" bg-close :hide-header="true" teleport="#view" width="min(860px, 92vw)" min-width="0" max-width="92vw" height="min(560px, 78vh)" max-height="78vh" @close="handleClose")
  main(:class="$style.main")
    header(:class="$style.hero")
      div
        p(:class="$style.kicker") LX ACCOUNT
        h2 {{ $t('account__title') }}
        p(:class="$style.heroCopy") 连接并管理你的音乐平台
      button(type="button" :class="$style.closeBtn" aria-label="关闭" @click="handleClose")
        svg(version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
          use(xlink:href="#icon-delete")

    div(:class="$style.workspace")
      aside(:class="[$style.panel, $style.accountPanel]")
        div(:class="$style.panelHeading")
          h3 {{ $t('account__saved_accounts') }}
          span(:class="$style.accountCount") {{ accounts.length }}
        ul(v-if="accounts.length" :class="$style.accountList")
          li(v-for="account in accounts" :key="account.id" :class="$style.accountItem")
            img(v-if="account.avatar" :src="account.avatar" :class="$style.accountAvatar")
            div(v-else :class="$style.accountAvatar")
            div(:class="$style.accountInfo")
              h4 {{ account.nickname }}
              p {{ sourceName(account.source) }}
            button(type="button" :class="$style.accountRemove" :aria-label="$t('account__btn_remove')" :title="$t('account__btn_remove')" @click.stop="handleRemove(account.id)")
              svg(version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
                use(xlink:href="#icon-delete")
        div(v-else :class="$style.empty")
          span(:class="$style.emptyIcon") +
          p {{ $t('account__noitem') }}

      section(:class="[$style.panel, $style.loginPanel]")
        div(:class="$style.panelHeading")
          h3 {{ $t('account__add_account') }}
          span(:class="$style.currentSource") {{ sourceName(form.source) }}

        div(:class="$style.sourceGrid" role="group" :aria-label="$t('account__source_label')")
          button(
            v-for="source in sourceList"
            :key="source.id"
            type="button"
            :class="[$style.sourceButton, { [$style.sourceButtonActive]: form.source === source.id }]"
            :aria-pressed="form.source === source.id"
            @click="form.source = source.id"
          )
            span(:class="$style.sourceMark") {{ source.name.slice(0, 1) }}
            span(:class="$style.sourceName") {{ source.name }}

        div(:class="$style.methodTabs")
          button(
            v-for="method in methodList"
            :key="method.id"
            type="button"
            :class="[$style.methodTab, { [$style.methodTabActive]: form.method === method.id }]"
            :aria-pressed="form.method === method.id"
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
            div(:class="$style.qrcodeDetails")
              p(:class="$style.qrcodeEyebrow") 扫码登录
              h4(:class="$style.qrcodeStatus") {{ qrStatusText }}
              p(:class="$style.qrcodeHint") 扫码成功后会自动完成登录
              base-btn(v-if="qrState.status !== 'confirmed'" :class="$style.refreshBtn" outline @click="startQrLogin") {{ $t('account__qrcode_refresh') }}

          div(v-else-if="form.method === 'cookie'" :class="$style.formSection")
            label(:class="$style.fieldLabel")
              span Cookie
              textarea(v-model="form.cookie" :class="$style.cookieInput" :placeholder="$t('account__cookie_placeholder')")

        div(v-if="error" :class="$style.error") {{ error }}
        div(v-if="form.method !== 'qrcode'" :class="$style.footer")
          base-btn(:class="$style.footerBtn" :disabled="isLoading" @click="handleLogin") {{ isLoading ? $t('account__logining') : $t('account__login') }}
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
      { id: 'bili', name: '哔哩哔哩' },
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
      return { wy: '网易云音乐', kg: '酷狗音乐', tx: 'QQ音乐', bili: '哔哩哔哩' }[source] ?? source
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
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  box-sizing: border-box;
  padding: 24px;
  display: flex;
  flex-flow: column nowrap;
  gap: 18px;
  overflow: hidden;
  color: var(--color-font);
}

.hero {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;

  h2 {
    margin-top: 2px;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
    color: var(--color-font);
  }
}

.kicker {
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.18em;
  color: var(--color-primary);
  font-weight: 700;
}

.heroCopy {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-font-label);
}

.closeBtn {
  flex: none;
  width: 34px;
  height: 34px;
  padding: 10px;
  border: none;
  border-radius: 50%;
  background: var(--color-primary-background);
  color: var(--color-font-label);
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease, transform 0.1s ease;

  svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }

  &:hover {
    color: var(--color-font);
    background: var(--color-primary-background-hover);
  }

  &:active {
    transform: scale(0.94);
  }
}

.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(210px, 0.78fr) minmax(430px, 1.8fr);
  gap: 16px;
}

.panel {
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid var(--color-primary-background-hover);
  border-radius: 14px;
}

.accountPanel {
  padding: 16px;
  display: flex;
  flex-flow: column nowrap;
  background: var(--color-primary-background);
}

.loginPanel {
  padding: 18px;
  display: flex;
  flex-flow: column nowrap;
  background: var(--color-content-background);
}

.panelHeading {
  flex: none;
  min-height: 22px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  h3 {
    min-width: 0;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-font);
  }
}

.accountCount,
.currentSource {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-primary-background-hover);
  color: var(--color-font-label);
  font-size: 11px;
  line-height: 1.4;
}

.currentSource {
  color: var(--color-primary);
  font-weight: 600;
}

.accountList {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0 3px 0 0;
  list-style: none;
  overflow-y: auto;
}

.accountItem {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--color-content-background);
  transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.15s ease;

  & + & {
    margin-top: 8px;
  }

  &:hover {
    border-color: var(--color-primary-background-hover);
    background: var(--color-primary-background-hover);
    transform: translateY(-1px);
  }
}

.accountAvatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-primary-background-hover);
  object-fit: cover;
  box-shadow: inset 0 0 0 1px var(--color-primary-background-hover);
}

.accountInfo {
  flex: 1 1 auto;
  min-width: 0;

  h4,
  p {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  h4 {
    font-size: 13px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-font);
  }

  p {
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.35;
    color: var(--color-font-label);
  }
}

.accountRemove {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 8px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-font-label);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.2s ease, color 0.2s ease, background-color 0.2s ease;

  svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }

  &:hover,
  &:focus-visible {
    opacity: 1;
    color: var(--color-error);
    background: var(--color-content-background);
  }
}

.empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--color-primary-background-hover);
  border-radius: 11px;
  color: var(--color-font-label);
  font-size: 12px;
  text-align: center;
}

.emptyIcon {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--color-content-background);
  color: var(--color-primary);
  font-size: 22px;
  font-weight: 300;
}

.sourceGrid {
  flex: none;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
  margin-bottom: 10px;
}

.sourceButton {
  min-width: 0;
  height: 48px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: var(--color-primary-background);
  color: var(--color-font-label);
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, transform 0.1s ease;

  &:hover {
    border-color: var(--color-primary-background-hover);
    background: var(--color-primary-background-hover);
    color: var(--color-font);
  }

  &:active {
    transform: translateY(1px);
  }
}

.sourceButtonActive {
  border-color: var(--color-primary);
  background: var(--color-content-background);
  color: var(--color-font);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.06);

  .sourceMark {
    background: var(--color-primary);
    color: #fff;
  }
}

.sourceMark {
  flex: none;
  width: 25px;
  height: 25px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--color-primary-background-hover);
  color: var(--color-font);
  font-size: 11px;
  font-weight: 700;
}

.sourceName {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  font-weight: 600;
}

.methodTabs {
  flex: none;
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
  padding: 3px;
  border-radius: 10px;
  background: var(--color-primary-background);
}

.methodTab {
  flex: 1 1 0;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-font-label);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    color: var(--color-font);
  }
}

.methodTabActive {
  background: var(--color-content-background);
  color: var(--color-font);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.formBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-primary-background-hover);
  border-radius: 12px;
  background: var(--color-primary-background);
}

.qrcodeSection {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 16px 22px;
  display: grid;
  grid-template-columns: 174px minmax(0, 1fr);
  align-items: center;
  justify-content: center;
  gap: 26px;
}

.qrcodeCard {
  position: relative;
  width: 174px;
  height: 174px;
  box-sizing: border-box;
  padding: 9px;
  border: 1px solid var(--color-primary-background-hover);
  border-radius: 16px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
}

.qrcodeImg,
.qrcodePlaceholder {
  width: 100%;
  height: 100%;
}

.qrcodeImg {
  display: block;
  object-fit: contain;
}

.qrcodePlaceholder {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
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
  gap: 7px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.94);
  color: var(--color-success);
  font-size: 13px;
  text-align: center;
}

.qrcodeSuccessIcon {
  width: 38px;
  height: 38px;
}

.qrcodeDetails {
  min-width: 0;
}

.qrcodeEyebrow {
  margin-bottom: 7px;
  color: var(--color-primary);
  font-size: 10px;
  line-height: 1.3;
  letter-spacing: 0.12em;
  font-weight: 700;
}

.qrcodeStatus {
  color: var(--color-font);
  font-size: 17px;
  line-height: 1.4;
  font-weight: 650;
  word-break: break-word;
}

.qrcodeHint {
  margin-top: 7px;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 1.55;
}

.refreshBtn {
  margin-top: 14px;
}

.formSection {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 18px;
  display: flex;
  flex-flow: column nowrap;
  gap: 14px;
}

.fieldLabel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
  gap: 7px;
  color: var(--color-font-label);
  font-size: 12px;
  font-weight: 600;
}

.cookieInput {
  flex: 1 1 auto;
  min-height: 110px;
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--color-primary-background-hover);
  border-radius: 10px;
  resize: none;
  outline: none;
  overflow-x: hidden;
  background: var(--color-content-background);
  color: var(--color-font);
  font-size: 12px;
  line-height: 1.55;
  word-break: break-all;
  transition: border-color 0.2s ease;

  &:focus {
    border-color: var(--color-primary);
  }
}

.error {
  flex: none;
  margin-top: 10px;
  padding: 8px 11px;
  border-radius: 9px;
  background: rgba(var(--color-error-rgb, 244, 67, 54), 0.08);
  color: var(--color-error);
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
}

.footer {
  flex: none;
  padding-top: 10px;
  display: flex;
  justify-content: flex-end;
}

.footerBtn {
  min-width: 112px;
}

@media (max-width: 760px) {
  .main {
    padding: 16px;
    gap: 12px;
  }

  .heroCopy {
    display: none;
  }

  .workspace {
    grid-template-columns: minmax(165px, 0.72fr) minmax(360px, 1.8fr);
    gap: 10px;
  }

  .accountPanel,
  .loginPanel {
    padding: 12px;
  }

  .accountItem {
    padding: 7px;
  }

  .accountAvatar {
    width: 32px;
    height: 32px;
  }

  .sourceGrid,
  .methodTabs {
    margin-bottom: 8px;
  }

  .sourceButton {
    height: 40px;
  }

  .qrcodeSection {
    padding: 10px 14px;
    grid-template-columns: 140px minmax(0, 1fr);
    gap: 16px;
  }

  .qrcodeCard {
    width: 140px;
    height: 140px;
    padding: 7px;
    border-radius: 13px;
  }
}

@media (max-width: 620px) {
  .main {
    padding-right: 12px;
    padding-left: 12px;
  }

  .workspace {
    grid-template-columns: minmax(145px, 0.65fr) minmax(330px, 1.75fr);
    gap: 8px;
  }

  .accountPanel,
  .loginPanel {
    padding: 10px;
  }

  .sourceMark {
    display: none;
  }

  .sourceButton {
    padding-right: 4px;
    padding-left: 4px;
  }
}

@media (max-height: 620px) {
  .main {
    padding-top: 14px;
    padding-bottom: 14px;
    gap: 10px;
  }

  .heroCopy {
    display: none;
  }

  .panelHeading {
    margin-bottom: 8px;
  }

  .sourceButton {
    height: 42px;
  }

  .qrcodeSection {
    grid-template-columns: 140px minmax(0, 1fr);
    padding-top: 10px;
    padding-bottom: 10px;
  }

  .qrcodeCard {
    width: 140px;
    height: 140px;
  }
}
</style>
