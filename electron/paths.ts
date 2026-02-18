/**
 * Centralized vault path configuration.
 *
 * NO module in the electron/ tree should call app.getPath('userData') at import
 * time. Instead call initPaths(userDataDir) once in main.ts (after any --smoke
 * override) and then read paths() everywhere else.
 *
 * This eliminates the entire class of "path-computed-before-setPath" timing
 * bugs and makes every dependent module safe to import in any order.
 */
import path from 'node:path'

export interface VaultPaths {
    /** Root per-user data directory (app.getPath('userData') or smoke override) */
    userDataDir: string
    /** <userDataDir>/vault */
    vaultDir: string
    /** <vaultDir>/vault.db */
    dbPath: string
    /** <vaultDir>/artifacts */
    artifactsDir: string
}

let _paths: VaultPaths | null = null

/**
 * Initialise the global path configuration.
 * Must be called exactly once from main.ts before any vault / db work.
 */
export function initPaths(userDataDir: string): VaultPaths {
    if (_paths) throw new Error('initPaths() called twice — this is a bug.')
    const vaultDir = path.join(userDataDir, 'vault')
    _paths = {
        userDataDir,
        vaultDir,
        dbPath: path.join(vaultDir, 'vault.db'),
        artifactsDir: path.join(vaultDir, 'artifacts'),
    }
    return _paths
}

/**
 * Return the initialised path configuration.
 * Throws if called before initPaths() — a deliberate fail-fast guard.
 */
export function paths(): VaultPaths {
    if (!_paths) throw new Error('paths() called before initPaths(). Fix boot order.')
    return _paths
}

/**
 * Reset paths (test-only). Not exported from the package index.
 */
export function _resetPaths(): void {
    _paths = null
}
