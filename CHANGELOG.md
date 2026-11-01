# Changelog

All notable user-facing changes are recorded here. This project is in unstable beta; changes may be incompatible before a stable release.

## 0.1.0-beta.2 — unreleased

- Added a first-run checklist and a direct path to recover an unavailable Ollama installation.
- Added background GitHub Release checks and downloads for installed Windows x64 builds, with explicit user-controlled restart and task-safe installation.
- Kept streaming chat at the latest message only when the reader is already following live output; added a jump-to-latest control.
- Made compact tool activity easier to scan while retaining expandable, complete operation details.
- Preserved clickable installed-model orbit markers and model detail cards, including outside-click and Escape dismissal.
- Added a public Windows beta release workflow, release runbook, checksums, and historical acceptance screenshots.
- Corrected the updater feed route to match Electron's documented `/{owner}/{repo}/{platform}-{arch}/{version}` form.
- Verification and packaged release acceptance are pending; see `docs/ACCEPTANCE_LOG.md`.

## 0.1.0-beta.1 — 2026-10-31

- Established the Electron/React desktop app with a supervised Python JSONL agent sidecar.
- Added local Ollama and optional llama.cpp GGUF provider workflows, model discovery, and independent context/output/reasoning controls.
- Added project-bound file tools, scoped search, Git inspection, approval workflows, optional skills, MCP, live operation output, resumable sessions, and run recovery foundations.
- Corrected Ollama tool-result continuation, safe request-only transcript compaction, and context-aware project/skill retrieval.
- Verification: app typecheck, 43 Vitest, 38 sidecar pytest, 132 engine pytest; Windows x64 installer and ZIP built; packaged sidecar ping/shutdown passed. Full visible project workflow and live-model benchmarks remain open.
