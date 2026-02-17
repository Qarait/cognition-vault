import { getDb } from '../db'
import crypto from 'node:crypto'

/**
 * Gemini Google Takeout Importer
 * 
 * Supports the Conversations.json format found in the Gemini folder of a Google Takeout export.
 * Also handles variant structures with 'messages' instead of 'conversations'.
 */
export async function importGemini(runId: number, rawArtifactId: number, jsonContent: string) {
    const db = getDb()
    let data;
    try {
        data = JSON.parse(jsonContent)
    } catch (e) {
        throw new Error('Failed to parse Gemini JSON content')
    }

    if (!Array.isArray(data)) {
        // If it's not an array, it might be a single thread or a different format (like MyActivity.json)
        // For V1, we prioritize the conversational array format.
        throw new Error('Invalid Gemini export format: expected array of conversations')
    }

    const insertThread = db.prepare(`
        INSERT INTO threads (provider, provider_thread_id, title, raw_artifact_id, ingestion_run_id)
        VALUES (?, ?, ?, ?, ?)
    `)

    const insertMessage = db.prepare(`
        INSERT INTO messages (
            thread_id, provider, role, content, content_plain,
            timestamp, position, content_hash, raw_artifact_id, ingestion_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = db.transaction(() => {
        for (const thread of data) {
            const conversations = thread.conversations || thread.messages || []
            if (conversations.length === 0) continue

            // Gemini Takeout doesn't always have a clear thread ID, use null
            const threadResult = insertThread.run(
                'gemini',
                null,
                thread.title || 'Untitled Gemini Conversation',
                rawArtifactId,
                runId
            )

            const threadDbId = threadResult.lastInsertRowid as number
            let position = 0

            for (const msg of conversations) {
                // Handle different possible message content keys
                const content = msg.content || msg.text || msg.prompt_text || msg.response_text || ''
                if (!content) continue

                const contentPlain = content.replace(/[#*`]/g, '').trim()
                const contentHash = crypto.createHash('sha256').update(content).digest('hex')

                // Map author/sender to normalized roles (user/assistant)
                let roleStr = (msg.author || msg.sender || msg.role || 'unknown').toLowerCase()
                let role = 'unknown'
                if (roleStr.includes('user')) role = 'user'
                else if (roleStr.includes('gemini') || roleStr.includes('assistant') || roleStr.includes('model') || roleStr.includes('ai')) role = 'assistant'
                else role = roleStr

                const timestamp = msg.created_at || msg.timestamp || msg.time ? new Date(msg.created_at || msg.timestamp || msg.time).getTime() : null

                insertMessage.run(
                    threadDbId,
                    'gemini',
                    role,
                    content,
                    contentPlain,
                    timestamp,
                    position++,
                    contentHash,
                    rawArtifactId,
                    runId
                )
            }
        }
    })

    transaction()
}
