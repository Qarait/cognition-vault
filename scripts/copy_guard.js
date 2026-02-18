#!/usr/bin/env node
/**
 * Phase 4 — Copy Guard
 *
 * Fails CI if banned jargon strings reappear in user-facing source files.
 * This is a blunt grep-based gate to prevent accidental regressions.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// ── Banned strings (case-insensitive) ───────────────────────────
// These should never appear in user-facing UI copy.
const BANNED = [
    'forensic artifact',
    'Run ID:',
    'Artifact Hash',
];

// ── Files to scan ───────────────────────────────────────────────
// Only scan user-facing source (not test scripts, not qualification harnesses)
const SCAN_FILES = [
    'src/App.tsx',
    'src/main.tsx',
];

let failures = 0;

for (const rel of SCAN_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue; // skip if file doesn't exist

    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split('\n');

    for (const banned of BANNED) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(banned.toLowerCase())) {
                console.error(`FAIL: banned string "${banned}" found in ${rel}:${i + 1}`);
                console.error(`      ${lines[i].trim()}`);
                failures++;
            }
        }
    }
}

// ── Result ──────────────────────────────────────────────────────
if (failures > 0) {
    console.error(`\n✗ copy_guard: ${failures} banned string(s) found`);
    process.exit(1);
} else {
    console.log(`✓ copy_guard: no banned jargon found in user-facing files`);
}
