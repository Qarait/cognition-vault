import { getDb } from './db'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { paths } from './paths'

export interface IngestionRun {
  id: number
  provider: string
  source_label?: string
  status: string
}

export function createIngestionRun(provider: string, sourceLabel?: string): IngestionRun {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO ingestion_runs (provider, status, source_label)
    VALUES (?, ?, ?)
  `).run(provider, 'running', sourceLabel || null)

  return {
    id: result.lastInsertRowid as number,
    provider,
    source_label: sourceLabel,
    status: 'running'
  }
}

export function finalizeIngestionRun(runId: number, status: 'complete' | 'failed', errorMessage?: string) {
  const db = getDb()
  db.prepare(`
    UPDATE ingestion_runs
    SET status = ?, completed_at = ?, error_message = ?
    WHERE id = ?
  `).run(status, Date.now(), errorMessage || null, runId)
}

export function storeRawArtifact(
  runId: number,
  provider: string,
  artifactType: string,
  filename: string,
  buffer: Buffer,
  parentArtifactId?: number,
  pathInArchive?: string
) {
  const db = getDb()
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

  // Check for idempotency (Trust Moat #2)
  const existing = db.prepare('SELECT id FROM raw_artifacts WHERE sha256 = ?').get(sha256) as { id: number } | undefined
  if (existing) {
    return { id: existing.id as number, skipped: true }
  }

  // Sanitize filename to prevent ZIP Slip / Path Traversal
  const safeFilename = path.basename(filename)
  const storedFilename = `${sha256}-${safeFilename}`
  const storedPath = path.join(paths().artifactsDir, storedFilename)

  fs.writeFileSync(storedPath, buffer)

  const result = db.prepare(`
    INSERT INTO raw_artifacts (
      ingestion_run_id, parent_artifact_id, provider, artifact_type,
      filename, path_in_archive, byte_size, sha256, stored_path, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId, parentArtifactId || null, provider, artifactType,
    safeFilename, pathInArchive || null, buffer.length, sha256, storedPath, Date.now()
  )

  return { id: result.lastInsertRowid as number, skipped: false }
}

export function wipeVault() {
  const db = getDb()
  const errors: string[] = []
  const artifactsDir = paths().artifactsDir

  // Clear disk artifacts first (so we can fail before DB mutation if needed, though they are decoupled)
  try {
    const files = fs.readdirSync(artifactsDir)
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(artifactsDir, file))
      } catch (e: any) {
        errors.push(`Failed to delete ${file}: ${e.message}`)
      }
    }
  } catch (e: any) {
    errors.push(`Failed to read artifacts directory: ${e.message}`)
  }

  if (errors.length > 0) {
    throw new Error(`Vault wipe partially failed:\n${errors.join('\n')}`)
  }

  db.transaction(() => {
    db.exec('DELETE FROM messages')
    db.exec('DELETE FROM threads')
    db.exec('DELETE FROM raw_artifacts')
    db.exec('DELETE FROM ingestion_runs')
  })()
}
