import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'

const DB_PATH = path.join(app.getPath('userData'), 'vault', 'vault.db')

let db: Database.Database

export function initDb() {
    db = new Database(DB_PATH)
    db.pragma('foreign_keys = ON')

    // Create tables
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS ingestion_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      started_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      completed_at INTEGER,
      status TEXT NOT NULL,
      source_label TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS raw_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingestion_run_id INTEGER REFERENCES ingestion_runs(id),
      parent_artifact_id INTEGER REFERENCES raw_artifacts(id),
      provider TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      filename TEXT,
      path_in_archive TEXT,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      stored_path TEXT,
      mime_type TEXT,
      imported_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_thread_id TEXT,
      title TEXT,
      created_at INTEGER,
      raw_artifact_id INTEGER REFERENCES raw_artifacts(id),
      ingestion_run_id INTEGER REFERENCES ingestion_runs(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_message_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      content_plain TEXT NOT NULL,
      timestamp INTEGER,
      position INTEGER NOT NULL,
      parent_provider_message_id TEXT,
      content_hash TEXT NOT NULL,
      raw_artifact_id INTEGER REFERENCES raw_artifacts(id),
      ingestion_run_id INTEGER REFERENCES ingestion_runs(id)
    );

    -- FTS5 External Content Table
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content_plain,
      content='messages',
      content_rowid='id'
    );

    -- FTS5 Triggers
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content_plain) VALUES (new.id, new.content_plain);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_plain) VALUES('delete', old.id, old.content_plain);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_plain) VALUES('delete', old.id, old.content_plain);
      INSERT INTO messages_fts(rowid, content_plain) VALUES (new.id, new.content_plain);
    END;
  `)

    // Initialize schema version if not exists
    const version = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version')
    if (!version) {
        db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', '1')
    }

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
