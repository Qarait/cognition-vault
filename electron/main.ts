import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { initPaths, paths } from './paths'
import { initDb } from './db'
import { registerHandlers } from './ipcHandlers'
import { runSmoke } from './smoke'

// ── Smoke mode arg parsing (before any path computation) ────────────────
interface SmokeArgs {
    vaultDir: string
    importFile: string
    sentinel: string
    provider: string
}

function parseSmokeArgs(): SmokeArgs | null {
    const argv = process.argv
    const smokeIdx = argv.indexOf('--smoke')
    if (smokeIdx === -1) return null

    const get = (flag: string): string => {
        const idx = argv.indexOf(flag)
        if (idx === -1 || idx + 1 >= argv.length) throw new Error(`--smoke requires ${flag}`)
        return argv[idx + 1]
    }

    return {
        vaultDir: get('--vault-dir'),
        importFile: get('--import'),
        sentinel: get('--sentinel'),
        provider: argv.includes('--provider') ? get('--provider') : 'chatgpt',
    }
}

const smokeArgs = parseSmokeArgs()

// ── Smoke: override userData before anything computes paths ─────────────
if (smokeArgs) {
    app.disableHardwareAcceleration()
    app.setPath('userData', smokeArgs.vaultDir)
}

// ── Initialize paths (single source of truth) ──────────────────────────
initPaths(app.getPath('userData'))

function initVault() {
    const p = paths()
    if (!fs.existsSync(p.vaultDir)) {
        fs.mkdirSync(p.vaultDir, { recursive: true })
    }
    if (!fs.existsSync(p.artifactsDir)) {
        fs.mkdirSync(p.artifactsDir, { recursive: true })
    }
    initDb()
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
        title: 'Cognition Vault',
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'))
    }
}

app.whenReady().then(async () => {
    initVault()

    if (smokeArgs) {
        // Headless smoke test — no window, no IPC
        await runSmoke(smokeArgs)
        app.quit()
        return
    }

    registerHandlers()
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// IPC Handlers (Placeholders for Vault IO)
ipcMain.handle('vault:status', () => {
    return { status: 'secure', localOnly: true }
})
