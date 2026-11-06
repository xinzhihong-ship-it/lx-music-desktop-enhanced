// 歌词候选的匹配打分（纯函数，便于测试）。
// 满分 85：歌名 40 + 歌手 25 + 时长 20；时长差超过 10 秒直接淘汰。
// 自动采用的门槛为 AUTO_MATCH_SCORE（必须有歌手匹配：歌名 40 + 时长 20 不够），低于它只在搜索面板里列出，由用户决定。

export interface MatchSubject {
  name: string
  singer: string
  album?: string
  /** 时长（秒），0 表示未知 */
  duration: number
}

export const AUTO_MATCH_SCORE = 65
const MAX_DURATION_GAP = 10

// 括号里这些字样只是版本注释，比较歌名时去掉；Remix / Cover 等是不同版本，保留
const VERSION_NOTE_RXP = /[(（[【「『<《]\s*(?:live|现场|現場|伴奏|纯音乐|純音樂|instrumental|inst\.?|off vocal|伴唱|铃声|鈴聲|完整版|正式版|原版|官方版|高音质|无损|無損|mv版?|radio edit|explicit|clean)[^)）\]】」』>》]*[)）\]】」』>》]/giu
const FEAT_RXP = /\s*[(（[]?\s*(?:feat\.?|ft\.?|featuring)\s+[^)）\]]*[)）\]]?/giu
const SYMBOL_RXP = /[\s\p{P}\p{S}]/gu
const SINGER_SPLIT_RXP = /\s*(?:、|&|＆|;|；|\/|／|,|，|\||\bx\b|\bfeat\.?|\bft\.?|\bvs\.?|\band\b|和|与|與)\s*/iu

/** 全角转半角、小写、去掉版本注释和标点空白 */
export const normalizeTitle = (title: string) => {
  return (title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(VERSION_NOTE_RXP, '')
    .replace(FEAT_RXP, '')
    .replace(SYMBOL_RXP, '')
}

export const normalizeSingers = (singer: string): string[] => {
  const names = (singer || '')
    .normalize('NFKC')
    .toLowerCase()
    .split(SINGER_SPLIT_RXP)
    .map(name => name.replace(SYMBOL_RXP, ''))
    .filter(Boolean)
  return [...new Set(names)]
}

/** "03:45" / "1:02:03" / 秒数 → 秒 */
export const parseDuration = (value: string | number | null | undefined) => {
  if (typeof value == 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  if (!value) return 0
  let total = 0
  for (const part of String(value).split(':')) {
    const n = parseInt(part)
    if (Number.isNaN(n)) return 0
    total = total * 60 + n
  }
  return total
}

const titleScore = (query: string, candidate: string) => {
  if (!query || !candidate) return 0
  if (query == candidate) return 40
  const [short, long] = query.length < candidate.length ? [query, candidate] : [candidate, query]
  // 太短的包含关系（单字）不算
  return short.length >= 2 && long.includes(short) ? 25 : 0
}

const singerScore = (query: string[], candidate: string[]) => {
  if (!query.length) return 12
  if (!candidate.length) return 0
  return query.some(name => candidate.some(other => other == name || (name.length >= 2 && other.includes(name)) || (other.length >= 2 && name.includes(other))))
    ? 25
    : 0
}

/** 返回 0~85 的分数；时长相差超过 10 秒返回 null（淘汰） */
export const scoreCandidate = (query: MatchSubject, candidate: MatchSubject): number | null => {
  let duration = 5
  if (query.duration > 0 && candidate.duration > 0) {
    const gap = Math.abs(query.duration - candidate.duration)
    if (gap > MAX_DURATION_GAP) return null
    duration = gap <= 2 ? 20 : gap <= 5 ? 10 : 0
  }
  return titleScore(normalizeTitle(query.name), normalizeTitle(candidate.name)) +
    singerScore(normalizeSingers(query.singer), normalizeSingers(candidate.singer)) +
    duration
}

const normalizeSingersRaw = (singer: string) => (singer || '').split(SINGER_SPLIT_RXP).map(s => s.trim()).filter(Boolean)

/** 搜索关键词：歌名 + 第一位歌手 */
export const buildSearchKeyword = (subject: Pick<MatchSubject, 'name' | 'singer'>) => {
  const singer = normalizeSingersRaw(subject.singer)[0] ?? ''
  return `${(subject.name || '').trim()} ${singer}`.trim()
}
