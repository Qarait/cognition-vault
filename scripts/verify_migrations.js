/**
 * scripts/verify_migrations.js — Phase 6: Migration Qualification
 *
 * Exercises the migration engine with 5 test cases:
 *   1. Fresh DB         — no schema_meta → migrator creates schema, sets version=1
 *   2. Existing v1 DB   — migrator is a no-op, idempotent
 *   3. Simulated v1→v2  — injected canary migration, existing rows preserved
 *   4. FTS sanity        — insert message after migration, FTS MATCH returns it
 *   5. FTS repair        — drop triggers, re-run migrator, verify triggers restored
 *
 * Prerequisites: `tsc --project tsconfig.integration.json` must have run.
 *
 * exit 0 = all pass, exit 1 = failure (with report)
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// ─── Paths ─────────────────────────────────────────────────────────────────────
const DIST = path.join(__dirname, '..', 'dist-electron');
if (!fs.existsSync(path.join(DIST, 'migrations.js'))) {
    console.error('❌ dist-electron/migrations.js not found. Run tsc --project tsconfig.integration.json first.');
    process.exit(1);
}

// ─── Load compiled modules ─────────────────────────────────────────────────────
const { migrations, LATEST_SCHEMA_VERSION, migrate } = require(path.join(DIST, 'migrations.js'));
const Database = require('better-sqlite3');

// ─── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label}`);
        failed++;
    }
}

function freshDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-migrate-'));
    const dbPath = path.join(dir, 'test.db');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    return { db, dir };
}

function getSchemaVersion(db) {
    try {
        const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
        return row ? parseInt(row.value, 10) : 0;
    } catch {
        return 0;
    }
}

function triggerExists(db, name) {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
    return !!row;
}

function tableExists(db, name) {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !!row;
}

function ftsTableExists(db) {
    // FTS5 creates a virtual table — check sqlite_master
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages_fts'").get();
    return !!row;
}

function insertTestMessage(db) {
    // Insert a thread first (FK dependency)
    const thread = db.prepare(
        "INSERT INTO threads (provider, title) VALUES ('test', 'Migration Test Thread')"
    ).run();
    // Insert a message with a unique sentinel
    const sentinel = '__CV_MIGRATION_TEST_SENTINEL__';
    db.prepare(
        `INSERT INTO messages (
            thread_id, provider, role, content, content_plain, position, content_hash
        ) VALUES (?, 'test', 'user', ?, ?, 0, 'testhash')`
    ).run(thread.lastInsertRowid, sentinel, sentinel);
    return sentinel;
}

function ftsMatch(db, query) {
    try {
        return db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").all(query);
    } catch {
        return [];
    }
}

// ── Canary v2 migration (test-only, never in production) ──────────────────────
const CANARY_V2_MIGRATION = {
    version: 2,
    description: 'Test-only canary: add __cv_test_pinned column to threads',
    sql: `ALTER TABLE threads ADD COLUMN __cv_test_pinned INTEGER NOT NULL DEFAULT 0;`
};

// ═══════════════════════════════════════════════════════════════════════════════
// Test Cases
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n— Phase 6: Migration Qualification —\n');

// ── Case 1: Fresh DB ──────────────────────────────────────────────────────────
console.log('Case 1: Fresh DB (no schema → v1)');
{
    const { db } = freshDb();

    // Before: no tables at all
    assert(!tableExists(db, 'schema_meta'), 'schema_meta does not exist before migration');

    migrate(db);

    assert(tableExists(db, 'schema_meta'), 'schema_meta exists after migration');
    assert(tableExists(db, 'ingestion_runs'), 'ingestion_runs exists');
    assert(tableExists(db, 'raw_artifacts'), 'raw_artifacts exists');
    assert(tableExists(db, 'threads'), 'threads exists');
    assert(tableExists(db, 'messages'), 'messages exists');
    assert(ftsTableExists(db), 'messages_fts exists');
    assert(getSchemaVersion(db) === 1, `schema_version = 1 (got ${getSchemaVersion(db)})`);
    assert(db.pragma('user_version', { simple: true }) === 1, 'PRAGMA user_version = 1');

    db.close();
}

// ── Case 2: Existing v1 DB (idempotent) ───────────────────────────────────────
console.log('\nCase 2: Existing v1 DB (idempotent no-op)');
{
    const { db } = freshDb();
    migrate(db); // first run → v1

    // Insert some data
    const sentinel = insertTestMessage(db);
    const countBefore = db.prepare("SELECT COUNT(*) as n FROM messages").get().n;

    // Run migrator again — should be a no-op
    migrate(db);

    assert(getSchemaVersion(db) === 1, `schema_version still 1 (got ${getSchemaVersion(db)})`);
    const countAfter = db.prepare("SELECT COUNT(*) as n FROM messages").get().n;
    assert(countBefore === countAfter, `row count preserved (${countBefore} → ${countAfter})`);
    assert(ftsMatch(db, sentinel).length > 0, 'FTS still returns sentinel after idempotent re-run');

    db.close();
}

// ── Case 3: Simulated v1→v2 upgrade ──────────────────────────────────────────
console.log('\nCase 3: Simulated v1→v2 upgrade (test-injected canary)');
{
    const { db } = freshDb();
    migrate(db); // first run → v1

    // Insert a thread before upgrade to prove existing rows survive
    db.prepare("INSERT INTO threads (provider, title) VALUES ('test', 'Pre-upgrade Thread')").run();
    const rowsBefore = db.prepare("SELECT COUNT(*) as n FROM threads").get().n;

    // Extend migrations list with canary v2
    const extendedMigrations = [...migrations, CANARY_V2_MIGRATION];
    migrate(db, { migrations: extendedMigrations, latest: 2 });

    assert(getSchemaVersion(db) === 2, `schema_version = 2 after upgrade (got ${getSchemaVersion(db)})`);
    assert(db.pragma('user_version', { simple: true }) === 2, 'PRAGMA user_version = 2');

    // Verify canary column exists
    const info = db.prepare("PRAGMA table_info(threads)").all();
    const canaryCol = info.find(c => c.name === '__cv_test_pinned');
    assert(!!canaryCol, '__cv_test_pinned column exists after upgrade');
    assert(canaryCol && canaryCol.dflt_value === '0', '__cv_test_pinned default = 0');

    // Verify existing rows survived
    const rowsAfter = db.prepare("SELECT COUNT(*) as n FROM threads").get().n;
    assert(rowsBefore === rowsAfter, `existing rows preserved (${rowsBefore} → ${rowsAfter})`);

    // Verify canary column value on existing row
    const existing = db.prepare("SELECT __cv_test_pinned FROM threads WHERE title = 'Pre-upgrade Thread'").get();
    assert(existing && existing.__cv_test_pinned === 0, 'existing row has canary default value 0');

    db.close();
}

// ── Case 4: FTS sanity after migration ────────────────────────────────────────
console.log('\nCase 4: FTS sanity after migration');
{
    const { db } = freshDb();
    migrate(db);

    // Insert and immediately search via FTS
    const sentinel = insertTestMessage(db);
    const hits = ftsMatch(db, sentinel);
    assert(hits.length > 0, `FTS MATCH returns sentinel (${hits.length} hit(s))`);

    // Verify it's a real join result via the query searchMessages would use
    const fullHits = db.prepare(`
        SELECT m.content_plain, t.title
        FROM messages_fts f
        JOIN messages m ON f.rowid = m.id
        JOIN threads t ON m.thread_id = t.id
        WHERE messages_fts MATCH ?
    `).all(sentinel);
    assert(fullHits.length > 0, `Full FTS JOIN query returns sentinel (${fullHits.length} hit(s))`);

    db.close();
}

// ── Case 5: FTS Repair (drop triggers → re-run → verify recreation) ──────────
console.log('\nCase 5: FTS Repair (trigger recreation)');
{
    const { db } = freshDb();
    migrate(db);

    // Insert a message BEFORE dropping triggers
    const sentinel = insertTestMessage(db);
    assert(triggerExists(db, 'messages_ai'), 'messages_ai trigger exists before drop');
    assert(triggerExists(db, 'messages_ad'), 'messages_ad trigger exists before drop');
    assert(triggerExists(db, 'messages_au'), 'messages_au trigger exists before drop');

    // Simulate corruption: drop all FTS triggers
    db.exec("DROP TRIGGER IF EXISTS messages_ai");
    db.exec("DROP TRIGGER IF EXISTS messages_ad");
    db.exec("DROP TRIGGER IF EXISTS messages_au");
    assert(!triggerExists(db, 'messages_ai'), 'messages_ai destroyed');
    assert(!triggerExists(db, 'messages_ad'), 'messages_ad destroyed');
    assert(!triggerExists(db, 'messages_au'), 'messages_au destroyed');

    // Re-run migrator — should repair triggers
    migrate(db);

    assert(triggerExists(db, 'messages_ai'), 'messages_ai restored by migrator');
    assert(triggerExists(db, 'messages_ad'), 'messages_ad restored by migrator');
    assert(triggerExists(db, 'messages_au'), 'messages_au restored by migrator');

    // Verify FTS still works: insert a NEW message after repair
    const postRepairThread = db.prepare(
        "INSERT INTO threads (provider, title) VALUES ('test', 'Post-Repair Thread')"
    ).run();
    const postRepairSentinel = '__CV_POST_REPAIR_SENTINEL__';
    db.prepare(
        `INSERT INTO messages (
            thread_id, provider, role, content, content_plain, position, content_hash
        ) VALUES (?, 'test', 'user', ?, ?, 0, 'repairhash')`
    ).run(postRepairThread.lastInsertRowid, postRepairSentinel, postRepairSentinel);

    const postRepairHits = ftsMatch(db, postRepairSentinel);
    assert(postRepairHits.length > 0, `FTS MATCH works after trigger repair (${postRepairHits.length} hit(s))`);

    // Also verify the old sentinel is still in FTS (pre-existing data)
    const oldHits = ftsMatch(db, sentinel);
    assert(oldHits.length > 0, `Pre-repair sentinel still in FTS index (${oldHits.length} hit(s))`);

    db.close();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n— Results: ${passed} passed, ${failed} failed —\n`);

if (failed > 0) {
    console.error('❌ Migration qualification FAILED.');
    process.exit(1);
}

console.log('✅ All migration qualification tests passed.');
process.exit(0);
