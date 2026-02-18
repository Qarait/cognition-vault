const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const fs = require('fs');

// Path logic: Allow override via environment variable for CI
const userData = path.join(os.homedir(), 'AppData', 'Roaming', 'cognition-vault');
const DEFAULT_DB_PATH = path.join(userData, 'vault', 'vault.db');
const DB_PATH = process.env.VAULT_DB_PATH || DEFAULT_DB_PATH;

function bench() {
    console.log('--- Cognition Vault V1 DB Benchmark ---');
    console.log(`Using Database: ${DB_PATH}`);

    if (!fs.existsSync(DB_PATH)) {
        console.log('⚠️ Database not found. Creating a minimal test database for CI...');
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                content_plain TEXT,
                provider TEXT
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content_plain, content='messages', content_rowid='id');
            INSERT INTO messages (content_plain, provider) VALUES ('test message for benchmarking', 'ci');
            INSERT INTO messages (content_plain, provider) VALUES ('another thinking entry', 'ci');
            INSERT INTO messages_fts (rowid, content_plain) SELECT id, content_plain FROM messages;
        `);
        db.close();
        console.log('✅ Minimal database created.');
    }

    const db = new Database(DB_PATH);

    try {
        const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        console.log(`Dataset size: ${messageCount} messages`);

        // Get some random terms to search for
        const sampleTerms = db.prepare('SELECT content_plain FROM messages LIMIT 100').all()
            .map(m => m.content_plain.split(' ')[0])
            .filter(t => t && t.length > 3);

        if (sampleTerms.length === 0) {
            console.log('⚠️ No sample terms found. Skipping trials.');
            return;
        }

        console.log(`Running 200 search trials...`);
        const results = [];

        for (let i = 0; i < 200; i++) {
            const term = sampleTerms[Math.floor(Math.random() * sampleTerms.length)];

            const start = process.hrtime.bigint();
            db.prepare('SELECT rowid FROM messages_fts WHERE content_plain MATCH ?').all(term);
            const end = process.hrtime.bigint();

            results.push(Number(end - start) / 1_000_000); // ms
        }

        const sorted = [...results].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const avg = results.reduce((a, b) => a + b, 0) / results.length;

        const stats = {
            timestamp: new Date().toISOString(),
            datasetSize: messageCount,
            median_ms: median,
            p95_ms: p95,
            avg_ms: avg,
            db_path: DB_PATH
        };

        console.log('\nResults (DB/FTS only):');
        console.log(`  Median: ${median.toFixed(4)}ms`);
        console.log(`  p95:    ${p95.toFixed(4)}ms`);
        console.log(`  Avg:    ${avg.toFixed(4)}ms`);

        // Write to dist for CI artifact collection
        const distDir = path.join(__dirname, '..', 'dist');
        if (!fs.existsSync(distDir)) {
            fs.mkdirSync(distDir, { recursive: true });
        }
        const outPath = path.join(distDir, 'benchmark.json');
        fs.writeFileSync(outPath, JSON.stringify(stats, null, 2) + "\n", 'utf8');
        console.log(`\n✅ Results saved to: ${outPath}`);

        // Loose sanity thresholds: informative warnings usually, but fail on extreme regressions
        if (median > 20 || p95 > 100) {
            console.error('\n❌ Benchmark sanity threshold failed!');
            console.error(`   Critical Thresholds: Median < 20ms, p95 < 100ms`);
            console.error(`   Actual: Median=${median.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);
            process.exit(1);
        }

        console.log('\n--- Benchmarking Complete ---');

    } catch (err) {
        console.error('❌ Benchmark failed:', err.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

function fsExists(p) {
    try {
        const fs = require('fs');
        return fs.existsSync(p);
    } catch (e) {
        return false;
    }
}

bench();
