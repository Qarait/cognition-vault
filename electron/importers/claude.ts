import { getDb } from '../db'
import crypto from 'node:crypto'

export async function importClaude(runId: number, rawArtifactId: number, jsonContent: string) {
    const db = getDb()
    const data = JSON.parse(jsonContent)

    // Claude exports vary, but often follow a [ { uuid, name, chat_messages: [...] } ] structure
    if (!Array.isArray(data)) {
        throw new Error('Invalid Claude export format: expected array')
    }

    const insertThread = db.prepare(`
    INSERT INTO threads (provider, provider_thread_id, title, created_at, raw_artifact_id, ingestion_run_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

    const insertMessage = db.prepare(`
    INSERT INTO messages (
      thread_id, provider, provider_message_id, role, content, content_plain,
      timestamp, position, parent_provider_message_id, content_hash, raw_artifact_id, ingestion_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

    const transaction = db.transaction(() => {
        for (const thread of data) {
            const threadResult = insertThread.run(
                'claude',
                thread.uuid || null,
                thread.name || 'Untitled Conversation',
                thread.created_at ? new Date(thread.created_at).getTime() : null,
                rawArtifactId,
                runId
            )

            const threadDbId = threadResult.lastInsertRowid as number
            let position = 0

            if (thread.chat_messages) {
                for (const msg of thread.chat_messages) {
                    const content = msg.text || ''
                    const contentPlain = content.replace(/[#*`]/g, '').trim()
                    const contentHash = crypto.createHash('sha256').update(content).digest('hex')

                    insertMessage.run(
                        threadDbId,
                        'claude',
                        msg.uuid || null,
                        msg.sender || 'unknown',
                        content,
                        contentPlain,
                        msg.created_at ? new Date(msg.created_at).getTime() : null,
                        position++,
                        null, // No parent ID in Claude direct export usually
                        contentHash,
                        rawArtifactId,
                        runId
                    )
                }
            }
        }
    })

    transaction()
}
