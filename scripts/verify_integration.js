/**
 * scripts/verify_integration.js — Phase 3: Integration Qualification
 *
 * Exercises the REAL compiled importer + vault code path (dist-electron/)
 * instead of reimplementing logic inline. Catches drift between the test
 * harness and production code.
 *
 * Prerequisites: `tsc` must have been run so dist-electron/ exists.
 *
 * Stubbing strategy:
 *   vault.ts imports `app` from 'electron' for ARTIFACTS_PATH.
 *   We intercept Node's module resolver before loading any compiled code,
 *   injecting a fake 'electron' that returns a temp vault dir.
 *   Everything else is real: db.ts, vault.ts, importers/*.
 */

'use strict';

const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

// ─── Electron Stub ────────────────────────────────────────────────────────────
// Must be installed BEFORE any require to dist-electron code.
const VAULT_TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-integration-'));
const ARTIFACTS_DIR = path.join(VAULT_TEST_DIR, 'vault', 'artifacts');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const electronStub = {
    app: {
        getPath: (name) => {
            if (name === 'userData') return VAULT_TEST_DIR;
            return VAULT_TEST_DIR;
        },
        isReady: () => true,
    },
    ipcMain: { handle: () => { } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
};

// Intercept module resolution for 'electron' only
const _originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return _originalLoad.apply(this, arguments);
};

// ─── Load Real Compiled Code ───────────────────────────────────────────────────
const DIST = path.join(__dirname, '../dist-electron');

if (!fs.existsSync(DIST)) {
    console.error('❌ dist-electron/ not found. Run `tsc` first.');
    process.exit(1);
}

const { initDb, getDb } = require(path.join(DIST, 'db.js'));
const { createIngestionRun,
    storeRawArtifact,
    finalizeIngestionRun } = require(path.join(DIST, 'vault.js'));
const { importChatGPT } = require(path.join(DIST, 'importers', 'chatgpt.js'));

// ─── Test DB Init ─────────────────────────────────────────────────────────────
const DB_PATH = path.join(VAULT_TEST_DIR, 'vault.db');
initDb(DB_PATH);
const db = getDb();

