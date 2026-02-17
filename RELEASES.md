# RELEASES

## v1.0.0 — 2026-02-16

Cognition Vault V1 is a "vault-grade" local-first AI history archive prioritizing forensic integrity and performance.

### Trust Boundaries
- **Local-Only**: All processing (ingestion, parsing, indexing, search) happens strictly on your machine.
- **Zero Telemetry**: Cognition Vault does not include analytics, crash reporting, or external network calls by default.
- **Forensic Preservation**: Raw artifacts are stored in `userData/vault/artifacts/` before parsing, ensuring source integrity.

### Security Posture
- **Renderer Sandboxing**: The Chromium renderer is sandboxed with `contextIsolation: true`.
- **No Node Integration**: The renderer has no direct access to Node.js APIs (fails closed).
- **Content Security**: All imported content is strictly sanitized and escaped before rendering (React-escaped).
- **Supply Chain**: Build reproducibility via pinned Node 22 toolchain and dependency lockfiles.

### Verification (Integrity Checksums)
To verify the integrity of your download, compare the SHA-256 hash of the installer against the values in `SHA256SUMS.txt`.

#### Windows
```powershell
certutil -hashfile cognition-vault-setup-1.0.0.exe SHA256
```

#### macOS / Linux
```bash
shasum -a 256 cognition-vault-setup-1.0.0.dmg
# OR
sha256sum cognition-vault-setup-1.0.0.AppImage
```

### Official Verification Record
- **GitHub Release**: [v1.0.0 Assets](https://github.com/USER/cognition-vault/releases/tag/v1.0.0)
- **SHA256SUMS.txt**: (Paste contents from the official release file here after tag push)

### Known Limitations
- **ZIP Limits**: Per-file limit (100MB), total uncompressed limit (1GB), and entry limit (10,000) enforced for safety.
- **`chat.html` Fallback**: Scrapping `chat.html` is best-effort and may break if export formats drift significantly.
- **Deduplication**: Re-importing the same artifact (identical SHA-256) skips processing by design.

### Reference Benchmark Environment
Metrics in the [walkthrough](walkthrough.md) were recorded in the following environment:
- **OS**: Win32 x64 (Windows 11)
- **CPU**: Intel Core i7-13700H
- **RAM**: 32GB DDR5
- **Storage**: NVMe SSD
- **Node**: 22.x
- **Electron**: 29.x
