declare namespace LX {
  namespace DesktopLyric {
    interface Config {
      'desktopLyric.enable': LX.AppSetting['desktopLyric.enable']
      'desktopLyric.isLock': LX.AppSetting['desktopLyric.isLock']
      'desktopLyric.isAlwaysOnTop': LX.AppSetting['desktopLyric.isAlwaysOnTop']
      'desktopLyric.isAlwaysOnTopLoop': LX.AppSetting['desktopLyric.isAlwaysOnTopLoop']
      'desktopLyric.isShowTaskbar': LX.AppSetting['desktopLyric.isShowTaskbar']
      'desktopLyric.pauseHide': LX.AppSetting['desktopLyric.pauseHide']
      'desktopLyric.audioVisualization': LX.AppSetting['desktopLyric.audioVisualization']
      'desktopLyric.width': LX.AppSetting['desktopLyric.width']
      'desktopLyric.height': LX.AppSetting['desktopLyric.height']
      'desktopLyric.x': LX.AppSetting['desktopLyric.x']
      'desktopLyric.y': LX.AppSetting['desktopLyric.y']
      'desktopLyric.isLockScreen': LX.AppSetting['desktopLyric.isLockScreen']
      'desktopLyric.isHoverHide': LX.AppSetting['desktopLyric.isHoverHide']
      'desktopLyric.direction': LX.AppSetting['desktopLyric.direction']
      'desktopLyric.style.align': LX.AppSetting['desktopLyric.style.align']
      'desktopLyric.style.font': LX.AppSetting['desktopLyric.style.font']
      'desktopLyric.style.fontSize': LX.AppSetting['desktopLyric.style.fontSize']
      'desktopLyric.style.lineGap': LX.AppSetting['desktopLyric.style.lineGap']
      'desktopLyric.style.lyricUnplayColor': LX.AppSetting['desktopLyric.style.lyricUnplayColor']
      'desktopLyric.style.lyricPlayedColor': LX.AppSetting['desktopLyric.style.lyricPlayedColor']
      'desktopLyric.style.lyricShadowColor': LX.AppSetting['desktopLyric.style.lyricShadowColor']
      'desktopLyric.style.opacity': LX.AppSetting['desktopLyric.style.opacity']
      'desktopLyric.style.ellipsis': LX.AppSetting['desktopLyric.style.ellipsis']
      'desktopLyric.lineMode': LX.AppSetting['desktopLyric.lineMode']
      'desktopLyric.stageSparks': LX.AppSetting['desktopLyric.stageSparks']
      'island.expanded': LX.AppSetting['island.expanded']
      'common.langId': LX.AppSetting['common.langId']
      'player.isShowLyricTranslation': LX.AppSetting['player.isShowLyricTranslation']
      'player.isShowLyricRoma': LX.AppSetting['player.isShowLyricRoma']
      'player.isSwapLyricTranslationAndRoma': LX.AppSetting['player.isSwapLyricTranslationAndRoma']
      'player.playbackRate': LX.AppSetting['player.playbackRate']
    }

    /** 桌面歌词 / 歌词岛发给主窗口的请求；play_* 为歌词岛的播放控制 */
    type WinMainActions = 'get_info' | 'get_status' | 'get_analyser_data_array' | 'play_toggle' | 'play_prev' | 'play_next' | 'seek'

    /** 连接主窗口的客户端类型：桌面歌词窗口 / 顶部歌词岛 */
    type ClientKind = 'lyric' | 'island'

    /** 歌词岛所在屏幕：notch 为带刘海的内建屏；menuBar 为 macOS 菜单栏高度（其他系统为 0） */
    interface IslandDisplayInfo {
      notch: boolean
      menuBar: number
      /** 被拖到了固定位置（悬浮胶囊样式，不贴顶） */
      floating: boolean
    }

    /** 歌词岛拖动：dx / dy 为指针相对按下时的屏幕位移 */
    interface IslandDrag {
      phase: 'start' | 'move' | 'end'
      dx: number
      dy: number
    }

    interface LyricActionBase <A> {
      action: A
    }
    interface LyricActionData<A, D> extends LyricActionBase<A> {
      data: D
    }
    type LyricAction<A, D = undefined> = D extends undefined ? LyricActionBase<A> : LyricActionData<A, D>

    type LyricActions = LyricAction<'set_info', {
      id: string | null
      singer: string
      name: string
      album: string
      lrc: string | null
      tlrc: string | null
      rlrc: string | null
      lxlrc: string | null
      pic?: string | null
      /** 歌曲时长（秒） */
      duration?: number
      isPlay: boolean
      line: number
      played_time: number
    }>
    | LyricAction<'set_status', {
      isPlay: boolean
      line: number
      played_time: number
    }>
    | LyricAction<'set_lyric', {
      lrc: string | null
      tlrc: string | null
      rlrc: string | null
      lxlrc: string | null
    }>
    | LyricAction<'set_offset', number>
    | LyricAction<'set_playbackRate', number>
    | LyricAction<'set_play', number>
    | LyricAction<'set_pause'>
    | LyricAction<'set_stop'>
    | LyricAction<'send_analyser_data_array', Uint8Array>
    | LyricAction<'set_pic', string | null>
    | LyricAction<'set_duration', number>


    interface NewBounds {
      x: number
      y: number
      w: number
      h: number
    }
  }
}
