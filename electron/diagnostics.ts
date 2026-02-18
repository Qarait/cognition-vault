import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { getDb } from './db'
import { paths } from './paths'

/**
 * Privacy-Safe Diagnostics (Vault-Grade)
 * 
 * Rules:
 * 1. ZERO message/thread content (never query these tables)
 * 2. NO user strings (no titles, labels, filenames, or paths)
 * 3. NO raw error strings (map to codes)
 */

export const ErrorCodes = {
    ZIP_ENTRY_TOO_LARGE: 'ZIP_ENTRY_TOO_LARGE',
    ZIP_TOTAL_TOO_LARGE: 'ZIP_TOTAL_TOO_LARGE',
    ZIP_TOO_MANY_ENTRIES: 'ZIP_TOO_MANY_ENTRIES',
    ZIP_CORRUPT: 'ZIP_CORRUPT',
    PARSE_CHAT_HTML_FAILED: 'PARSE_CHAT_HTML_FAILED',
    PARSE_JSON_FAILED: 'PARSE_JSON_FAILED',
    DB_WRITE_FAILED: 'DB_WRITE_FAILED',
    FS_WRITE_FAILED: 'FS_WRITE_FAILED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
}

export function getDiagnostics() {
    const db = getDb()
    const now = new Date().toISOString()

    // 1. App & Runtime
    const runtime = {
        platform: process.platform,
        arch: process.arch,
        os_release: require('node:os').release(),
        electron: process.versions.electron,
        node: process.versions.node
    }

    const appInfo = {
        version: app.getVersion(),
        is_packaged: app.isPackaged
    }

    // 2. Vault Stats (Allowlist Only)
    const schema_version = (db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string } | undefined)?.value || 'unknown'
    const db_stat = fs.statSync(paths().dbPath)

    let artifacts_total_bytes = 0
    try {
        const files = fs.readdirSync(paths().artifactsDir)
        for (const f of files) {
            artifacts_total_bytes += fs.statSync(path.join(paths().artifactsDir, f)).size
        }
    } catch (e) { }

    // 3. Ingestion Stats (Sanitized)
    const run_stats = db.prepare(`
        SELECT 
            status, 
            COUNT(*) as count 
        FROM ingestion_runs 
        GROUP BY status
    `).all() as { status: string, count: number }[]

    const recent_runs = db.prepare(`
        SELECT 
            provider, 
            started_at, 
            completed_at, 
            status,
            error_message -- We will map this to code below
        FROM ingestion_runs 
        ORDER BY started_at DESC 
        LIMIT 5
    `).all() as any[]

    const sanitized_recent_runs = recent_runs.map(run => {
        let error_code = null
        let error_detail = null

        if (run.status === 'failed' && run.error_message) {
            // Map common errors to codes
            if (run.error_message.includes('too many files')) error_code = ErrorCodes.ZIP_TOO_MANY_ENTRIES
            else if (run.error_message.includes('larger than 100MB')) error_code = ErrorCodes.ZIP_ENTRY_TOO_LARGE
            else if (run.error_message.includes('extreme compression ratio')) error_code = ErrorCodes.ZIP_CORRUPT
            else if (run.error_message.includes('exceeds 1GB limit')) error_code = ErrorCodes.ZIP_TOTAL_TOO_LARGE
            else error_code = ErrorCodes.UNKNOWN_ERROR

            error_detail = run.error_message.substring(0, 100).replace(/C:\\\S+| \/\S+/g, '[PATH_REDACTED]')
        }

        return {
            provider: run.provider,
            started_at: run.started_at,
            completed_at: run.completed_at,
            status: run.status,
            error_code,
            error_detail
        }
    })

    // 4. Artifact Aggregates
    const artifact_counts = db.prepare(`
        SELECT 
            provider, 
            artifact_type, 
            COUNT(*) as count, 
            SUM(byte_size) as total_bytes
        FROM raw_artifacts 
        GROUP BY provider, artifact_type
    `).all() as any[]

    // 5. Integrity Checks
    let sqlite_integrity = 'unchecked'
    try {
        sqlite_integrity = (db.prepare('PRAGMA quick_check').get() as any).quick_check
    } catch (e) { }

    return {
        generated_at: now,
        app: appInfo,
        runtime,
        vault: {
            schema_version,
            db_size_bytes: db_stat.size,
            artifacts_total_bytes,
            fts_enabled: true
        },
        ingestion: {
            runs_summary: run_stats.reduce((acc: any, curr) => ({ ...acc, [curr.status]: curr.count }), {}),
            recent_runs: sanitized_recent_runs
        },
        artifacts: artifact_counts.map(a => ({
            provider: a.provider,
            type: a.artifact_type,
            count: a.count,
            total_bytes: a.total_bytes
        })),
        health: {
            sqlite_integrity_check: sqlite_integrity
        }
    }
}
