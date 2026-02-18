/**
 * scripts/verify_scale.js
 * Phase 2B: Scale Qualification
 *
 * Imports a generated scale fixture and asserts:
 *   - message count matches expectation
 *   - sentinel tokens searchable via FTS
 *   - import completes under a loose time ceiling
 *   - FTS query median < 20ms, p95 < 100ms
 *
 * Writes results to dist/qualification_scale.json
 *
 * Usage:
 *   node scripts/verify_scale.js [total_messages]
 *   (total_messages must match a generated fixture in tests/fixtures/scale/)
 */

const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const TOTAL = parseInt(process.argv[2] || '10000');
const SCALE_DIR = path.join(__dirname, '../tests/fixtures/scale');
const ZIP_PATH = path.join(SCALE_DIR, `scale_${TOTAL}.zip`);
const META_PATH = path.join(SCALE_DIR, `scale_${TOTAL}_meta.json`);
const QUAL_DB = path.join(SCALE_DIR, `qual_scale_${TOTAL}.db`);
const RESULTS_DIR = path.join(__dirname, '../dist');
const RESULTS_PATH = path.join(RESULTS_DIR, 'qualification_scale.json');

// Loose time ceilings (non-flaky)
const MAX_IMPORT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FTS_MEDIAN_MS = 20;
const MAX_FTS_P95_MS = 100;

if (!fs.existsSync(ZIP_PATH)) {
    console.error(`Scale fixture not found: ${ZIP_PATH}`);
    console.error('Run: node scripts/generate_scale_fixture.js first');
    process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
console.log(`\n--- Phase 2B: Scale Qualification (${TOTAL} messages) ---`);
console.log(`Threads: ${meta.threadCount}, Messages/Thread: ${meta.messagesPerThread}`);

// ─── DB Setup ─────────────────────────────────────────────────────────────────
if (fs.existsSync(QUAL_DB)) fs.unlinkSync(QUAL_DB);
const db = new Database(QUAL_DB);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
    CREATE TABLE ingestion_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, status TEXT);
    CREATE TABLE raw_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, ingestion_run_id INTEGER, provider TEXT, artifact_type TEXT, filename TEXT, sha256 TEXT);
    CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, provider_thread_id TEXT, title TEXT, raw_artifact_id INTEGER, ingestion_run_id INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER, provider TEXT, provider_message_id TEXT, role TEXT, content TEXT, content_plain TEXT, content_hash TEXT, ingestion_run_id INTEGER);
    CREATE VIRTUAL TABLE messages_fts USING fts5(content_plain, content='messages', content_rowid='id');
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content_plain) VALUES (new.id, new.content_plain);
    END;
`);

// ─── Import ───────────────────────────────────────────────────────────────────
console.log('\nExtracting fixture...');
const zipBuf = fs.readFileSync(ZIP_PATH);
const zip = new AdmZip(zipBuf);
const jsonContent = zip.readAsText('conversations.json');
const data = JSON.parse(jsonContent);

const runId = db.prepare('INSERT INTO ingestion_runs (provider, status) VALUES (?, ?)').run('chatgpt', 'running').lastInsertRowid;
const artId = db.prepare('INSERT INTO raw_artifacts (ingestion_run_id, provider, artifact_type, filename, sha256) VALUES (?, ?, ?, ?, ?)')
    .run(runId, 'chatgpt', 'zip', `scale_${TOTAL}.zip`, 'mock-sha').lastInsertRowid;

const insertThread = db.prepare('INSERT INTO threads (provider, provider_thread_id, title, raw_artifact_id, ingestion_run_id) VALUES (?, ?, ?, ?, ?)');
const insertMessage = db.prepare('INSERT INTO messages (thread_id, provider, provider_message_id, role, content, content_plain, content_hash, ingestion_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

console.log('Importing...');
const importStart = Date.now();

db.transaction(() => {
    for (const thread of data) {
        const res = insertThread.run('chatgpt', thread.id, thread.title, artId, runId);
        const threadId = res.lastInsertRowid;
        if (thread.mapping) {
            for (const [msgId, node] of Object.entries(thread.mapping)) {
                if (!node.message || node.message.content.content_type !== 'text') continue;
                const content = node.message.content.parts.join('\n');
                const contentPlain = content.replace(/[#*`]/g, '').trim();
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                insertMessage.run(threadId, 'chatgpt', msgId, node.message.author.role, content, contentPlain, hash, runId);
            }
        }
    }
})();

