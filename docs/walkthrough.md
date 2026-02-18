# Walkthrough

## Architecture

Cognition Vault is an Electron application (React renderer + Node.js backend) that stores all data locally in SQLite with FTS5 full-text search.

```
┌─────────────────────────────────────────────┐
│  Renderer (React)                           │
│  - Search UI, onboarding, diagnostics       │
│  - contextIsolation + sandbox               │
├─────────────────────────────────────────────┤
│  Preload (contextBridge)                    │
│  - Exposes safe IPC methods only            │
├─────────────────────────────────────────────┤
│  Main Process (Node.js)                     │
│  - IPC handlers: import, search, wipe       │
│  - Importers: ChatGPT, Claude, Gemini       │
│  - Vault: artifact storage, ingestion runs  │
│  - Database: SQLite + FTS5 index            │
└─────────────────────────────────────────────┘
```

### Data Flow

1. User selects a provider and a ZIP/JSON file.
2. The main process validates the ZIP (size limits, entry count, ratio check, path traversal scan).
3. Raw bytes are stored as artifacts on disk (`userData/vault/artifacts/`).
4. The provider-specific importer parses conversations into threads and messages.
5. Messages are indexed in FTS5 for instant full-text search.

### Trust Model

- **Raw before parsed**: Original export files are preserved on disk before any parsing.
- **SHA-256 deduplication**: Re-importing the same file (identical hash) is a safe no-op.
- **Transaction safety**: Imports run inside a SQLite transaction — partial failures roll back cleanly.

## Qualification Results

The project maintains an automated qualification suite that runs on every PR/push:

| Phase | What it tests | Cases |
|-------|--------------|-------|
| **Phase 1** | Positive ingestion + FTS sentinels | 3 providers × sentinel round-trip |
| **Phase 2A** | Failure modes | 11 cases (ZIP slip, ratio bomb, corrupt ZIP, size limits, malformed JSON, schema mismatch, HTML drift, transaction rollback, filesystem integrity) |
| **Phase 2B** | Scale (Tier 1) | 10k messages: import time + FTS latency |
| **Phase 3** | Integration (real code path) | 5 cases via compiled dist-electron modules |
| **Phase 4** | Distribution clarity | Docs guard + UI copy guard (no jargon regressions) |

Tier 2 scale (50k messages) runs nightly via a separate workflow.

## Benchmark Reference

Metrics recorded on the reference environment:

- **OS**: Windows 11 (x64)
- **CPU**: Intel Core i7-13700H
- **RAM**: 32GB DDR5
- **Storage**: NVMe SSD
- **Node**: 22.x / Electron 29.x

| Metric | Target | Typical |
|--------|--------|---------|
| 10k message import | < 30s | ~5s |
| FTS query (10k corpus) | < 50ms | ~2ms |
| Cold app launch | < 3s | ~1.5s |
