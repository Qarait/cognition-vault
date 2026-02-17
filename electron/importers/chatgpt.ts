import { getDb } from '../db'
import crypto from 'node:crypto'

export async function importChatGPT(runId: number, rawArtifactId: number, jsonContent: string) {
    const db = getDb()
    const data = JSON.parse(jsonContent)

    if (!Array.isArray(data)) {
        throw new Error('Invalid ChatGPT export format: expected array')
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

    // Transaction for individual thread/message insertion
    const transaction = db.transaction(() => {
        for (const thread of data) {
            const threadResult = insertThread.run(
                'chatgpt',
                thread.id || null,
                thread.title || 'Untitled Conversation',
                thread.create_time ? Math.floor(thread.create_time * 1000) : null,
                rawArtifactId,
                runId
            )

            const threadDbId = threadResult.lastInsertRowid as number
            let position = 0

            // In ChatGPT JSON, mapping contains the messages in a node structure
            if (thread.mapping) {
                for (const [msgId, node] of Object.entries<any>(thread.mapping)) {
                    const message = node.message
                    if (!message || !message.content || message.content.content_type !== 'text') continue

                    const content = message.content.parts.join('\n')
                    const contentPlain = content.replace(/[#*`]/g, '').trim() // Basic normalization
                    const contentHash = crypto.createHash('sha256').update(content).digest('hex')

                    insertMessage.run(
                        threadDbId,
                        'chatgpt',
                        msgId,
                        message.author.role,
                        content,
                        contentPlain,
                        message.create_time ? Math.floor(message.create_time * 1000) : null,
                        position++,
                        node.parent || null,
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

export async function importChatGPTfromHTML(runId: number, rawArtifactId: number, htmlContent: string) {
    const db = getDb()

    // Basic regex for titles and messages in ChatGPT chat.html
    // Note: This is a fallback; JSON is always preferred for forensic precision.
    const threadTitleRegex = /<title>(.*?)<\/title>/i
    const titleMatch = htmlContent.match(threadTitleRegex)
    const title = titleMatch ? titleMatch[1] : 'Imported Conversation (HTML fallback)'

    const insertThread = db.prepare(`
        INSERT INTO threads (provider, title, raw_artifact_id, ingestion_run_id)
        VALUES (?, ?, ?, ?)
    `)

    const insertMessage = db.prepare(`
        INSERT INTO messages (
            thread_id, provider, role, content, content_plain,
            position, content_hash, raw_artifact_id, ingestion_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    db.transaction(() => {
        const threadResult = insertThread.run('chatgpt', title, rawArtifactId, runId)
        const threadDbId = threadResult.lastInsertRowid as number
        let position = 0

        // This is a naive regex-based extraction. 
        // ChatGPT HTML exports typically have messages in blocks.
        // We'll look for blocks that look like messages.
        const messageRegex = /<div class="message">([\s\S]*?)<\/div>/g
        const roleRegex = /<div class="author">(.*?)<\/div>/i
        const textRegex = /<div class="content">([\s\S]*?)<\/div>/i

        let match
        while ((match = messageRegex.exec(htmlContent)) !== null) {
            const block = match[1]
            const roleMatch = block.match(roleRegex)
            const textMatch = block.match(textRegex)

            if (textMatch) {
                const role = roleMatch ? roleMatch[1].toLowerCase() : 'unknown'
                const content = textMatch[1].trim()
                const contentPlain = content.replace(/<[^>]*>?/gm, '').trim() // Strip HTML tags
                const contentHash = crypto.createHash('sha256').update(content).digest('hex')

                insertMessage.run(
                    threadDbId,
                    'chatgpt',
                    role,
                    content,
                    contentPlain,
                    position++,
                    contentHash,
                    rawArtifactId,
                    runId
                )
            }
        }
    })()
}
