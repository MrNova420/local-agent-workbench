# Decision log

## D-001: New Electron application, separate repository

**Status:** Accepted. Build a new desktop product with Electron, React, and TypeScript. Do not reuse the Tkinter UI or its layout. Keep the earlier app and CLI separate.

## D-002: Reuse the Python engine through a packaged sidecar

**Status:** Accepted for V1. Electron main supervises a newline-delimited JSON worker. Package its Python runtime and engine dependencies; the installed app must not depend on the old app folder. A TypeScript engine rewrite follows only after V1 reliability.

## D-003: Preserve model defaults and explicit context/output settings

**Status:** Accepted. Discover models dynamically. Preserve reasoning defaults and expose model controls only when provider capability information is available. Pass explicit context and output caps unchanged, and show effective allocation. GGUF loads require explicit user action through llama.cpp. Do not auto-load models or stop a runtime the app did not start.

## D-004: Approval and project isolation

**Status:** Accepted. Default to per-action approval and ask-before-write. Capture project/session inputs per turn, allow one active turn, and prevent session rebinding to a different project. Local MCP is user-configured and explicitly approved at call time.

## D-005: Verification gate before live model run

**Status:** In progress. Mocked checks and Windows package build pass. Perform the expanded visible disposable-project workflow before the approved live model measurement. Record pre-run Ollama/runtime state and leave pre-existing model state intact. A Windows package build is being run for this checkpoint; it has not yet been verified in this log.
