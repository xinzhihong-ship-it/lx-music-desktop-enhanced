<template lang="pug">
dt#search {{ $t('setting__search') }}
dd
  .gap-top
    base-checkbox(id="setting_search_showHot_enable" :model-value="appSetting['search.isShowHotSearch']" :label="$t('setting__search_hot')" @update:model-value="updateSetting({'search.isShowHotSearch': $event})")
  .gap-top
    base-checkbox(id="setting_search_showHistory_enable" :model-value="appSetting['search.isShowHistorySearch']" :label="$t('setting__search_history')" @update:model-value="updateSetting({'search.isShowHistorySearch': $event})")
  .gap-top
    span {{ $t('setting__search_history_limit', SEARCH_HISTORY_LIMIT) }}
    base-input.gap-left(
      id="setting_search_history_limit"
      v-model="historyLimit"
      :class="$style.historyLimitInput"
      type="number"
      :min="SEARCH_HISTORY_LIMIT.min"
      :max="SEARCH_HISTORY_LIMIT.max"
      step="1"
      :aria-label="$t('setting__search_history_limit', SEARCH_HISTORY_LIMIT)"
      @change="handleHistoryLimitChange"
      @submit="handleHistoryLimitChange")
  .gap-top
    base-checkbox(id="setting_search_focusSearchBox_enable" :model-value="appSetting['search.isFocusSearchBox']" :label="$t('setting__search_focus_search_box')" @update:model-value="updateSetting({'search.isFocusSearchBox': $event})")

</template>

<script>
import { ref } from '@common/utils/vueTools'
import { SEARCH_HISTORY_LIMIT, normalizeSearchHistoryLimit } from '@common/utils/searchHistory'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { setHistoryLimit } from '@renderer/store/search/action'

export default {
  name: 'SettingSearch',
  setup() {
    const historyLimit = ref(normalizeSearchHistoryLimit(appSetting['search.historyLimit']))
    const handleHistoryLimitChange = value => {
      const limit = normalizeSearchHistoryLimit(value)
      historyLimit.value = limit
      if (limit === appSetting['search.historyLimit']) return
      void setHistoryLimit(limit)
    }

    return {
      appSetting,
      updateSetting,
      historyLimit,
      handleHistoryLimitChange,
      SEARCH_HISTORY_LIMIT,
    }
  },
}
</script>

<style lang="less" module>
.historyLimitInput {
  width: 80px;
}
</style>
