const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

// Path logic matches electron app (Windows-centric for this project)
const userData = path.join(os.homedir(), 'AppData', 'Roaming', 'cognition-vault');
const DB_PATH = path.join(userData, 'vault', 'vault.db');
const ARTIFACTS_PATH = path.join(userData, 'vault', 'artifacts');

async function runGate() {
    console.log('--- Cognition Vault V1 Release Gate ---');

    if (!fs.existsSync(DB_PATH)) {
        console.error('❌ Database not found at:', DB_PATH);
        process.exit(1);
    }

    const db = new Database(DB_PATH);

    try {
        // 1. No Mutation Check
        console.log('\n[1/2] Verifying RAW Artifact Integrity (No Mutation)...');
        const artifacts = db.prepare('SELECT id, filename, sha256, stored_path FROM raw_artifacts').all();

        let mutationErrors = 0;
        for (const art of artifacts) {
            if (!fs.existsSync(art.stored_path)) {
                console.error(`  ❌ Missing artifact: ${art.filename} (${art.stored_path})`);
                mutationErrors++;
                continue;
            }

            const buffer = fs.readFileSync(art.stored_path);
            const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');

            if (actualHash !== art.sha256) {
                console.error(`  ❌ Hash mismatch for ${art.filename}:`);
                console.error(`     Expected: ${art.sha256}`);
                console.error(`     Actual:   ${actualHash}`);
                mutationErrors++;
            }
        }

        if (mutationErrors === 0) {
            console.log('  ✅ All stored artifacts match their original SHA-256 hashes.');
        } else {
            console.error(`  ❌ Failed: ${mutationErrors} integrity violations found.`);
        }

        // 2. Re-indexability Check
        console.log('\n[2/2] Verifying Re-indexability (FTS5 Reconstruction)...');
        const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;

        db.transaction(() => {
            // Clear FTS index
            db.prepare('INSERT INTO messages_fts(messages_fts) VALUES("rebuild")').run();
        })();

        const ftsCount = db.prepare('SELECT COUNT(*) as count FROM messages_fts').get().count;

        if (messageCount === ftsCount) {
            console.log(`  ✅ FTS5 index successfully reconstructed (${ftsCount} records matched).`);
        } else {
            console.error(`  ❌ FTS5 record mismatch: Messages=${messageCount}, FTS=${ftsCount}`);
        }

        console.log('\n--- Result: ' + (mutationErrors === 0 && messageCount === ftsCount ? 'PASS' : 'FAIL') + ' ---');
        if (mutationErrors > 0 || messageCount !== ftsCount) process.exit(1);

    } catch (err) {
        console.error('❌ Gate execution failed:', err.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

runGate();
