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

export interface ScoreParts {
  title: number
  singer: number
  duration: number
  /** 时长相差超过 10 秒：不自动采用（Live / 剪辑版等），搜索面板里排在后面 */
  durationMismatch: boolean
}

export const scoreParts = (query: MatchSubject, candidate: MatchSubject): ScoreParts => {
  let duration = 5
  let durationMismatch = false
  if (query.duration > 0 && candidate.duration > 0) {
    const gap = Math.abs(query.duration - candidate.duration)
    durationMismatch = gap > MAX_DURATION_GAP
    duration = gap <= 2 ? 20 : gap <= 5 ? 10 : 0
  }
  return {
    title: titleScore(normalizeTitle(query.name), normalizeTitle(candidate.name)),
    singer: singerScore(normalizeSingers(query.singer), normalizeSingers(candidate.singer)),
    duration,
    durationMismatch,
  }
}

/** 返回 0~85 的分数；时长相差超过 10 秒返回 null（淘汰，不参与自动匹配） */
export const scoreCandidate = (query: MatchSubject, candidate: MatchSubject): number | null => {
  const parts = scoreParts(query, candidate)
  if (parts.durationMismatch) return null
  return parts.title + parts.singer + parts.duration
}

/**
 * 搜索面板里的排序分：歌名对得上的永远排在歌名对不上的前面；
 * 时长差太大（Live 等版本）不淘汰，只是不加时长分、排在同歌名的完整匹配之后。
 */
export const relevanceScore = (parts: ScoreParts) => (parts.title > 0 ? 100 : 0) + parts.title + parts.singer + (parts.durationMismatch ? 0 : parts.duration)

const normalizeSingersRaw = (singer: string) => (singer || '').split(SINGER_SPLIT_RXP).map(s => s.trim()).filter(Boolean)

/** 搜索关键词：歌名 + 第一位歌手 */
export const buildSearchKeyword = (subject: Pick<MatchSubject, 'name' | 'singer'>) => {
  const singer = normalizeSingersRaw(subject.singer)[0] ?? ''
  return `${(subject.name || '').trim()} ${singer}`.trim()
}
