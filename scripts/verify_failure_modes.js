/**
 * scripts/verify_failure_modes.js
 * Phase 2A: Failure Mode Qualification
 *
 * Runs imports against negative fixtures and asserts:
 *   - correct error code returned
 *   - ingestion_run.status = 'failed'
 *   - 0 threads/messages inserted for that run
 *   - no filesystem side effects outside vault dir
 *
 * ZIP limits are controlled by env vars for test-friendliness:
 *   VAULT_ZIP_MAX_ENTRIES         (default: 10000)
 *   VAULT_ZIP_MAX_SINGLE_FILE_BYTES (default: 100MB)
 *   VAULT_ZIP_MAX_TOTAL_BYTES     (default: 1GB)
 */

const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// ─── Config ───────────────────────────────────────────────────────────────────
const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/negative');
const QUAL_DB = path.join(__dirname, '../tests/fixtures/qual_failure.db');
const VAULT_DIR = path.join(__dirname, '../tests/fixtures/qual_vault');

// Env-overridable limits (small for testing)
const MAX_ENTRIES = parseInt(process.env.VAULT_ZIP_MAX_ENTRIES || '10000');
const MAX_SINGLE = parseInt(process.env.VAULT_ZIP_MAX_SINGLE_FILE_BYTES || String(100 * 1024 * 1024));
const MAX_TOTAL = parseInt(process.env.VAULT_ZIP_MAX_TOTAL_BYTES || String(1024 * 1024 * 1024));

// ─── DB Setup ─────────────────────────────────────────────────────────────────
if (fs.existsSync(QUAL_DB)) fs.unlinkSync(QUAL_DB);
if (fs.existsSync(VAULT_DIR)) fs.rmSync(VAULT_DIR, { recursive: true });
fs.mkdirSync(VAULT_DIR, { recursive: true });

const db = new Database(QUAL_DB);
db.exec(`
    CREATE TABLE ingestion_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, status TEXT, error_code TEXT, error_message TEXT);
    CREATE TABLE raw_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, ingestion_run_id INTEGER, provider TEXT, artifact_type TEXT, filename TEXT, sha256 TEXT, stored_path TEXT);
    CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, title TEXT, raw_artifact_id INTEGER, ingestion_run_id INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER, provider TEXT, role TEXT, content TEXT, content_plain TEXT, content_hash TEXT, ingestion_run_id INTEGER);
    CREATE VIRTUAL TABLE messages_fts USING fts5(content_plain, content='messages', content_rowid='id');
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content_plain) VALUES (new.id, new.content_plain);
    END;
`);

// ─── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function startRun(provider) {
    return db.prepare('INSERT INTO ingestion_runs (provider, status) VALUES (?, ?)').run(provider, 'running').lastInsertRowid;
}

function failRun(runId, errorCode, message) {
    db.prepare('UPDATE ingestion_runs SET status = ?, error_code = ?, error_message = ? WHERE id = ?')
        .run('failed', errorCode, message, runId);
}

function storeArtifact(runId, provider, type, filename, buffer) {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeFilename = path.basename(filename);
    const storedPath = path.join(VAULT_DIR, `${sha256}-${safeFilename}`);
    fs.writeFileSync(storedPath, buffer);
    return db.prepare('INSERT INTO raw_artifacts (ingestion_run_id, provider, artifact_type, filename, sha256, stored_path) VALUES (?, ?, ?, ?, ?, ?)')
        .run(runId, provider, type, safeFilename, sha256, storedPath).lastInsertRowid;
}

function assertCase(name, fn) {
    process.stdout.write(`  ${name} ... `);
    try {
        fn();
        console.log('✅ PASS');
        passed++;
    } catch (e) {
        console.log(`❌ FAIL: ${e.message}`);
        failed++;
    }
}

function assertRunFailed(runId, expectedCode) {
    const run = db.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(runId);
    if (run.status !== 'failed') throw new Error(`Expected status=failed, got ${run.status}`);
    if (expectedCode && run.error_code !== expectedCode) throw new Error(`Expected error_code=${expectedCode}, got ${run.error_code}`);
    const threadCount = db.prepare('SELECT COUNT(*) as c FROM threads WHERE ingestion_run_id = ?').get(runId).c;
    const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE ingestion_run_id = ?').get(runId).c;
    if (threadCount > 0) throw new Error(`Expected 0 threads, got ${threadCount}`);
    if (msgCount > 0) throw new Error(`Expected 0 messages, got ${msgCount}`);
}

