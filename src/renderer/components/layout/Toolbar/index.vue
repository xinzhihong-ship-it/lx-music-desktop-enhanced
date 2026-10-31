<template>
  <header :class="[$style.toolbar, { [$style.fullscreen]: isFullscreen }]">
    <SearchInput />
    <div :class="$style.actions">
      <button type="button" :class="$style.theme" :aria-label="$t(isDark ? 'ui__switch_light' : 'ui__switch_dark')" @click="toggleTheme">
        <svg v-if="isDark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" /></svg>
      </button>
      <ControlBtns v-if="appSetting['common.controlBtnPosition'] != 'left'" />
    </div>
  </header>
</template>

<script setup>
import { ref, watch } from '@common/utils/vueTools'
import { isFullscreen, themeId, themeShouldUseDarkColors } from '@renderer/store'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { getThemes, findTheme } from '@renderer/store/utils'
import ControlBtns from './ControlBtns.vue'
import SearchInput from './SearchInput.vue'

const isDark = ref(false)
watch([themeId, themeShouldUseDarkColors, () => appSetting['theme.lightId'], () => appSetting['theme.darkId']], () => {
  getThemes(info => {
    const id = themeId.value === 'auto'
      ? appSetting[themeShouldUseDarkColors.value ? 'theme.darkId' : 'theme.lightId']
      : themeId.value
    isDark.value = findTheme(info, id)?.isDark ?? false
  })
}, { immediate: true })

const toggleTheme = () => {
  const id = appSetting[isDark.value ? 'theme.lightId' : 'theme.darkId']
  updateSetting({ 'theme.id': id })
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.toolbar {
  height: @height-toolbar;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  gap: 16px;
  -webkit-app-region: drag;
  z-index: 2;
}
.actions { display: flex; align-items: center; gap: 15px; min-width: 0; }
.theme {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 8px; border: 1px solid var(--ui-border);
  background: var(--ui-surface); color: var(--ui-muted); border-radius: 50%; cursor: pointer;
  transition: color .2s, background-color .2s;
  svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; }
  &:hover { color: var(--ui-text); background: var(--ui-hover); }
}
.fullscreen { -webkit-app-region: no-drag; }
@media (max-width: 980px) { .toolbar { padding: 0 13px; gap: 10px; } }
</style>
