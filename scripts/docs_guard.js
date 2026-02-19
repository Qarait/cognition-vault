#!/usr/bin/env node
/**
 * Phase 4 — Docs Guard
 *
 * Fails CI if required documentation files are missing or if
 * RELEASES.md contains links to local files that don't exist.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// ── Required files ──────────────────────────────────────────────
const REQUIRED_FILES = [
    'README.md',
    'docs/get-started.md',
    'docs/walkthrough.md',
];

let failures = 0;

for (const rel of REQUIRED_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
        console.error(`FAIL: required file missing → ${rel}`);
        failures++;
    } else {
        console.log(`  OK: ${rel} exists`);
    }
}

// ── RELEASES.md link audit ──────────────────────────────────────
const releasesPath = path.join(ROOT, 'RELEASES.md');
if (fs.existsSync(releasesPath)) {
    const content = fs.readFileSync(releasesPath, 'utf8');
    // Match markdown links: [text](relative/path)
    // Exclude http(s) links, anchors, and absolute paths
    const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
        const href = match[2];
        // Skip URLs, anchors, and absolute paths
        if (href.startsWith('http') || href.startsWith('#') || href.startsWith('/')) continue;
        // Remove any anchor fragment
        const filePart = href.split('#')[0];
        if (!filePart) continue;
        const target = path.join(ROOT, filePart);
        if (!fs.existsSync(target)) {
            console.error(`FAIL: RELEASES.md link 404 → [${match[1]}](${href}) — file not found: ${filePart}`);
            failures++;
        } else {
            console.log(`  OK: RELEASES.md link → ${filePart}`);
        }
    }

    // ── RELEASES.md format validation (for extraction script) ──────────
    const releaseNotesRegex = /## v\d+\.\d+\.\d+.*?\n([\s\S]*?)\n---/;
    if (!releaseNotesRegex.test(content.replace(/\r\n/g, '\n'))) {
        console.error('FAIL: RELEASES.md format error. Expected "## vX.Y.Z ... \n ... \n---"');
        console.error('      Check that the latest release block ends with a "---" separator line.');
        failures++;
    } else {
        console.log('  OK: RELEASES.md format is compatible with extraction script');
    }
} else {
    console.error('FAIL: RELEASES.md itself is missing');
    failures++;
}

// ── Result ──────────────────────────────────────────────────────
if (failures > 0) {
    console.error(`\n✗ docs_guard: ${failures} failure(s)`);
    process.exit(1);
} else {
    console.log(`\n✓ docs_guard: all checks passed`);
}