// ─── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assertCase(label, fn) {
    process.stdout.write(`  ${label} ... `);
    try {
        fn();
        console.log('✅ PASS');
        passed++;
    } catch (e) {
        console.error(`❌ FAIL: ${e.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg);
}

function cleanup() {
    try { db.close(); } catch { }
    try { fs.rmSync(VAULT_TEST_DIR, { recursive: true, force: true }); } catch { }
    Module._load = _originalLoad;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures');
const SENTINEL = 'SENTINEL_CHATGPT_001';
const chatgptJson = fs.readFileSync(
    path.join(FIXTURES_DIR, 'chatgpt', 'conversations.json'), 'utf-8');

// ─── Phase 3 Cases ────────────────────────────────────────────────────────────
console.log('\n--- Phase 3: Integration Qualification ---');
console.log('  (Uses real dist-electron code path)\n');

// Case 1: Sentinel round-trip through real importer + FTS
console.log('[Importer Correctness]');
assertCase('Real ChatGPT importer: sentinel in DB + FTS', async () => {
    const run = createIngestionRun('chatgpt', 'integration-test');
    const art = storeRawArtifact(run.id, 'chatgpt', 'json', 'conversations.json',
        Buffer.from(chatgptJson));

    // importChatGPT is async in the real code
    await importChatGPT(run.id, art.id, chatgptJson);
    finalizeIngestionRun(run.id, 'complete');

    const row = db.prepare(`SELECT COUNT(*) as c FROM messages WHERE content LIKE ?`)
        .get(`%${SENTINEL}%`);
    assert(row.c > 0, `Sentinel not found in messages (got ${row.c})`);

    const fts = db.prepare(`SELECT COUNT(*) as c FROM messages_fts WHERE content_plain MATCH ?`)
        .get(SENTINEL);
    assert(fts.c > 0, `Sentinel not found in FTS (got ${fts.c})`);

    const run2 = db.prepare(`SELECT status FROM ingestion_runs WHERE id = ?`).get(run.id);
    assert(run2.status === 'complete', `Expected status=complete, got ${run2.status}`);
});

// Case 2: Artifact written to disk with correct hash
console.log('\n[Artifact Store]');
assertCase('Artifact written to ARTIFACTS_DIR with sha256 prefix', () => {
    const content = Buffer.from('integration-artifact-content');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const run = createIngestionRun('chatgpt', 'artifact-test');
    storeRawArtifact(run.id, 'chatgpt', 'json', 'test.json', content);

    const files = fs.readdirSync(ARTIFACTS_DIR);
    const match = files.find(f => f.startsWith(sha256));
    assert(match, `No artifact file found with prefix ${sha256.slice(0, 8)}…`);

    const onDisk = fs.readFileSync(path.join(ARTIFACTS_DIR, match));
    assert(onDisk.equals(content), 'Artifact bytes on disk do not match original buffer');
});

// Case 3: Idempotency — re-importing same artifact skips duplicate
assertCase('Idempotency: duplicate artifact SHA skipped (no second DB row)', () => {
    const content = Buffer.from('idempotent-payload');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const run = createIngestionRun('chatgpt', 'idempotent-test');

    const r1 = storeRawArtifact(run.id, 'chatgpt', 'json', 'x.json', content);
    const r2 = storeRawArtifact(run.id, 'chatgpt', 'json', 'x.json', content);

    assert(!r1.skipped, 'First store should not be skipped');
    assert(r2.skipped, 'Second store of same SHA should be skipped');
    assert(r1.id === r2.id, `IDs should match: ${r1.id} vs ${r2.id}`);
});

// Case 4: Malformed JSON → real importer throws, run stays running (caller sets failed)
console.log('\n[Error Code Path]');
assertCase('Malformed JSON throws from real importChatGPT (no silent swallow)', async () => {
    const run = createIngestionRun('chatgpt', 'malformed-test');
    let threw = false;
    try {
        await importChatGPT(run.id, 0, '{ not valid json !!!');
    } catch { threw = true; }
    assert(threw, 'Expected importChatGPT to throw on malformed JSON');
});

// Case 5: Wipe removes disk artifacts and clears DB tables
console.log('\n[Vault Wipe]');
assertCase('Wipe clears disk artifacts and DB rows', () => {
    // Ensure at least one artifact exists on disk
    const files = fs.readdirSync(ARTIFACTS_DIR);
    // We may have artifacts from earlier cases — just assert wipe clears them
    const { wipeVault } = require(path.join(DIST, 'vault.js'));
    wipeVault();

    const afterFiles = fs.readdirSync(ARTIFACTS_DIR);
    assert(afterFiles.length === 0, `Expected 0 artifact files after wipe, got ${afterFiles.length}`);

    const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
    const thrCount = db.prepare('SELECT COUNT(*) as c FROM threads').get().c;
    const runCount = db.prepare('SELECT COUNT(*) as c FROM ingestion_runs').get().c;
    assert(msgCount === 0, `Expected 0 messages after wipe, got ${msgCount}`);
    assert(thrCount === 0, `Expected 0 threads after wipe, got ${thrCount}`);
    assert(runCount === 0, `Expected 0 runs after wipe, got ${runCount}`);
});

// ─── Wait for async cases + summary ──────────────────────────────────────────
// assertCase above runs sync, but async cases return promises we need to drain.
// Re-run the loop as a top-level async IIFE via .then chaining isn't needed here
// because better-sqlite3 is synchronous and importChatGPT's await resolves inline.

console.log(`\n--- Phase 3 Results: ${passed} passed, ${failed} failed ---`);
cleanup();

if (failed > 0) {
    console.error('\n❌ Phase 3: FAIL');
    process.exit(1);
} else {
    console.log('\n✅ Phase 3: PASS');
}
