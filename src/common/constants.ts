export const URL_SCHEME_RXP = /^lxmusic:\/\//

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const STORE_NAMES = {
  APP_SETTINGS: 'config_v2',
  DATA: 'data',
  SYNC: 'sync',
  HOTKEY: 'hot_key',
  USER_API: 'user_api',
  LRC_RAW: 'lyrics',
  LRC_EDITED: 'lyrics_edited',
  THEME: 'theme',
  SOUND_EFFECT: 'sound_effect',
  ACCOUNT_SESSIONS: 'account_sessions',
  MUSIC_RECOGNITION: 'music_recognition',
} as const

export const APP_EVENT_NAMES = {
  winMainName: 'win_main',
  winLyricName: 'win_lyric',
  trayName: 'tray',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  LOVE: 'love',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
} as const

export const DATA_KEYS = {
  viewPrevState: 'viewPrevState',
  playInfo: 'playInfo',
  searchHistoryList: 'searchHistoryList',
  listScrollPosition: 'listScrollPosition',
  listPrevSelectId: 'listPrevSelectId',
  listUpdateInfo: 'listUpdateInfo',
  ignoreVersion: 'ignoreVersion',

  leaderboardSetting: 'leaderboardSetting',
  songListSetting: 'songListSetting',
  searchSetting: 'searchSetting',

  lastStartInfo: 'lastStartInfo',
} as const

export const DEFAULT_SETTING = {
  leaderboard: {
    source: 'kw',
    boardId: 'kw__16',
  },

  songList: {
    source: 'kw',
    sortId: 'new',
    tagId: '',
  },

  search: {
    temp_source: 'kw',
    source: 'all',
    type: 'music',
  },

  viewPrevState: {
    url: '/search',
    query: {},
  },
}

export const DOWNLOAD_STATUS = {
  RUN: 'run',
  WAITING: 'waiting',
  PAUSE: 'pause',
  ERROR: 'error',
  COMPLETED: 'completed',
} as const

export const QUALITYS = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'] as const

// 始终视为受支持的来源：
// - bili：自解析平台，模块自身即可提供播放地址，不依赖自定义源
// - mg：取流依赖自定义源，但自定义源未声明时仍可经现有换源链路播放（与双击播放行为一致），不应禁用菜单操作
export const ALWAYS_SUPPORTED_SOURCE_QUALITYS: Partial<Record<LX.Source, LX.Quality[]>> = {
  bili: ['128k', '192k', 'atmos', 'hires'],
  mg: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
}

export const TRAY_AUTO_ID = -1
