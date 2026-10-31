# Changelog

All notable user-facing changes are recorded here. This project is in unstable beta; changes may be incompatible before a stable release.

## 0.1.0-beta.1 — 2026-10-31

- Established the Electron/React desktop app with a supervised Python JSONL agent sidecar.
- Added local Ollama and optional llama.cpp GGUF provider workflows, model discovery, and independent context/output/reasoning controls.
- Added project-bound file tools, scoped search, Git inspection, approval workflows, optional skills, MCP, live operation output, resumable sessions, and run recovery foundations.
- Corrected Ollama tool-result continuation, safe request-only transcript compaction, and context-aware project/skill retrieval.
- Verification: app typecheck, 43 Vitest, 38 sidecar pytest, 132 engine pytest; Windows x64 installer and ZIP built; packaged sidecar ping/shutdown passed. Full visible project workflow and live-model benchmarks remain open.
