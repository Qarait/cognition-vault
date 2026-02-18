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

// ─── Raw ZIP Builder (for path traversal fixtures) ────────────────────────────
// AdmZip normalizes '../' when writing, so we build the ZIP binary manually.
// This creates a minimal but valid ZIP with a path traversal entry name.
function buildRawZipWithTraversal(entryName, content) {
    const nameBytes = Buffer.from(entryName, 'utf-8');
    const contentBytes = Buffer.from(content, 'utf-8');
    const crc32 = (() => {
        // Simple CRC32 implementation
        let crc = 0xFFFFFFFF;
        const table = [];
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[i] = c;
        }
        for (const byte of contentBytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    })();

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);           // version needed
    localHeader.writeUInt16LE(0, 6);            // flags
    localHeader.writeUInt16LE(0, 8);            // compression (stored)
    localHeader.writeUInt16LE(0, 10);           // mod time
    localHeader.writeUInt16LE(0, 12);           // mod date
    localHeader.writeUInt32LE(crc32, 14);       // CRC-32
    localHeader.writeUInt32LE(contentBytes.length, 18); // compressed size
    localHeader.writeUInt32LE(contentBytes.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);    // filename length
    localHeader.writeUInt16LE(0, 28);           // extra field length
    nameBytes.copy(localHeader, 30);

    // Central directory entry
    const centralDir = Buffer.alloc(46 + nameBytes.length);
    centralDir.writeUInt32LE(0x02014b50, 0);    // signature
    centralDir.writeUInt16LE(20, 4);            // version made by
    centralDir.writeUInt16LE(20, 6);            // version needed
    centralDir.writeUInt16LE(0, 8);             // flags
    centralDir.writeUInt16LE(0, 10);            // compression
    centralDir.writeUInt16LE(0, 12);            // mod time
    centralDir.writeUInt16LE(0, 14);            // mod date
    centralDir.writeUInt32LE(crc32, 16);        // CRC-32
    centralDir.writeUInt32LE(contentBytes.length, 20); // compressed size
    centralDir.writeUInt32LE(contentBytes.length, 24); // uncompressed size
    centralDir.writeUInt16LE(nameBytes.length, 28);    // filename length
    centralDir.writeUInt16LE(0, 30);            // extra field length
    centralDir.writeUInt16LE(0, 32);            // comment length
    centralDir.writeUInt16LE(0, 34);            // disk number start
    centralDir.writeUInt16LE(0, 36);            // internal attributes
    centralDir.writeUInt32LE(0, 38);            // external attributes
    centralDir.writeUInt32LE(0, 42);            // local header offset
    nameBytes.copy(centralDir, 46);

    // End of central directory
    const eocd = Buffer.alloc(22);
    const centralDirOffset = localHeader.length + contentBytes.length;
    eocd.writeUInt32LE(0x06054b50, 0);          // signature
    eocd.writeUInt16LE(0, 4);                   // disk number
    eocd.writeUInt16LE(0, 6);                   // disk with central dir
    eocd.writeUInt16LE(1, 8);                   // entries on disk
    eocd.writeUInt16LE(1, 10);                  // total entries
    eocd.writeUInt32LE(centralDir.length, 12);  // central dir size
    eocd.writeUInt32LE(centralDirOffset, 16);   // central dir offset
    eocd.writeUInt16LE(0, 20);                  // comment length

    return Buffer.concat([localHeader, contentBytes, centralDir, eocd]);
}

// ─── Case 1: ZIP Slip / Path Traversal ────────────────────────────────────────
console.log('\n[1] ZIP Slip / Path Traversal');
{
    // Build raw ZIP with '../outside.txt' preserved in the binary header
    const buf = buildRawZipWithTraversal('../outside.txt', 'zip slip payload');
    write('zip_slip.zip', buf);
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
// Each entry must be UNDER the single-file limit (1KB) but collectively exceed total (4KB)
console.log('\n[3] Total Uncompressed Too Large');
{
    const zip = new AdmZip();
    // 6 entries × 800 bytes = 4800 bytes total — verifier sets total limit to 4096 bytes
    // Each entry is 800 bytes, well under the 1024-byte single-file limit
    for (let i = 0; i < 6; i++) {
        zip.addFile(`chunk_${i}.json`, Buffer.alloc(800, 'B'));
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

// ─── Case 9: Compression Ratio Bomb ───────────────────────────────────────────
// Production guard in ipcHandlers.ts: ratio > 100 → blocked.
// We spoof header.size (uncompressed=200) vs compressedSize=1 in the central
// directory so AdmZip's entry.header reports a ~200:1 ratio.
// The actual content bytes are just 1 byte so the fixture file stays tiny.
console.log('\n[9] Compression Ratio Bomb (spoofed headers)');
{
    const entryName = 'conversations.json';
    const nameBytes = Buffer.from(entryName, 'utf-8');
    const realContent = Buffer.from('X');           // 1 real byte on disk
    const spoofedUncompressed = 200;               // lie: claim 200 bytes out
    const spoofedCompressed = 1;                 // lie: claim 1 byte in → 200:1

    // CRC of actual content
    let crc = 0xFFFFFFFF;
    const tbl = [];
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); tbl[i] = c; }
    for (const b of realContent) crc = tbl[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    crc = (crc ^ 0xFFFFFFFF) >>> 0;

    // Local file header — use spoofed sizes
    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);              // compression method 8 (deflate) — lies about being compressed
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(spoofedCompressed, 18);    // compressed size
    lh.writeUInt32LE(spoofedUncompressed, 22);  // uncompressed size ← ratio trigger
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBytes.copy(lh, 30);

    // Central directory — same spoofed sizes (AdmZip reads header from here)
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);             // compression method
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(spoofedCompressed, 20);    // compressed size
    cd.writeUInt32LE(spoofedUncompressed, 24);  // uncompressed size ← ratio trigger
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(0, 42);
    nameBytes.copy(cd, 46);

    const cdOffset = lh.length + realContent.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);

    write('zip_ratio_bomb.zip', Buffer.concat([lh, realContent, cd, eocd]));
}

console.log('\n✅ All negative fixtures created in tests/fixtures/negative/');

