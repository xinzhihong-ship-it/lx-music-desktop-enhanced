<template>
  <nav :class="$style.menu" :aria-label="$t('ui__navigation')">
    <ul :class="$style.list">
      <li v-for="item in menus" :key="item.to" :class="[$style.navItem, { [$style.library]: item.name === 'List', [$style.settings]: item.name === 'Setting' }]">
        <router-link :class="[$style.link, {[$style.active]: $route.meta.name == item.name}]" :aria-current="$route.meta.name == item.name ? 'page' : undefined" :to="item.to" :aria-label="item.tips">
          <svg fill="currentColor" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" :viewBox="item.iconSize" :height="item.size" :width="item.size" space="preserve">
            <use :xlink:href="item.icon" />
          </svg>
          <span>{{ item.tips }}</span>
        </router-link>
      </li>
    </ul>
  </nav>
</template>

<script lang="ts">
import { appSetting } from '@renderer/store/setting'
import { useI18n } from '@root/lang'
import { computed } from '@common/utils/vueTools'

export default {
  name: 'NavBar',
  setup() {
    const t = useI18n()


    const menus = computed(() => {
      const size = 19
      return [
        {
          to: '/search',
          tips: t('search'),
          icon: '#icon-search-2',
          iconSize: '0 0 425.2 425.2',
          size,
          name: 'Search',
          enable: true,
        },
        {
          to: '/songList/list',
          tips: t('song_list'),
          icon: '#icon-album',
          iconSize: '0 0 425.2 425.2',
          size,
          name: 'SongList',
          enable: true,
        },
        {
          to: '/leaderboard',
          tips: t('leaderboard'),
          icon: '#icon-leaderboard',
          iconSize: '0 0 425.22 425.2',
          size,
          name: 'Leaderboard',
          enable: true,
        },
        {
          to: '/platformMusic',
          tips: t('account__platform_music'),
          icon: '#icon-music',
          iconSize: '0 0 24 24',
          size,
          name: 'PlatformMusic',
          enable: true,
        },
        {
          to: '/musicRecognition',
          tips: t('music_recognition'),
          icon: '#icon-audio-wave',
          iconSize: '0 0 24 24',
          size,
          name: 'MusicRecognition',
          enable: true,
        },
        {
          to: '/list',
          tips: t('my_list'),
          icon: '#icon-love',
          iconSize: '0 0 444.87 391.18',
          size,
          name: 'List',
          enable: true,
        },
        {
          to: '/download',
          tips: t('download'),
          icon: '#icon-download-2',
          iconSize: '0 0 425.2 425.2',
          size,
          enable: appSetting['download.enable'],
          name: 'Download',
        },
        {
          to: '/setting',
          tips: t('setting'),
          icon: '#icon-setting',
          iconSize: '0 0 493.23 436.47',
          size,
          enable: true,
          name: 'Setting',
        },
      ].filter(m => m.enable)
    })
    return {
      appSetting,
      menus,
    }
  },
}
</script>

<style lang="less" module>
.menu { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 14px; -webkit-app-region: no-drag; }
.list { display: flex; flex-direction: column; min-height: 100%; gap: 5px; }
.navItem { flex: none; }
.library { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--ui-border); }
.settings { margin-top: auto; padding-top: 22px; }
.link {
  display: flex; align-items: center; gap: 12px; position: relative;
  min-height: 43px; box-sizing: border-box; padding: 10px 13px; border-radius: 12px;
  color: var(--ui-muted); text-decoration: none; font-size: 12px; line-height: 1.4;
  transition: background-color .2s ease, color .2s ease;
  svg { flex: none; fill: currentColor; }
  span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  &:hover { color: var(--ui-text); background: var(--ui-hover); }
  &.active { color: var(--color-primary-font); background: var(--ui-selected); font-weight: 600; }
  &.active:after { content: ''; width: 4px; height: 4px; border-radius: 50%; background: currentColor; margin-left: auto; flex: none; }
}
@media (max-width: 980px) {
  .menu { padding: 0 7px 12px; }
  .link { justify-content: center; padding: 12px 0; min-height: 44px; span { display: none; } &.active:after { display: none; } }
  .library { margin-top: 9px; padding-top: 9px; }
  .settings { padding-top: 12px; }
}
</style>