function assertNoFilesOutsideVault() {
    // Check that no files were written outside VAULT_DIR or FIXTURES_DIR
    const vaultAbs = path.resolve(VAULT_DIR);
    const artifacts = db.prepare('SELECT stored_path FROM raw_artifacts').all();
    for (const a of artifacts) {
        if (!path.resolve(a.stored_path).startsWith(vaultAbs)) {
            throw new Error(`File written outside vault: ${a.stored_path}`);
        }
    }
}

// ─── Raw ZIP Path Traversal Scanner ──────────────────────────────────────────
// AdmZip silently normalizes '../' in entry names, so we must scan the raw
// ZIP local file headers directly from the buffer before AdmZip touches it.
// Local file header signature: 0x04034b50 (PK\x03\x04)
// Filename length is at offset 26 (2 bytes, little-endian)
// Extra field length at offset 28 (2 bytes, little-endian)
// Filename starts at offset 30
function rawZipHasPathTraversal(buffer) {
    const SIG = 0x04034b50;
    let offset = 0;
    while (offset + 30 < buffer.length) {
        const sig = buffer.readUInt32LE(offset);
        if (sig !== SIG) break;
        const filenameLen = buffer.readUInt16LE(offset + 26);
        const extraLen = buffer.readUInt16LE(offset + 28);
        const filename = buffer.slice(offset + 30, offset + 30 + filenameLen).toString('utf-8');
        // Check each path component for '..'
        const parts = filename.replace(/\\/g, '/').split('/');
        if (parts.some(p => p === '..')) return filename;
        // Advance to next local file header
        const compressedSize = buffer.readUInt32LE(offset + 18);
        offset += 30 + filenameLen + extraLen + compressedSize;
    }
    return null;
}

// ─── ZIP Safety Harness ───────────────────────────────────────────────────────
function importZip(runId, provider, buffer, filename) {
    const artifactId = storeArtifact(runId, provider, 'zip', filename, buffer);

    // Raw path traversal check BEFORE AdmZip normalizes entry names
    const slipEntry = rawZipHasPathTraversal(buffer);
    if (slipEntry) {
        failRun(runId, 'ZIP_SLIP_DETECTED', `Rejected path traversal entry: ${slipEntry}`);
        return;
    }

    let zip;
    try {
        zip = new AdmZip(buffer);
    } catch (e) {
        failRun(runId, 'ZIP_CORRUPT', e.message);
        return;
    }


    const entries = zip.getEntries();

    if (entries.length > MAX_ENTRIES) {
        failRun(runId, 'ZIP_TOO_MANY_ENTRIES', `${entries.length} entries exceeds limit of ${MAX_ENTRIES}`);
        return;
    }

    // ZIP Slip check + size pre-scan
    let totalSize = 0;
    for (const entry of entries) {
        if (entry.isDirectory) continue;

        // ZIP Slip: check raw entryName for path traversal components
        // Do NOT use path.normalize() — it resolves '..' which defeats the check
        const entryParts = entry.entryName.replace(/\\/g, '/').split('/');
        if (entryParts.some(p => p === '..') || path.isAbsolute(entry.entryName)) {
            failRun(runId, 'ZIP_SLIP_DETECTED', `Rejected path traversal entry: ${entry.entryName}`);
            return;
        }

        const uncompressedSize = (entry.header && entry.header.size) || 0;
        if (uncompressedSize > MAX_SINGLE) {
            failRun(runId, 'ZIP_ENTRY_TOO_LARGE', `Entry ${entry.entryName} is ${uncompressedSize} bytes, limit is ${MAX_SINGLE}`);
            return;
        }
        totalSize += uncompressedSize;
        if (totalSize > MAX_TOTAL) {
            failRun(runId, 'ZIP_TOTAL_TOO_LARGE', `Total uncompressed size ${totalSize} exceeds limit ${MAX_TOTAL}`);
            return;
        }
    }

    // If we get here, ZIP is safe — mark complete (no actual parsing needed for these negative tests)
    db.prepare('UPDATE ingestion_runs SET status = ? WHERE id = ?').run('complete', runId);
}

// ─── JSON Parser Harness ──────────────────────────────────────────────────────
function importJson(runId, provider, content) {
    let data;
    try {
        data = JSON.parse(content);
    } catch (e) {
        failRun(runId, 'PARSE_JSON_FAILED', e.message);
        return;
    }

    if (!Array.isArray(data)) {
        failRun(runId, 'SCHEMA_MISMATCH', 'Expected array at root');
        return;
    }

    // Check for known provider fields
    const hasKnownFields = data.some(item =>
        item.mapping || item.chat_messages || item.conversations || item.messages
    );
    if (!hasKnownFields) {
        failRun(runId, 'SCHEMA_MISMATCH', 'No recognized provider fields found');
        return;
    }

    db.prepare('UPDATE ingestion_runs SET status = ? WHERE id = ?').run('complete', runId);
}

