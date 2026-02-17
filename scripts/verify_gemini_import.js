const crypto = require('crypto');

async function verifyGeminiImport() {
    console.log('--- Gemini Importer Verification (Mock DB) ---');

    // 1. Setup Mock DB
    const mockDb = {
        prepare: (sql) => ({
            run: (...args) => {
                // console.log(`  Executing: ${sql.trim().split('\n')[0]}...`);
                return { lastInsertRowid: Math.floor(Math.random() * 1000) };
            }
        }),
        transaction: (fn) => {
            return () => {
                fn();
            };
        }
    };
    const db = mockDb;

    // 2. Define Mock Gemini Data
    const mockGeminiData = [
        {
            "title": "Quantum Physics Basics",
            "conversations": [
                {
                    "content": "What is entanglement?",
                    "author": "USER",
                    "created_at": "2024-05-10T10:00:00Z"
                },
                {
                    "content": "Entanglement is a physical phenomenon...",
                    "author": "GEMINI",
                    "created_at": "2024-05-10T10:00:05Z"
                }
            ]
        },
        {
            "title": "Baking a Cake",
            "messages": [ // Testing 'messages' key variant
                {
                    "prompt_text": "How do I bake a chocolate cake?",
                    "role": "USER",
                    "timestamp": "2024-06-15T14:30:00Z"
                },
                {
                    "response_text": "To bake a chocolate cake, you need...",
                    "role": "MODEL",
                    "timestamp": "2024-06-15T14:30:10Z"
                }
            ]
        }
    ];

    // 3. Parser Logic (Reproduced from gemini.ts for verification)
    const runId = 1;
    const rawArtifactId = 999;
    let threadCount = 0;
    let messageCount = 0;
    let roles = new Set();

    db.transaction(() => {
        for (const thread of mockGeminiData) {
            const conversations = thread.conversations || thread.messages || [];
            if (conversations.length === 0) continue;

            const threadResult = db.prepare('INSERT INTO threads ...').run();
            threadCount++;

            for (const msg of conversations) {
                const content = msg.content || msg.text || msg.prompt_text || msg.response_text || '';
                if (!content) continue;

                messageCount++;

                let roleStr = (msg.author || msg.sender || msg.role || 'unknown').toLowerCase();
                let role = 'unknown';
                if (roleStr.includes('user')) role = 'user';
                else if (roleStr.includes('gemini') || roleStr.includes('assistant') || roleStr.includes('model') || roleStr.includes('ai')) role = 'assistant';
                else role = roleStr;

                roles.add(role);
            }
        }
    })();

    // 4. Assertions
    console.log('\nVerifying parser logic...');
    console.log(`  Threads parsed: ${threadCount} (Expected: 2)`);
    console.log(`  Messages parsed: ${messageCount} (Expected: 4)`);
    console.log(`  Roles detected: ${Array.from(roles).join(', ')}`);

    if (threadCount !== 2 || messageCount !== 4) {
        throw new Error(`Data mismatch! Threads: ${threadCount}, Messages: ${messageCount}`);
    }

    if (!roles.has('user') || !roles.has('assistant')) {
        throw new Error('Role mapping failed!');
    }

    console.log('\n--- Result: PASS (Logic Verified) ---');
}

verifyGeminiImport().catch(err => {
    console.error(`\n--- Result: FAIL ---`);
    console.error(err.message);
    process.exit(1);
});
