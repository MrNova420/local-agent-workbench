# Changelog

All notable user-facing changes are recorded here. This project is in unstable beta; changes may be incompatible before a stable release.

## Unreleased

- Correlated chat activity to its originating turn so tool steps appear alongside the task that caused them and remain attached after session restoration.
- Deduplicated and stably arranged Home model markers, with installed-model catalog refresh while Home is open; zero installed models still means zero model dots.
- Added top-right hover-revealed minimize, maximize/restore, and close controls while preserving the app's running-task close decision.
- Paired the desktop source and CI/release workflows to the committed engine continuation that turns a model's prose-only command-permission question into a structured tool request; the normal approval prompt still authorizes execution.
- Documented the monotonic beta patch/tag cadence and updater-compatible release steps; no tag or release was created for this unverified worktree.
- Refined chat tool activity into small clickable text rows with expandable full operation details; the worksheet Activity Trace remains a detailed panel.

## 0.1.0-beta.2 — 2026-10-31

- Added a first-run checklist and a direct path to recover an unavailable Ollama installation.
- Added background GitHub Release checks and downloads for installed Windows x64 builds, with explicit user-controlled restart and task-safe installation.
- Kept streaming chat at the latest message only when the reader is already following live output; added a jump-to-latest control.
- Made compact tool activity easier to scan while retaining expandable, complete operation details.
- Preserved clickable installed-model orbit markers and model detail cards, including outside-click and Escape dismissal.
- Added a public Windows beta release workflow, release runbook, checksums, and historical acceptance screenshots.
- Corrected the updater feed route to match Electron's documented `/{owner}/{repo}/{platform}-{arch}/{version}` form.
- Local verification: TypeScript typecheck; 52 desktop Vitest tests; 44 sidecar pytest tests; 140 shared-engine pytest tests; Windows x64 Squirrel installer and portable ZIP built; bundled sidecar JSONL ready/ping/shutdown passed; packaged Home, model detail popover, and run-configuration values visually checked. No model request was issued.
- GitHub Actions did not start a runner for source-check pushes (zero steps, runner ID 0); the local checks above passed independently. Squirrel installation/upgrade and updater discovery require a later installed-build/update cycle; see `docs/ACCEPTANCE_LOG.md`.

## 0.1.0-beta.1 — 2026-10-31

- Established the Electron/React desktop app with a supervised Python JSONL agent sidecar.
- Added local Ollama and optional llama.cpp GGUF provider workflows, model discovery, and independent context/output/reasoning controls.
- Added project-bound file tools, scoped search, Git inspection, approval workflows, optional skills, MCP, live operation output, resumable sessions, and run recovery foundations.
- Corrected Ollama tool-result continuation, safe request-only transcript compaction, and context-aware project/skill retrieval.
- Verification: app typecheck, 43 Vitest, 38 sidecar pytest, 132 engine pytest; Windows x64 installer and ZIP built; packaged sidecar ping/shutdown passed. Full visible project workflow and live-model benchmarks remain open.
