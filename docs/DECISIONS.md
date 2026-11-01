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

**Status:** Partially satisfied; final release gates remain. Earlier source/package checks passed, and the user now reports the long disposable website task succeeded after about 2–3 hours. Rebuild and verify the current updater/UI source before release. Record model settings and preserve any pre-existing runtime state; do not change the selected context/output/reasoning.

## D-006: Windows x64 update delivery through public GitHub Releases

**Status:** Accepted for the first public beta. Use Electron's built-in Squirrel.Windows `autoUpdater` against the Electron public update service for this public repository. Publish the Squirrel `RELEASES`, full `.nupkg`, and Setup executable together. Check/download in the background, but require an explicit user action to restart and install; never install during a model task. Leave GitHub's prerelease flag off because the public updater service omits GitHub-marked prereleases; retain the beta identifier in the SemVer tag/release title. Current V1 release artifacts target Windows x64 only. The app is unsigned; update hashes/checksums and HTTPS do not equal Authenticode verification.

## D-007: Preserve real-world slow successful development evidence

**Status:** Accepted. The user reports the simple disposable website task succeeded after approximately 2–3 hours on their PC. Keep it as a successful, long-running end-to-end case and improve observation/scroll ergonomics without changing user-selected context, output, or reasoning settings. This does not prove general task quality, reliability, performance, or release readiness.
