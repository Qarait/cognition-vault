const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');

const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures');

function createZip(provider, filename, internalName) {
    const zip = new AdmZip();
    const filePath = path.join(FIXTURES_DIR, provider, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }
    const content = fs.readFileSync(filePath);
    zip.addFile(internalName, content);

    const outPath = path.join(FIXTURES_DIR, `${provider}_export.zip`);
    zip.writeZip(outPath);
    console.log(`Created ${outPath}`);
}

createZip('chatgpt', 'conversations.json', 'conversations.json');
createZip('claude', 'conversations.json', 'claude_export.json');
createZip('gemini', 'conversations.json', 'Gemini/Conversations.json'); // Simulate takeout folder
