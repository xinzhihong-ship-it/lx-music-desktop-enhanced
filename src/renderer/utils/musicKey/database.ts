import { formatKeyLabel, getCamelotCode, type NoteName } from './ksAlgorithm'

interface CuratedSong {
  name: string
  singer: string
  key: NoteName
  scale: LX.SongKey.Scale
}

export const normalizeSongKeyIdentifier = (name: string, singer: string): string => {
  const cleanName = (name ?? '')
    .toLowerCase()
    .replace(/\s*[(（].*?[)）]\s*/g, '')
    .replace(/\s+/g, '')
    .trim()
  const cleanSinger = (singer ?? '')
    .toLowerCase()
    .replace(/\s*[(（].*?[)）]\s*/g, '')
    .replace(/\s+/g, '')
    .trim()
  return `${cleanName}__${cleanSinger}`
}

// 常见热门经典/K歌伴奏基调库（标准化原调）
const CURATED_DATABASE: CuratedSong[] = [
  { name: '晴天', singer: '周杰伦', key: 'G', scale: 'major' },
  { name: '七里香', singer: '周杰伦', key: 'D#', scale: 'major' }, // 降E
  { name: '青花瓷', singer: '周杰伦', key: 'A', scale: 'major' },
  { name: '稻香', singer: '周杰伦', key: 'A', scale: 'major' },
  { name: '不能说的秘密', singer: '周杰伦', key: 'D', scale: 'major' },
  { name: '花海', singer: '周杰伦', key: 'C', scale: 'major' },
  { name: '告白气球', singer: '周杰伦', key: 'B', scale: 'major' },
  { name: '安静', singer: '周杰伦', key: 'A#', scale: 'major' }, // 降B
  { name: '枫', singer: '周杰伦', key: 'E', scale: 'major' },
  { name: '夜曲', singer: '周杰伦', key: 'A#', scale: 'minor' }, // Bbm
  { name: '十年', singer: '陈奕迅', key: 'G#', scale: 'major' }, // 降A
  { name: '富士山下', singer: '陈奕迅', key: 'D', scale: 'major' },
  { name: '爱情转移', singer: '陈奕迅', key: 'D', scale: 'major' },
  { name: '红豆', singer: '王菲', key: 'C', scale: 'major' },
  { name: '江南', singer: '林俊杰', key: 'A#', scale: 'minor' },
  { name: '可惜没如果', singer: '林俊杰', key: 'C', scale: 'major' },
  { name: '修炼爱情', singer: '林俊杰', key: 'C#', scale: 'major' },
  { name: '演员', singer: '薛之谦', key: 'B', scale: 'major' },
  { name: '丑八怪', singer: '薛之谦', key: 'G#', scale: 'minor' },
  { name: '起风了', singer: '买辣椒也用券', key: 'B', scale: 'major' },
  { name: '小幸运', singer: '田馥甄', key: 'F', scale: 'major' },
  { name: '光年之外', singer: 'G.E.M.邓紫棋', key: 'D', scale: 'minor' },
  { name: '泡沫', singer: 'G.E.M.邓紫棋', key: 'C', scale: 'major' },
  { name: '年少有为', singer: '李荣浩', key: 'D', scale: 'major' },
  { name: '李白', singer: '李荣浩', key: 'E', scale: 'major' },
  { name: '消愁', singer: '毛不易', key: 'D', scale: 'major' },
  { name: '像我这样的人', singer: '毛不易', key: 'C', scale: 'major' },
  { name: '平凡之路', singer: '朴树', key: 'D', scale: 'major' },
  { name: '匆匆那年', singer: '王菲', key: 'C', scale: 'major' },
  { name: '如愿', singer: '王菲', key: 'A#', scale: 'major' },
  { name: '同桌的你', singer: '老狼', key: 'D', scale: 'major' },
  { name: '夜空中最亮的星', singer: '逃跑计划', key: 'B', scale: 'major' },
  { name: '海阔天空', singer: 'Beyond', key: 'F', scale: 'major' },
  { name: '光辉岁月', singer: 'Beyond', key: 'D', scale: 'major' },
]

const databaseMap = new Map<string, CuratedSong>()
for (const item of CURATED_DATABASE) {
  databaseMap.set(normalizeSongKeyIdentifier(item.name, item.singer), item)
}

export const findDatabaseSongKey = (name: string, singer: string): LX.SongKey.KeyInfo | null => {
  if (!name) return null
  const id = normalizeSongKeyIdentifier(name, singer)
  const found = databaseMap.get(id)
  if (!found) {
    // Also try fuzzy matching with just the name if singer contains or matches
    for (const [key, item] of databaseMap.entries()) {
      if (key.startsWith(normalizeSongKeyIdentifier(name, ''))) {
        return {
          key: item.key,
          scale: item.scale,
          label: formatKeyLabel(item.key, item.scale),
          camelot: getCamelotCode(item.key, item.scale),
          source: 'database',
          confidence: 0.95,
        }
      }
    }
    return null
  }
  return {
    key: found.key,
    scale: found.scale,
    label: formatKeyLabel(found.key, found.scale),
    camelot: getCamelotCode(found.key, found.scale),
    source: 'database',
    confidence: 0.98,
  }
}