const importMs = Date.now() - importStart;
db.prepare('UPDATE ingestion_runs SET status = ? WHERE id = ?').run('complete', runId);
console.log(`Import complete in ${importMs}ms`);

// ─── Count Assertions ─────────────────────────────────────────────────────────
const threadCount = db.prepare('SELECT COUNT(*) as c FROM threads WHERE ingestion_run_id = ?').get(runId).c;
const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE ingestion_run_id = ?').get(runId).c;

console.log(`\nDB counts: ${threadCount} threads, ${msgCount} messages`);

if (threadCount !== meta.threadCount) {
    console.error(`❌ Thread count mismatch: expected ${meta.threadCount}, got ${threadCount}`);
    process.exit(1);
}
if (msgCount !== meta.total) {
    console.error(`❌ Message count mismatch: expected ${meta.total}, got ${msgCount}`);
    process.exit(1);
}
console.log('✅ Counts match');

// ─── Sentinel FTS Check ───────────────────────────────────────────────────────
// Check 5 random threads for their sentinels
const sampleThreads = [0, Math.floor(meta.threadCount * 0.25), Math.floor(meta.threadCount * 0.5), Math.floor(meta.threadCount * 0.75), meta.threadCount - 1];
let sentinelFails = 0;
for (const t of sampleThreads) {
    const sentinel = `SCALE_SENTINEL_T${t}`;
    const hit = db.prepare('SELECT COUNT(*) as c FROM messages_fts WHERE content_plain MATCH ?').get(sentinel).c;
    if (hit === 0) {
        console.error(`❌ FTS miss for sentinel: ${sentinel}`);
        sentinelFails++;
    }
}
if (sentinelFails === 0) {
    console.log(`✅ FTS sentinel check passed (${sampleThreads.length} samples)`);
} else {
    process.exit(1);
}

// ─── FTS Latency Benchmark ────────────────────────────────────────────────────
console.log('\nRunning FTS latency benchmark...');
const queries = ['qualification', 'generic', 'scale', 'thread', 'message'];
const latencies = [];

for (let i = 0; i < 50; i++) {
    const q = queries[i % queries.length];
    const t0 = performance.now();
    db.prepare('SELECT COUNT(*) as c FROM messages_fts WHERE content_plain MATCH ?').get(q);
    latencies.push(performance.now() - t0);
}

latencies.sort((a, b) => a - b);
const median = latencies[Math.floor(latencies.length * 0.5)];
const p95 = latencies[Math.floor(latencies.length * 0.95)];
const p99 = latencies[Math.floor(latencies.length * 0.99)] || latencies[latencies.length - 1];

console.log(`FTS latency — median: ${median.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms, p99: ${p99.toFixed(2)}ms`);

let latencyPass = true;
if (median > MAX_FTS_MEDIAN_MS) {
    console.error(`❌ FTS median ${median.toFixed(2)}ms exceeds limit ${MAX_FTS_MEDIAN_MS}ms`);
    latencyPass = false;
}
if (p95 > MAX_FTS_P95_MS) {
    console.error(`❌ FTS p95 ${p95.toFixed(2)}ms exceeds limit ${MAX_FTS_P95_MS}ms`);
    latencyPass = false;
}
if (latencyPass) console.log('✅ FTS latency within bounds');

// ─── Import Time Check ────────────────────────────────────────────────────────
if (importMs > MAX_IMPORT_MS) {
    console.error(`❌ Import took ${importMs}ms, exceeds ceiling of ${MAX_IMPORT_MS}ms`);
    process.exit(1);
}
console.log(`✅ Import time within ceiling (${importMs}ms < ${MAX_IMPORT_MS}ms)`);

// ─── Write Results ────────────────────────────────────────────────────────────
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
const dbSizeBytes = fs.statSync(QUAL_DB).size;

const results = {
    timestamp: new Date().toISOString(),
    tier: TOTAL <= 10000 ? 1 : 2,
    totalMessages: TOTAL,
    threadCount,
    msgCount,
    importMs,
    fts: { median: parseFloat(median.toFixed(2)), p95: parseFloat(p95.toFixed(2)), p99: parseFloat(p99.toFixed(2)) },
    dbSizeBytes,
    pass: latencyPass && importMs <= MAX_IMPORT_MS
};

fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2), 'utf-8');
console.log(`\nResults written to ${RESULTS_PATH}`);

db.close();

if (!results.pass) {
    console.error('\n❌ Phase 2B: FAIL');
    process.exit(1);
}
console.log('\n✅ Phase 2B: PASS');
