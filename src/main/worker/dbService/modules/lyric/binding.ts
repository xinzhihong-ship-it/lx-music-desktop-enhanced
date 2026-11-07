import { getDB } from '../../db'

// 用户手动选定的歌词来源（“绑定”），存放在 lyric 表里，与原始/已编辑歌词靠 source 区分，
// 不需要改表结构。type 取 'binding'（不在旧版本认识的类型里，旧版本读到也只是多一个无用字段）。
const BINDING_SOURCE = 'binding'
const BINDING_TYPE = 'binding'

const createQueryStatement = () => getDB().prepare<[string]>(`
  SELECT "text"
  FROM "main"."lyric"
  WHERE "id"=? AND "source"='${BINDING_SOURCE}'
  `)
const createDeleteStatement = () => getDB().prepare<[string]>(`
  DELETE FROM "main"."lyric"
  WHERE "id"=? AND "source"='${BINDING_SOURCE}'
  `)
const createInsertStatement = () => getDB().prepare<[{ id: string, text: string }]>(`
  INSERT INTO "main"."lyric" ("id", "type", "text", "source")
  VALUES (@id, '${BINDING_TYPE}', @text, '${BINDING_SOURCE}')
  `)
const createCountStatement = () => getDB().prepare<[]>(`
  SELECT COUNT(*) as count FROM "main"."lyric" WHERE "source"='${BINDING_SOURCE}'
  `)
const createClearStatement = () => getDB().prepare<[]>(`
  DELETE FROM "main"."lyric" WHERE "source"='${BINDING_SOURCE}'
  `)

const isBinding = (value: unknown): value is LX.Music.LyricBinding => {
  if (!value || typeof value != 'object') return false
  const binding = value as Partial<LX.Music.LyricBinding>
  return typeof binding.platform == 'string' && typeof binding.songmid == 'string' &&
    !!binding.musicInfo && typeof binding.musicInfo == 'object'
}

export const getLyricBinding = (id: string): LX.Music.LyricBinding | null => {
  const row = createQueryStatement().get(id) as { text: string } | undefined
  if (!row) return null
  try {
    const binding: unknown = JSON.parse(Buffer.from(row.text, 'base64').toString())
    return isBinding(binding) ? binding : null
  } catch {
    return null
  }
}

export const saveLyricBinding = (id: string, binding: LX.Music.LyricBinding) => {
  if (!isBinding(binding)) throw new Error('invalid lyric binding')
  const text = Buffer.from(JSON.stringify(binding)).toString('base64')
  const db = getDB()
  const deleteStatement = createDeleteStatement()
  const insertStatement = createInsertStatement()
  db.transaction(() => {
    deleteStatement.run(id)
    insertStatement.run({ id, text })
  })()
}

export const removeLyricBinding = (id: string) => {
  createDeleteStatement().run(id)
}

export const lyricBindingCount = () => {
  return (createCountStatement().get() as { count: number }).count
}

export const lyricBindingClear = () => {
  createClearStatement().run()
}
