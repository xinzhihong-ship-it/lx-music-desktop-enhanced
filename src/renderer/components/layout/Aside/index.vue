<template>
  <aside :class="[$style.aside, { [$style.fullscreen]: isFullscreen }]">
    <div v-if="appSetting['common.controlBtnPosition'] == 'left'" :class="$style.windowControls">
      <ControlBtns />
    </div>
    <div :class="$style.brand" aria-label="LX Music">
      <span :class="$style.mark">LX</span>
      <span :class="$style.wordmark">LX MUSIC<small>{{ $t('ui__brand_subtitle') }}</small></span>
    </div>
    <NavBar />
    <div :class="$style.footer"><span>LX Music</span><span>v{{ versionInfo.version }}</span></div>
  </aside>
</template>

<script setup>
import { isFullscreen, versionInfo } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import ControlBtns from './ControlBtns.vue'
import NavBar from './NavBar.vue'
</script>

<style lang="less" module>
.aside {
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  -webkit-app-region: drag;
  user-select: none;
}
.windowControls {
  flex: none;
  height: 25px;
  padding: 4px 12px 0;
  > div { height: 100%; justify-content: flex-start; gap: 9px; }
}
.brand {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 22px 20px 23px;
}
.mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--color-font);
  color: var(--ui-surface);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -1px;
}
.wordmark {
  color: var(--ui-text);
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 1px;
  white-space: nowrap;
  small { display: block; margin-top: 3px; font-size: 9px; font-weight: 400; color: var(--ui-muted); letter-spacing: 1px; }
}
.footer {
  display: flex;
  justify-content: space-between;
  padding: 18px 20px;
  color: var(--ui-muted);
  font-size: 9px;
  border-top: 1px solid var(--ui-border);
}
.fullscreen { -webkit-app-region: no-drag; }
@media (max-width: 980px) {
  .brand { justify-content: center; padding: 20px 0; }
  .wordmark, .footer { display: none; }
  .windowControls { padding: 5px; }
}
</style>
