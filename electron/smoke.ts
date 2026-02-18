/**
 * Packaged-build smoke runner (Phase 5).
 *
 * Called from main.ts when --smoke is passed.
 * Exercises the real production import → FTS search → wipe pipeline
 * on the packaged exe, with zero BrowserWindow involvement.
 *
 * Exit codes:
 *   0 — pass (all assertions held)
 *   1 — fail (printed JSON report with error_code to stdout)
 *
 * The JSON report is forensic-grade: it includes runtime metadata so
 * every smoke artifact in CI is self-describing.
 */
import { app } from 'electron'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { importFileHeadless } from './ipcHandlers'
import { searchMessages } from './db'
import { wipeVault } from './vault'

interface SmokeArgs {
    vaultDir: string
    importFile: string
    sentinel: string
    provider: string
}

interface SmokeReport {
    // ── Forensic metadata ─────────────────────────────────────
    app_version: string
    commit_sha: string
    electron_version: string
    node_version: string
    platform: string
    // ── Test identity ─────────────────────────────────────────
    provider: string
    fixture_name: string
    sentinel: string
    // ── Results ───────────────────────────────────────────────
    pass: boolean
    import_ms: number
    search_hits: number
    search_ms: number
    wipe_ok: boolean
    post_wipe_hits: number
    error_code?: string
    error_message?: string
}

function getCommitSha(): string {
    // In CI, GITHUB_SHA is always set. Fallback to git for local runs.
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12)
    try {
        return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf-8' }).trim()
    } catch {
        return 'unknown'
    }
}

export async function runSmoke(args: SmokeArgs): Promise<void> {
    const report: Partial<SmokeReport> = {
        // Forensic metadata (populated immediately)
        app_version: app.getVersion(),
        commit_sha: getCommitSha(),
        electron_version: process.versions.electron || 'unknown',
        node_version: process.versions.node || 'unknown',
        platform: `${process.platform}-${process.arch}`,
        // Test identity
        provider: args.provider,
        fixture_name: path.basename(args.importFile),
        sentinel: args.sentinel,
        pass: false,
    }

    try {
        // ── 1. Import ────────────────────────────────────────────────────────
        const t0 = Date.now()
        await importFileHeadless(args.provider, args.importFile)
        report.import_ms = Date.now() - t0

        // ── 2. FTS sentinel search ───────────────────────────────────────────
        const t1 = Date.now()
        const hits = searchMessages(args.sentinel)
        report.search_ms = Date.now() - t1
        report.search_hits = hits.length

        if (hits.length === 0) {
            report.error_code = 'SENTINEL_NOT_FOUND'
            report.error_message = `FTS returned 0 results for sentinel "${args.sentinel}"`
            console.log(JSON.stringify(report, null, 2))
            process.exit(1)
        }

        // ── 3. Wipe ─────────────────────────────────────────────────────────
        wipeVault()
        report.wipe_ok = true

        // ── 4. Post-wipe verification ────────────────────────────────────────
        const postWipeHits = searchMessages(args.sentinel)
        report.post_wipe_hits = postWipeHits.length

        if (postWipeHits.length !== 0) {
            report.error_code = 'WIPE_INCOMPLETE'
            report.error_message = `FTS still returned ${postWipeHits.length} results after wipe`
            console.log(JSON.stringify(report, null, 2))
            process.exit(1)
        }

        // ── All clear ───────────────────────────────────────────────────────
        report.pass = true
        console.log(JSON.stringify(report, null, 2))
        // Exit 0 is implicit — main.ts calls app.quit() after this returns

    } catch (err: any) {
        report.error_code = 'SMOKE_EXCEPTION'
        report.error_message = err.message
        console.error(JSON.stringify(report, null, 2))
        process.exit(1)
    }
}
