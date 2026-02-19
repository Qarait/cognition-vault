/**
 * Schema migration engine (Phase 6).
 *
 * Design invariants:
 *   - Migrations are ordered, transactional, and idempotent
 *   - Opening a v1.0.0 vault never breaks
 *   - FTS virtual table + triggers are verified (and repaired) after every migration run
 *   - Tests can inject additional migrations via opts.migrations / opts.latest
 *     without polluting the production migration list
 */
import type Database from 'better-sqlite3'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Migration {
    version: number
    description: string
    sql: string
}

export interface MigrateOptions {
    /** Override the migration list (for testing simulated upgrades) */
    migrations?: Migration[]
    /** Override the target version (for testing simulated upgrades) */
    latest?: number
}

// ── Production schema ──────────────────────────────────────────────────────────

export const LATEST_SCHEMA_VERSION = 1

export const migrations: Migration[] = [
    {
        version: 1,
        description: 'Initial schema: ingestion_runs, raw_artifacts, threads, messages, messages_fts',
        sql: `
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
        `,
    },
]

// ── FTS DDL (applied deterministically after every migration run) ───────────

const FTS_DDL = `
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content_plain,
        content='messages',
        content_rowid='id'
    );

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
`

// ── Migrator ───────────────────────────────────────────────────────────────────

function readSchemaVersion(db: Database.Database): number {
    // If schema_meta doesn't exist yet, version is 0
    const tableExists = db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_meta'`
    ).get()
    if (!tableExists) return 0

    const row = db.prepare(
        `SELECT value FROM schema_meta WHERE key = 'schema_version'`
    ).get() as { value: string } | undefined
    return row ? parseInt(row.value, 10) : 0
}

function writeSchemaVersion(db: Database.Database, version: number): void {
    // Upsert: INSERT OR REPLACE
    db.prepare(
        `INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)`
    ).run(String(version))
}

export function migrate(db: Database.Database, opts?: MigrateOptions): void {
    const list = opts?.migrations ?? migrations
    const targetVersion = opts?.latest ?? LATEST_SCHEMA_VERSION

    const currentVersion = readSchemaVersion(db)

    // Apply pending migrations in order, each in its own transaction
    const pending = list
        .filter(m => m.version > currentVersion && m.version <= targetVersion)
        .sort((a, b) => a.version - b.version)

    for (const m of pending) {
        db.transaction(() => {
            db.exec(m.sql)
            writeSchemaVersion(db, m.version)
        })()
    }

    // ── FTS verification / repair ──────────────────────────────────────────
    // Always ensure FTS virtual table and triggers exist.
    // This is idempotent: IF NOT EXISTS handles the common case,
    // and if triggers were dropped, they get recreated.
    db.exec(FTS_DDL)

    // Mirror to PRAGMA user_version for quick inspection
    const finalVersion = readSchemaVersion(db)
    db.pragma(`user_version = ${finalVersion}`)
}
