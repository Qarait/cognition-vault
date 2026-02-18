/**
 * scripts/generate_scale_fixture.js
 * Phase 2B: Generates a large-scale ChatGPT-format fixture on the fly.
 * No real user content. All content is deterministic and generic.
 *
 * Usage:
 *   node scripts/generate_scale_fixture.js [threads] [messages_per_thread]
 *
 * Defaults: 100 threads × 100 messages = 10,000 messages (Tier 1)
 * For Tier 2: node scripts/generate_scale_fixture.js 500 100  → 50k messages
 */

const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');

const THREAD_COUNT = parseInt(process.argv[2] || '100');
const MESSAGES_PER_THREAD = parseInt(process.argv[3] || '100');
const TOTAL = THREAD_COUNT * MESSAGES_PER_THREAD;

const OUT_DIR = path.join(__dirname, '../tests/fixtures/scale');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`Generating scale fixture: ${THREAD_COUNT} threads × ${MESSAGES_PER_THREAD} messages = ${TOTAL} total messages`);

const threads = [];

for (let t = 0; t < THREAD_COUNT; t++) {
    const mapping = {};
    let prevId = null;

    for (let m = 0; m < MESSAGES_PER_THREAD; m++) {
        const msgId = `msg_${t}_${m}`;
        const role = m % 2 === 0 ? 'user' : 'assistant';
        // Distribute sentinels: one per thread in the first message
        const sentinel = m === 0 ? ` SCALE_SENTINEL_T${t}` : '';
        mapping[msgId] = {
            message: {
                id: msgId,
                author: { role },
                content: {
                    content_type: 'text',
                    parts: [`Scale test message ${m} in thread ${t}.${sentinel} Generic qualification content.`]
                },
                create_time: 1708262400 + t * 1000 + m
            },
            parent: prevId
        };
        prevId = msgId;
    }

    threads.push({
        id: `thread_${t}`,
        title: `Scale Thread ${t}`,
        create_time: 1708262400 + t * 1000,
        mapping
    });
}

const json = JSON.stringify(threads);
const zip = new AdmZip();
zip.addFile('conversations.json', Buffer.from(json, 'utf-8'));

const outPath = path.join(OUT_DIR, `scale_${TOTAL}.zip`);
zip.writeZip(outPath);

// Also write metadata for the verifier
fs.writeFileSync(
    path.join(OUT_DIR, `scale_${TOTAL}_meta.json`),
    JSON.stringify({ threadCount: THREAD_COUNT, messagesPerThread: MESSAGES_PER_THREAD, total: TOTAL }),
    'utf-8'
);

console.log(`✅ Scale fixture written to ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
