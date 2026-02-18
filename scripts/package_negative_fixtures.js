/**
 * scripts/package_negative_fixtures.js
 * Generates synthetic malicious/broken fixtures for Phase 2A failure mode qualification.
 * No real user content. All fixtures are deterministic and self-contained.
 */
const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.join(__dirname, '../tests/fixtures/negative');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function write(filename, data) {
    const outPath = path.join(OUT_DIR, filename);
    if (Buffer.isBuffer(data)) {
        fs.writeFileSync(outPath, data);
    } else {
        fs.writeFileSync(outPath, data, 'utf-8');
    }
    console.log(`  Created: ${filename}`);
}

// ─── Case 1: ZIP Slip / Path Traversal ────────────────────────────────────────
console.log('\n[1] ZIP Slip / Path Traversal');
{
    const zip = new AdmZip();
    zip.addFile('../outside.txt', Buffer.from('zip slip payload'));
    zip.addFile('../../outside2.txt', Buffer.from('zip slip payload 2'));
    write('zip_slip.zip', zip.toBuffer());
}

// ─── Case 2: Single Entry Too Large ───────────────────────────────────────────
// Controlled by VAULT_ZIP_MAX_SINGLE_FILE_BYTES env var in verifier
console.log('\n[2] Single Entry Too Large');
{
    const zip = new AdmZip();
    const bigContent = Buffer.alloc(2048, 'A'); // 2KB — verifier sets limit to 1KB
    zip.addFile('conversations.json', bigContent);
    write('zip_single_too_large.zip', zip.toBuffer());
}

// ─── Case 3: Total Uncompressed Too Large ─────────────────────────────────────
// Controlled by VAULT_ZIP_MAX_TOTAL_BYTES env var in verifier
console.log('\n[3] Total Uncompressed Too Large');
{
    const zip = new AdmZip();
    // 3 entries × 2KB = 6KB total — verifier sets limit to 4KB
    for (let i = 0; i < 3; i++) {
        zip.addFile(`chunk_${i}.json`, Buffer.alloc(2048, 'B'));
    }
    write('zip_total_too_large.zip', zip.toBuffer());
}

// ─── Case 4: Too Many Entries ─────────────────────────────────────────────────
// Controlled by VAULT_ZIP_MAX_ENTRIES env var in verifier
console.log('\n[4] Too Many Entries');
{
    const zip = new AdmZip();
    // 11 entries — verifier sets limit to 10
    for (let i = 0; i < 11; i++) {
        zip.addFile(`entry_${i}.txt`, Buffer.from(`entry ${i}`));
    }
    write('zip_too_many_entries.zip', zip.toBuffer());
}

// ─── Case 5: Corrupt ZIP ──────────────────────────────────────────────────────
console.log('\n[5] Corrupt ZIP (truncated bytes)');
{
    const zip = new AdmZip();
    zip.addFile('conversations.json', Buffer.from('[{"id":"t1"}]'));
    const buf = zip.toBuffer();
    // Truncate to 50% to corrupt the ZIP structure
    write('zip_corrupt.zip', buf.slice(0, Math.floor(buf.length / 2)));
}

// ─── Case 6: Malformed JSON ───────────────────────────────────────────────────
console.log('\n[6] Malformed JSON');
{
    write('malformed.json', '{ this is not valid JSON !!!');
}

// ─── Case 7: Valid JSON, Missing Critical Fields ───────────────────────────────
console.log('\n[7] Valid JSON, Missing Critical Fields (schema mismatch)');
{
    // Valid JSON array but no 'mapping', 'chat_messages', or 'conversations' keys
    write('schema_mismatch.json', JSON.stringify([
        { foo: 'bar', baz: 42 }
    ]));
}

// ─── Case 8: chat.html Fallback Drift ─────────────────────────────────────────
console.log('\n[8] chat.html Fallback Drift (no expected markers)');
{
    write('chat_drift.html', `<!DOCTYPE html><html><head><title>Drifted Export</title></head>
<body><div class="unknown-wrapper"><p>No messages here in expected format.</p></div></body></html>`);
}

console.log('\n✅ All negative fixtures created in tests/fixtures/negative/');
