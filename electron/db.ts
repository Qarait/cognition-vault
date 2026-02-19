import Database from 'better-sqlite3'
import { paths } from './paths'
import { migrate } from './migrations'

let db: Database.Database

export function initDb() {
  db = new Database(paths().dbPath)
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function searchMessages(query: string) {
  const db = getDb()
  // Search normalized content using FTS5 and join with threads for context
  return db.prepare(`
    SELECT 
      m.id, 
      m.thread_id, 
      m.content, 
      m.role, 
      m.timestamp,
      t.title as thread_title,
      t.provider
    FROM messages_fts f
    JOIN messages m ON f.rowid = m.id
    JOIN threads t ON m.thread_id = t.id
    WHERE messages_fts MATCH ?
    ORDER BY rank
  `).all(query)
}

export function getDb() {
  if (!db) initDb()
  return db
}
