type TaskBarAction = 'collect' | 'unCollect' | 'prev' | 'play' | 'pause' | 'next'

export const createTaskBarButtonDefinitions = ({
  empty = false,
  collect = false,
  play = false,
  next = true,
  prev = true,
}: {
  empty?: boolean
  collect?: boolean
  play?: boolean
  next?: boolean
  prev?: boolean
}, onClick: (action: TaskBarAction) => void) => [
  {
    icon: collect ? 'collected' : 'collect',
    action: collect ? 'unCollect' as const : 'collect' as const,
    tooltip: collect ? '取消收藏' : '收藏',
    disabled: empty,
  },
  { icon: 'prev', action: 'prev' as const, tooltip: '上一曲', disabled: empty || !prev },
  {
    icon: play ? 'pause' : 'play',
    action: play ? 'pause' as const : 'play' as const,
    tooltip: play ? '暂停' : '播放',
    disabled: empty,
  },
  { icon: 'next', action: 'next' as const, tooltip: '下一曲', disabled: empty || !next },
].map(button => ({
  ...button,
  click: () => {
    onClick(button.action)
  },
}))
