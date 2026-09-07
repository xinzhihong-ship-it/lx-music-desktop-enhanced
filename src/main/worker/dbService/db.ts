import Database from 'better-sqlite3'
import path from 'node:path'
import tables, { DB_VERSION } from './tables'
import verifyDB from './verifyDB'
import migrateData from './migrate'

let db: Database.Database

const DATABASE_FILE_NAME = 'lx.data.db'

const isPathInside = (root: string, candidate: string) => {
  const relativePath = path.relative(path.resolve(root), path.resolve(candidate))
  return relativePath === '' || (
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const initTables = (db: Database.Database) => {
  const createTables = db.transaction(() => {
    for (const sql of tables.values()) {
      const statement = db.prepare(sql)
      statement.run()
    }
    db.prepare(
      'INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (?, ?)',
    ).run('version', DB_VERSION)
  })
  createTables()
}

// 打开、初始化数据库
export const init = (lxDataPath: string): boolean | null => {
  const dataRoot = path.resolve(lxDataPath)
  const databasePath = path.resolve(dataRoot, DATABASE_FILE_NAME)
  if (!isPathInside(dataRoot, databasePath) || path.basename(databasePath) !== DATABASE_FILE_NAME) {
    throw new Error('数据库路径无效')
  }
  const nativeBinding = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  let dbFileExists = true

  try {
    db = new Database(databasePath, {
      fileMustExist: true,
      nativeBinding,
      // verbose: process.env.NODE_ENV !== 'production' ? console.log : undefined,
    })
  } catch (error) {
    console.log(error)
    db = new Database(databasePath, {
      nativeBinding,
      // verbose: process.env.NODE_ENV !== 'production' ? console.log : undefined,
    })
    initTables(db)
    dbFileExists = false
  }
  db.pragma('journal_mode = WAL')

  if (dbFileExists) migrateData(db)

  // https://www.sqlite.org/pragma.html#pragma_optimize
  if (dbFileExists) db.prepare('PRAGMA optimize;').run()
  if (!verifyDB(db)) {
    db.close()
    return null
  }

  // https://www.sqlite.org/lang_vacuum.html
  // VACUUM is intentionally not run during startup.

  process.on('exit', () => db.close())
  console.log('db inited')
  // require('./test')
  return dbFileExists
}

// 获取数据库实例
export const getDB = (): Database.Database => db
