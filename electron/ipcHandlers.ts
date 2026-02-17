import { ipcMain } from 'electron'
import { searchMessages } from './db'
import { createIngestionRun, storeRawArtifact, finalizeIngestionRun } from './vault'
import path from 'node:path'

export function registerHandlers() {
    ipcMain.handle('vault:diagnostics:get', () => {
        const { getDiagnostics } = require('./diagnostics')
        return getDiagnostics()
    })

    ipcMain.handle('vault:status', () => {
        const { ARTIFACTS_PATH } = require('./vault')
        return {
            status: 'secure',
            localOnly: true,
            vaultPath: ARTIFACTS_PATH
        }
    })

    ipcMain.handle('vault:search', async (_event, query: string) => {
        return searchMessages(query)
    })

    ipcMain.handle('vault:ingest:start', async (_event, provider: string, sourceLabel: string) => {
        return createIngestionRun(provider, sourceLabel)
    })

    ipcMain.handle('vault:artifact:store', async (_event, runId: number, provider: string, type: string, filename: string, buffer: Buffer) => {
        return storeRawArtifact(runId, provider, type, filename, buffer)
    })

    ipcMain.handle('vault:ingest:finalize', async (_event, runId: number, status: 'complete' | 'failed', error?: string) => {
        return finalizeIngestionRun(runId, status, error)
    })

    ipcMain.handle('vault:import:file', async (_event, provider: string) => {
        const { dialog } = require('electron')
        const fs = require('node:fs')
        const AdmZip = require('adm-zip')
        const { importChatGPT } = require('./importers/chatgpt')
        const { importClaude } = require('./importers/claude')
        const { importGemini } = require('./importers/gemini')

        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Allowed Exports', extensions: ['json', 'zip'] }]
        })

        if (result.canceled || result.filePaths.length === 0) return null

        const filePath = result.filePaths[0]
        const buffer = fs.readFileSync(filePath)
        const filename = path.basename(filePath)
        const isZip = filename.toLowerCase().endsWith('.zip')

        const run = createIngestionRun(provider, `Import: ${filename}`)
        const parentArtifact = storeRawArtifact(run.id, provider, isZip ? 'zip' : 'json', filename, buffer)

        try {
            if (isZip) {
                const zip = new AdmZip(buffer)
                const zipEntries = zip.getEntries()

                // ZIP Hardening: Decompression Limits (Vault-Grade)
                const MAX_ENTRIES = 10000
                const MAX_TOTAL_UNCOMPRESSED_SIZE = 1024 * 1024 * 1024 // 1GB
                const MAX_SINGLE_FILE_SIZE = 100 * 1024 * 1024 // 100MB
                const MAX_RATIO = 100 // Maximum 100:1 compression ratio

                if (zipEntries.length > MAX_ENTRIES) {
                    throw new Error(`Import blocked: this export contains too many files (${zipEntries.length} > ${MAX_ENTRIES}). Cognition Vault keeps imports local and safe.`)
                }

                // Pre-scan for safety limits before any processing (Atomic Failure)
                let totalUncompressedSize = 0
                for (const entry of zipEntries) {
                    if (entry.isDirectory) continue
                    const header = entry.header as any
                    const uncompressedSize = header.size || 0
                    const compressedSize = header.compressedSize || 1
                    const ratio = uncompressedSize / compressedSize

                    if (uncompressedSize > MAX_SINGLE_FILE_SIZE) {
                        throw new Error(`Import blocked: one file in this export is larger than 100MB. Cognition Vault keeps imports local and safe. Please remove the file or split the export and try again.`)
                    }
                    if (ratio > MAX_RATIO) {
                        throw new Error(`Import blocked: one file in this export has an extreme compression ratio. Cognition Vault protects against malicious archives.`)
                    }
                    totalUncompressedSize += uncompressedSize
                    if (totalUncompressedSize > MAX_TOTAL_UNCOMPRESSED_SIZE) {
                        throw new Error(`Import blocked: total uncompressed size exceeds 1GB limit. Cognition Vault ensures your disk space is used safely.`)
                    }
                }

                // If pre-scan passes, proceed with extraction and storage
                for (const entry of zipEntries) {
                    if (entry.isDirectory) continue
                    const entryName = entry.entryName
                    const entryBuffer = entry.getData()

                    // Forensic storage of individual files within ZIP
                    const childArtifact = storeRawArtifact(
                        run.id,
                        provider,
                        path.extname(entryName).slice(1) || 'bin',
                        path.basename(entryName),
                        entryBuffer,
                        parentArtifact.id,
                        entryName
                    )

                    // Specific logic for known export formats
                    let processed = false
                    if (provider === 'chatgpt') {
                        if (entryName === 'conversations.json' || entryName.endsWith('/conversations.json')) {
                            await importChatGPT(run.id, childArtifact.id, entryBuffer.toString('utf-8'))
                            processed = true
                        } else if (entryName === 'chat.html' || entryName.endsWith('/chat.html')) {
                            // Only parse chat.html if no conversations.json was found/processed in this run (simplified logic)
                            // In a real vault, we'd prefer JSON but keep HTML for visual reference.
                            const { importChatGPTfromHTML } = require('./importers/chatgpt')
                            await importChatGPTfromHTML(run.id, childArtifact.id, entryBuffer.toString('utf-8'))
                            processed = true
                        }
                    } else if (provider === 'claude' && entryName.endsWith('.json')) {
                        // Official Claude exports usually have one or more JSON files
                        await importClaude(run.id, childArtifact.id, entryBuffer.toString('utf-8'))
                        processed = true
                    } else if (provider === 'gemini' && entryName.endsWith('.json')) {
                        // Gemini Takeout: look for conversations.json or similar
                        await importGemini(run.id, childArtifact.id, entryBuffer.toString('utf-8'))
                        processed = true
                    }
                }
            } else {
                const content = buffer.toString('utf-8')
                if (provider === 'chatgpt') {
                    await importChatGPT(run.id, parentArtifact.id, content)
                } else if (provider === 'claude') {
                    await importClaude(run.id, parentArtifact.id, content)
                } else if (provider === 'gemini') {
                    await importGemini(run.id, parentArtifact.id, content)
                }
            }

            finalizeIngestionRun(run.id, 'complete')
            return { success: true, runId: run.id, artifactId: parentArtifact.id }
        } catch (err: any) {
            finalizeIngestionRun(run.id, 'failed', err.message)
            throw err
        }
    })

    ipcMain.handle('vault:wipe', async () => {
        const { wipeVault } = require('./vault')
        wipeVault()
        return { success: true }
    })
}
