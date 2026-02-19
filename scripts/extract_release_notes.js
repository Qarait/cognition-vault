const fs = require('fs');
const path = require('path');

const releasesPath = path.join(__dirname, '..', 'RELEASES.md');
const outputPath = path.join(__dirname, '..', 'release_notes.md');

const content = fs.readFileSync(releasesPath, 'utf8').replace(/\r\n/g, '\n');

// The project description to prepend
const projectHeader = `**Cognition Vault** is a "vault-grade" local-first AI history archive designed for forensic integrity and high-performance recall. It allows you to ingest, search, and preserve your chat history from ChatGPT, Claude, and Gemini with zero telemetry and total privacy.\n\n---\n`;

// Match the first ## version header until the first --- separator
const match = content.match(/## v\d+\.\d+\.\d+.*?\n([\s\S]*?)\n---/);

if (match && match[1]) {
    const rawNotes = match[1].trim();
    const finalNotes = `${projectHeader}\n${rawNotes}\n\n---\n[View Full Release History](https://github.com/Qarait/cognition-vault/blob/master/RELEASES.md)`;
    fs.writeFileSync(outputPath, finalNotes, 'utf8');
    console.log('Successfully extracted release notes to release_notes.md');
} else {
    console.error('Could not find latest release notes in RELEASES.md');
    // Log first 200 chars to see what's wrong
    console.log('File preview (first 200 chars):');
    console.log(content.substring(0, 200));
    process.exit(1);
}
