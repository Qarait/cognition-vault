import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { initDb } from './db'
import { registerHandlers } from './ipcHandlers'

const VAULT_PATH = path.join(app.getPath('userData'), 'vault')
const ARTIFACTS_PATH = path.join(VAULT_PATH, 'artifacts')

function initVault() {
    if (!fs.existsSync(VAULT_PATH)) {
        fs.mkdirSync(VAULT_PATH, { recursive: true })
    }
    if (!fs.existsSync(ARTIFACTS_PATH)) {
        fs.mkdirSync(ARTIFACTS_PATH, { recursive: true })
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

app.whenReady().then(() => {
    initVault()
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
