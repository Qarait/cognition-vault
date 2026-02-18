const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Standalone DB Init for Qualification
function initTestDb(dbPath) {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE ingestion_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, status TEXT);
        CREATE TABLE raw_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, ingestion_run_id INTEGER, provider TEXT, artifact_type TEXT, filename TEXT, sha256 TEXT);
        CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, title TEXT, raw_artifact_id INTEGER, ingestion_run_id INTEGER);
        CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER, provider TEXT, role TEXT, content TEXT, content_plain TEXT, content_hash TEXT);
        CREATE VIRTUAL TABLE messages_fts USING fts5(content_plain, content='messages', content_rowid='id');
        CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content_plain) VALUES (new.id, new.content_plain);
        END;
    `);
    return db;
}

// Minimal Importer Logic Mocks (Transcribed from electron/importers/*.ts)
function mockImportChatGPT(db, runId, rawArtifactId, jsonContent) {
    const data = JSON.parse(jsonContent);
    const insertThread = db.prepare('INSERT INTO threads (provider, title, raw_artifact_id, ingestion_run_id) VALUES (?, ?, ?, ?)');
    const insertMessage = db.prepare('INSERT INTO messages (thread_id, provider, role, content, content_plain, content_hash) VALUES (?, ?, ?, ?, ?, ?)');

    for (const thread of data) {
        const res = insertThread.run('chatgpt', thread.title, rawArtifactId, runId);
        const threadId = res.lastInsertRowid;
        if (thread.mapping) {
            for (const [id, node] of Object.entries(thread.mapping)) {
                if (!node.message || node.message.content.content_type !== 'text') continue;
                const content = node.message.content.parts.join('\n');
                const contentPlain = content.replace(/[#*`]/g, '').trim();
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                insertMessage.run(threadId, 'chatgpt', node.message.author.role, content, contentPlain, hash);
            }
        }
    }
}

function mockImportClaude(db, runId, rawArtifactId, jsonContent) {
    const data = JSON.parse(jsonContent);
    const insertThread = db.prepare('INSERT INTO threads (provider, title, raw_artifact_id, ingestion_run_id) VALUES (?, ?, ?, ?)');
    const insertMessage = db.prepare('INSERT INTO messages (thread_id, provider, role, content, content_plain, content_hash) VALUES (?, ?, ?, ?, ?, ?)');

    for (const thread of data) {
        const res = insertThread.run('claude', thread.name, rawArtifactId, runId);
        const threadId = res.lastInsertRowid;
        if (thread.chat_messages) {
            for (const msg of thread.chat_messages) {
                const content = msg.text || '';
                const contentPlain = content.replace(/[#*`]/g, '').trim();
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                insertMessage.run(threadId, 'claude', msg.sender, content, contentPlain, hash);
            }
        }
    }
}

function mockImportGemini(db, runId, rawArtifactId, jsonContent) {
    const data = JSON.parse(jsonContent);
    const insertThread = db.prepare('INSERT INTO threads (provider, title, raw_artifact_id, ingestion_run_id) VALUES (?, ?, ?, ?)');
    const insertMessage = db.prepare('INSERT INTO messages (thread_id, provider, role, content, content_plain, content_hash) VALUES (?, ?, ?, ?, ?, ?)');

    for (const thread of data) {
        const conversations = thread.conversations || thread.messages || [];
        const res = insertThread.run('gemini', thread.title, rawArtifactId, runId);
        const threadId = res.lastInsertRowid;
        for (const msg of conversations) {
            const content = msg.content || msg.text || '';
            const contentPlain = content.replace(/[#*`]/g, '').trim();
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            insertMessage.run(threadId, 'gemini', msg.author || msg.role, content, contentPlain, hash);
        }
    }
}

// Main Execution
const QUAL_DB = path.join(__dirname, '../tests/fixtures/qual.db');
const db = initTestDb(QUAL_DB);

console.log('--- Phase 1: Ingestion Qualification ---');

const providers = [
    { name: 'chatgpt', func: mockImportChatGPT, sentinel: 'SENTINEL_CHATGPT_001' },
    { name: 'claude', func: mockImportClaude, sentinel: 'SENTINEL_CLAUDE_001' },
    { name: 'gemini', func: mockImportGemini, sentinel: 'SENTINEL_GEMINI_001' }
];

providers.forEach(p => {
    const filePath = path.join(__dirname, `../tests/fixtures/${p.name}/conversations.json`);
    const content = fs.readFileSync(filePath, 'utf-8');

    const run = db.prepare('INSERT INTO ingestion_runs (provider, status) VALUES (?, ?)').run(p.name, 'running');
    const art = db.prepare('INSERT INTO raw_artifacts (ingestion_run_id, provider, artifact_type, filename, sha256) VALUES (?, ?, ?, ?, ?)')
        .run(run.lastInsertRowid, p.name, 'json', 'conversations.json', 'mock-sha');

    p.func(db, run.lastInsertRowid, art.lastInsertRowid, content);

    // Verify Sentinel
    const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE content LIKE ?').get(`%${p.sentinel}%`).count;
    const ftsCount = db.prepare('SELECT COUNT(*) as count FROM messages_fts WHERE content_plain MATCH ?').get(p.sentinel).count;

    if (count > 0 && ftsCount > 0) {
        console.log(`✅ ${p.name.toUpperCase()}: Sentinel found in DB and FTS index.`);
    } else {
        console.error(`❌ ${p.name.toUpperCase()}: Sentinel NOT found! (DB: ${count}, FTS: ${ftsCount})`);
        process.exit(1);
    }
});

console.log('\n--- Qualification Phase 1: PASS ---');
db.close();
