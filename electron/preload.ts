import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    getVaultStatus: () => ipcRenderer.invoke('vault:status'),
    search: (query: string) => ipcRenderer.invoke('vault:search', query),
    startIngest: (provider: string, label: string) => ipcRenderer.invoke('vault:ingest:start', provider, label),
    storeArtifact: (runId: number, provider: string, type: string, filename: string, buffer: Buffer) =>
        ipcRenderer.invoke('vault:artifact:store', runId, provider, type, filename, buffer),
    finalizeIngest: (runId: number, status: string, error?: string) =>
        ipcRenderer.invoke('vault:ingest:finalize', runId, status, error),
    importFile: (provider: string) => ipcRenderer.invoke('vault:import:file', provider),
    wipeVault: () => ipcRenderer.invoke('vault:wipe'),
    getDiagnostics: () => ipcRenderer.invoke('vault:diagnostics:get'),
})
