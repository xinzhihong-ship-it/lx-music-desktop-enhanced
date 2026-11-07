<template>
  <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut">
    <div v-show="props.visible" :class="$style.noitem">
      <section :class="$style.welcome">
        <div :class="$style.intro">
          <span :class="$style.eyebrow">LX MUSIC / YOUR DAILY SOUNDTRACK</span>
          <h1>{{ $t('ui__welcome_title') }}</h1>
          <p>{{ $t('ui__welcome_subtitle') }}</p>
          <div :class="$style.shortcuts">
            <button type="button" @click="router.push('/list')">{{ $t('my_list') }} <span aria-hidden="true">↗</span></button>
            <button type="button" @click="router.push('/platformMusic')">{{ $t('account__platform_music') }} <span aria-hidden="true">↗</span></button>
            <button type="button" @click="router.push('/musicRecognition')">{{ $t('music_recognition') }} <span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <div :class="$style.art" aria-hidden="true"><div :class="$style.record"><span>LX / 01</span></div></div>
      </section>
      <div v-if="appSetting['search.isShowHotSearch'] || (appSetting['search.isShowHistorySearch'] && historyList.length)" class="scroll" :class="$style.noitemListContainer">
        <dl v-if="appSetting['search.isShowHotSearch']" :class="[$style.noitemList, $style.noitemHotSearchList]">
          <dt :class="$style.noitemListTitle">{{ $t('search__hot_search') }}</dt>
          <dd v-for="(item, index) in hotSearchList" :key="index" :class="$style.noitemListItem" @click="handleSearch(item)">{{ item }}</dd>
        </dl>
        <dl v-if="appSetting['search.isShowHistorySearch'] && historyList.length" :class="$style.noitemList">
          <dt :class="$style.noitemListTitle">
            <span>{{ $t('history_search') }}</span><span :class="$style.historyClearBtn" :aria-label="$t('history_clear')" @click="clearHistoryList">
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 512 512" space="preserve">
                <use xlink:href="#icon-eraser" />
              </svg></span>
          </dt>
          <dd v-for="(item, index) in historyList" :key="index + item" :class="$style.noitemListItem" :aria-label="$t('history_remove')" @contextmenu="removeHistoryWord(index)" @click="handleSearch(item)">{{ item }}</dd>
        </dl>
      </div>

    </div>
  </transition>
</template>

<script setup>
import { watch, shallowRef } from '@common/utils/vueTools'
import { historyList } from '@renderer/store/search/state'
import { getHistoryList, removeHistoryWord, clearHistoryList } from '@renderer/store/search/action'
import { getList } from '@renderer/store/hotSearch'
import { appSetting } from '@renderer/store/setting'
import { useRouter } from '@common/utils/vueRouter'

const props = defineProps({
  visible: Boolean,
  source: {
    type: String,
    required: true,
  },
})

const hotSearchList = shallowRef([])

if (appSetting['search.isShowHotSearch']) {
  watch(() => props.visible, (visible) => {
    if (!visible) return
    void getList(props.source).then(list => {
      hotSearchList.value = list
    })
  }, {
    immediate: true,
  })

  watch(() => props.source, (source) => {
    if (!props.visible) return
    void getList(source).then(list => {
      if (source != props.source) return
      hotSearchList.value = list
    })
  })
}

if (appSetting['search.isShowHistorySearch']) {
  void getHistoryList()
}

const router = useRouter()
const handleSearch = (text) => {
  void router.replace({
    path: '/search',
    query: {
      text,
    },
  })
}

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.noitem { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: auto; padding: 20px; box-sizing: border-box; gap: 22px; }
.welcome { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) 30%; min-height: 218px; border: 1px solid var(--ui-border); border-radius: 18px; overflow: hidden; background: var(--ui-canvas); }
.intro { padding: 28px; align-self: center;
  h1 { font-size: 27px; font-weight: 600; letter-spacing: -1px; margin-top: 15px; color: var(--ui-text); }
  p { font-size: 11px; margin-top: 12px; color: var(--ui-muted); line-height: 1.8; }
}
.eyebrow { font-size: 8px; letter-spacing: 1.6px; color: var(--ui-muted); }
.shortcuts { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 23px;
  button { display: inline-flex; align-items: center; gap: 13px; border: 1px solid var(--ui-border); border-radius: 18px; padding: 7px 12px; background: var(--ui-surface); color: var(--ui-text); font-size: 10px; cursor: pointer;
    &:hover { color: var(--color-primary-font); border-color: var(--color-primary-alpha-600); }
    span { color: var(--ui-muted); }
  }
}
.art { display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; background: radial-gradient(ellipse at bottom right, var(--color-primary-alpha-800), transparent 75%); }
.record { width: 160px; height: 160px; border-radius: 50%; background: repeating-radial-gradient(circle, var(--color-font) 0, var(--color-font) 1px, var(--color-800) 2px, var(--color-font) 3px); transform: rotate(-20deg); box-shadow: 10px 15px 30px rgba(0, 0, 0, .12); display: flex; align-items: center; justify-content: center;
  span { width: 58px; height: 58px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--ui-text); background: var(--ui-canvas); font-size: 9px; letter-spacing: 1px; }
}
.noitemListContainer { flex: auto; min-height: 0; }
.noitemList { padding: 0 5px; + .noitemList { margin-top: 23px; } }
.noitemHotSearchList { min-height: 80px; }
.noitemListTitle { color: var(--ui-text); padding: 0 0 12px; font-size: 13px; font-weight: 600; }
.noitemListItem { display: inline-block; margin: 3px 7px 5px 0; background: var(--ui-canvas); border: 1px solid var(--ui-border); padding: 8px 13px; border-radius: 18px; cursor: pointer; color: var(--ui-muted); .mixin-ellipsis-1(); max-width: 160px; font-size: 11px;
  &:hover { color: var(--color-primary-font); background: var(--ui-selected); }
}
.historyClearBtn { padding: 4px; margin-left: 8px; color: var(--ui-muted); cursor: pointer; svg { width: 13px; vertical-align: middle; } &:hover { color: var(--color-primary-font); } }
@media (max-width: 1100px) { .welcome { grid-template-columns: minmax(0, 1fr) 24%; } .intro { padding: 24px; h1 { font-size: 25px; } } .record { width: 135px; height: 135px; margin-left: 22px; } }
</style>