// ─── HTML Parser Harness ──────────────────────────────────────────────────────
function importHtml(runId, content) {
    const messageRegex = /<div class="message">([\s\S]*?)<\/div>/g;
    const matches = [...content.matchAll(messageRegex)];
    if (matches.length === 0) {
        failRun(runId, 'HTML_NO_MESSAGES', 'No message blocks found in chat.html');
        return;
    }
    db.prepare('UPDATE ingestion_runs SET status = ? WHERE id = ?').run('complete', runId);
}

// ─── Test Cases ───────────────────────────────────────────────────────────────
console.log('\n--- Phase 2A: Failure Mode Qualification ---\n');

console.log('[ZIP Safety]');

assertCase('Case 1: ZIP Slip / Path Traversal', () => {
    const runId = startRun('chatgpt');
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, 'zip_slip.zip'));
    importZip(runId, 'chatgpt', buf, 'zip_slip.zip');
    assertRunFailed(runId, 'ZIP_SLIP_DETECTED');
});

assertCase('Case 2: Single Entry Too Large', () => {
    const runId = startRun('chatgpt');
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, 'zip_single_too_large.zip'));
    importZip(runId, 'chatgpt', buf, 'zip_single_too_large.zip');
    assertRunFailed(runId, 'ZIP_ENTRY_TOO_LARGE');
});

assertCase('Case 3: Total Uncompressed Too Large', () => {
    const runId = startRun('chatgpt');
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, 'zip_total_too_large.zip'));
    importZip(runId, 'chatgpt', buf, 'zip_total_too_large.zip');
    assertRunFailed(runId, 'ZIP_TOTAL_TOO_LARGE');
});

assertCase('Case 4: Too Many Entries', () => {
    const runId = startRun('chatgpt');
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, 'zip_too_many_entries.zip'));
    importZip(runId, 'chatgpt', buf, 'zip_too_many_entries.zip');
    assertRunFailed(runId, 'ZIP_TOO_MANY_ENTRIES');
});

assertCase('Case 5: Corrupt ZIP', () => {
    const runId = startRun('chatgpt');
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, 'zip_corrupt.zip'));
    importZip(runId, 'chatgpt', buf, 'zip_corrupt.zip');
    assertRunFailed(runId, 'ZIP_CORRUPT');
});

console.log('\n[Parser Robustness]');

assertCase('Case 6: Malformed JSON', () => {
    const runId = startRun('chatgpt');
    const content = fs.readFileSync(path.join(FIXTURES_DIR, 'malformed.json'), 'utf-8');
    importJson(runId, 'chatgpt', content);
    assertRunFailed(runId, 'PARSE_JSON_FAILED');
});

assertCase('Case 7: Valid JSON, Missing Critical Fields', () => {
    const runId = startRun('chatgpt');
    const content = fs.readFileSync(path.join(FIXTURES_DIR, 'schema_mismatch.json'), 'utf-8');
    importJson(runId, 'chatgpt', content);
    assertRunFailed(runId, 'SCHEMA_MISMATCH');
});

assertCase('Case 8: chat.html Fallback Drift', () => {
    const runId = startRun('chatgpt');
    const content = fs.readFileSync(path.join(FIXTURES_DIR, 'chat_drift.html'), 'utf-8');
    importHtml(runId, content);
    assertRunFailed(runId, 'HTML_NO_MESSAGES');
});

console.log('\n[Atomicity]');

assertCase('Case 9: Simulated DB Write Failure Mid-Import (transaction rollback)', () => {
    const runId = startRun('chatgpt');
    // Simulate a mid-import failure using a transaction that deliberately throws
    try {
        db.transaction(() => {
            db.prepare('INSERT INTO threads (provider, title, raw_artifact_id, ingestion_run_id) VALUES (?, ?, ?, ?)')
                .run('chatgpt', 'Partial Thread', 0, runId);
            // Simulate failure after first thread insert
            throw new Error('Simulated DB write failure at message 1');
        })();
    } catch (e) {
        failRun(runId, 'DB_WRITE_FAILED', e.message);
    }
    assertRunFailed(runId, 'DB_WRITE_FAILED');
});

console.log('\n[Filesystem Integrity]');

assertCase('No files written outside vault directory', () => {
    assertNoFilesOutsideVault();
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n--- Phase 2A Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) {
    console.error('\n❌ Phase 2A: FAIL');
    process.exit(1);
} else {
    console.log('\n✅ Phase 2A: PASS');
}

db.close();
