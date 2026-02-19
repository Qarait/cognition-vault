# RELEASES

## v1.1.0 — 2026-02-19

### What Changed
- **Packaged Smoke Gate (Phase 5)**: Every release candidate is now exercised as a packaged `.exe` against all 3 providers (ChatGPT, Claude, Gemini) before publishing. Smoke reports are forensic JSON with runtime metadata.
- **Migration Scaffolding (Phase 6)**: Ordered, transactional, idempotent schema migrator with deterministic FTS repair. Opening vaults created by older versions will always upgrade cleanly.
- **Release Integrity Pack (Phase 7C)**: Smoke JSON reports (`smoke_chatgpt.json`, `smoke_claude.json`, `smoke_gemini.json`) are now attached as release assets and included in `SHA256SUMS.txt`. Each release is a self-contained audit package.
- **Deterministic Smoke Output**: Smoke runner now writes reports via `--smoke-out <path>` instead of stdout piping, eliminating contamination risk.
- **Build vs Runtime Node Clarity**: Build toolchain uses Node 22 (CI/tsc/vite). Runtime uses Node 20.9 bundled with Electron 29. The version mismatch is expected and safe.

### Trust Boundaries (Unchanged)
- **Local-Only**: All processing happens strictly on your machine.
- **Zero Telemetry**: No analytics, crash reporting, or external network calls.
- **Forensic Preservation**: Raw artifacts stored before parsing.

### Verification
SHA256SUMS.txt covers installers **and** smoke reports.
```powershell
certutil -hashfile "cognition-vault Setup 1.1.0.exe" SHA256
```
Compare against values in `SHA256SUMS.txt` on the [v1.1.0 release page](https://github.com/Qarait/cognition-vault/releases/tag/v1.1.0).

### Windows SmartScreen
This build is currently unsigned, so Windows may show a SmartScreen warning. Only proceed if you downloaded it from the official [GitHub Release](https://github.com/Qarait/cognition-vault/releases/tag/v1.1.0) and verified the checksum. Click **"More info"** → **"Run anyway"** to continue.

---

## v1.0.0 — 2026-02-16

Cognition Vault V1 is a "vault-grade" local-first AI history archive prioritizing forensic integrity and performance.

### Trust Boundaries
- **Local-Only**: All processing (ingestion, parsing, indexing, search) happens strictly on your machine.
- **Zero Telemetry**: Cognition Vault does not include analytics, crash reporting, or external network calls by default. No network calls are performed unless the user explicitly clicks a link (e.g., opening the GitHub release page).
- **Forensic Preservation**: Raw artifacts are stored in `userData/vault/artifacts/` before parsing, ensuring source integrity.

### Security Posture
- **Renderer hardening**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` (renderer cannot access Node APIs).
- **No Node Integration**: The renderer has no direct access to Node.js APIs (fails closed).
- **Content Security**: All imported content is strictly sanitized and escaped before rendering (React-escaped).
- **Supply Chain**: Build reproducibility via pinned Node 22 toolchain and dependency lockfiles.

### Verification (Integrity Checksums)
To verify the integrity of your download, compare the SHA-256 hash of the installer against the values in `SHA256SUMS.txt`.

#### Windows
```powershell
certutil -hashfile "cognition-vault Setup 1.0.0.exe" SHA256
```


### Official Verification Record
- **GitHub Release**: [v1.0.0 Assets](https://github.com/Qarait/cognition-vault/releases/tag/v1.0.0)
- **SHA256SUMS.txt**: `96d6930f5b169792c5bd018562b36cd5436a74e48f9065f9a0cf81499b9d3c06  cognition-vault Setup 1.0.0.exe`

### Windows SmartScreen
This build is currently unsigned, so Windows may show a SmartScreen warning. Only proceed if you downloaded it from the official [GitHub Release](https://github.com/Qarait/cognition-vault/releases/tag/v1.0.0) and verified the checksum. Click **"More info"** → **"Run anyway"** to continue.

### Known Limitations
- **ZIP Limits**: Per-file limit (100MB), total uncompressed limit (1GB), and entry limit (10,000) enforced for safety.
- **`chat.html` Fallback**: Scraping `chat.html` is best-effort and may break if export formats drift significantly (hardened by fixture corpus + regression tests).
- **Deduplication**: Re-importing the same artifact (identical SHA-256) skips processing by design.

### Reference Benchmark Environment
Metrics in the [walkthrough](docs/walkthrough.md) were recorded in the following environment:
- **OS**: Win32 x64 (Windows 11)
- **CPU**: Intel Core i7-13700H
- **RAM**: 32GB DDR5
- **Storage**: NVMe SSD
- **Build Toolchain**: Node 22.x (CI, tsc, vite)
- **Runtime**: Node 20.9 bundled with Electron 29.x

