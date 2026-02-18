# Cognition Vault

A local-first, verbatim archive for your ChatGPT, Claude, and Gemini history — instantly searchable. Nothing is uploaded.

## Download

Get the latest release from the [GitHub Releases](https://github.com/Qarait/cognition-vault/releases/tag/v1.0.0) page and verify `SHA256SUMS.txt` before installing.

> **Windows SmartScreen**: This build is currently unsigned, so Windows may show a SmartScreen warning. Only proceed if you downloaded it from the official [GitHub Release](https://github.com/Qarait/cognition-vault/releases/tag/v1.0.0) and verified the checksum. Click **"More info"** → **"Run anyway"** to continue.

## Quick Start

1. **Export** your data from [ChatGPT](https://chatgpt.com), [Claude](https://claude.ai), or [Gemini](https://takeout.google.com).
2. **Import** the ZIP into Cognition Vault (click "Import your AI history").
3. **Search** your history and click a result to jump to the exact message.

See [docs/get-started.md](docs/get-started.md) for step-by-step instructions with screenshots.

## Trust Boundaries

- **Local-only processing** — all ingestion, parsing, indexing, and search happen on your machine.
- **Zero telemetry** — no analytics, crash reporting, or network calls.
- **Raw preservation** — original export files are stored before parsing, ensuring source integrity.
- **Renderer hardening** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.

## Docs

- [Get Started](docs/get-started.md) — export → import → search walkthrough
- [Walkthrough](docs/walkthrough.md) — architecture, qualification results, and benchmarks

## License

See [LICENSE](LICENSE) for details.
