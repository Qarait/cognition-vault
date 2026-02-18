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
 */
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
    pass: boolean
    provider: string
    sentinel: string
    import_ms: number
    search_hits: number
    search_ms: number
    wipe_ok: boolean
    post_wipe_hits: number
    error_code?: string
    error_message?: string
}

export async function runSmoke(args: SmokeArgs): Promise<void> {
    const report: Partial<SmokeReport> = {
        provider: args.provider,
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
