# Visible Acceptance Log

Date: 2026-10-30  
Build: Windows x64 Electron Forge package and Squirrel installer  
Workspace: `work/acceptance-empty` (disposable)  
Model: `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`

## Workflow evidence

- The packaged app discovered 20 locally installed Ollama models and selected the exact tag above.
- The selected session showed the full 262,144-token context, with reasoning left at the model default. Ollama `/api/ps` later reported `context_length: 262144` for the loaded tag.
- The visible workspace path stayed at `work/acceptance-empty` while opening and resuming session `1a7c7cf3`.
- A short hello received a response. The coding task created `calculator.py` and `test_calculator.py` after per-action approval, then ran `python -m unittest -v` after approval; all four tests passed.
- A long generation was cancelled through the visible Cancel request control. The app returned to an idle/ready state and the existing Ollama model remained loaded.
- The same session was resumed with its transcript and workspace path intact.
- A follow-up prompt, `Reply with exactly: Ready. Do not use tools.`, was submitted from the prompt field with Enter. The visible app completed it and populated the new measurements. The rendered response also included extra project-file context, so the exact-output instruction was not fully followed.

## Live measurement

The follow-up turn displayed:

| Measurement | Observed |
| --- | ---: |
| First token | 19.4 s |
| Ollama output speed | 1.9 tokens/s |
| Ollama output tokens | 179 |
| Effective Ollama context | 262,144 tokens |
| App RAM reading during generation | about 29.9 / 32 GB |
| Idle RAM reading after completion | about 29.6 / 32 GB |
| GPU VRAM reading after completion | 3,619 / 4,096 MiB |

These are observations from the UI and Ollama's loaded-model endpoint, not a sampled peak-memory benchmark. Earlier visible work reached about 31.2 / 32 GB RAM. No peak VRAM sample was recorded. The model remained loaded; this check did not unload it.

Live-rate and token estimates are now derived from streamed response text and refresh with the app's one-second elapsed-time tick. The value is marked with `~` while generation is active; Ollama's `eval_count` and `eval_duration` replace the estimate when the response completes. Since Ollama exposes exact usage only at completion, interim token counts are explicitly approximate.

After rebuilding the package with this behavior, a visible streaming check on the same model, context, workspace, and session showed `~2.0 tokens/s` / `~2 tokens` at 21 seconds, then `~2.5 tokens/s` / `~74 tokens` at 50 seconds and `~2.3 tokens/s` / `~116 tokens` at 71 seconds. On completion the exact Ollama values replaced them: 20.0 seconds to first token, 1.8 tokens/s, and 163 output tokens. This confirmed both live refresh and final exact-value replacement in the packaged app.

A second visible check using the rebuilt package confirmed the final sidecar event path: while generating, the UI showed `~2.2 tokens/s` / `~6 tokens` at 17 seconds; on completion it replaced those estimates with Ollama's exact values of 13.9 seconds to first token, 1.8 tokens/s, and 48 output tokens. Ollama usage is now emitted for each response in the agent's tool loop as well as the final response.

## Verification and remaining limits

- Automated suite at this milestone: 8 Vitest tests and 16 Pytest tests passed; TypeScript typecheck passed.
- `npm run make` produced the Windows x64 package, Squirrel installer, and ZIP. The Python worker was bundled with the package.
- The visible run verified chat, approvals, file changes, test command/output, cancellation, session recovery, full context, and live generation measurements.
- MCP discovery/calls have mocked coverage only; no real stdio server was exercised in this acceptance run.
- Resource figures are point observations, not peak measurements. A longer coding benchmark with RAM/VRAM sampling is still needed before making performance or peak-memory claims.

## 2026-10-31 provider-expansion implementation checkpoint

- App `npm run typecheck` passed.
- App `npm test` passed: 12 Vitest tests and 20 sidecar tests. One third-party Starlette `multipart` pending-deprecation warning remains.
- Existing engine `python -m pytest -q` passed: 82 tests. The same third-party warning remains.
- New automated coverage exercises provider identity/routing, Hub search and pinned file downloads, credential-safe redirects/path traversal rejection, llama.cpp streaming/tool deltas and usage, exact context/output settings, external server ownership protection, and session-provider migration.
- Windows x64 package/installer build is in progress. No packaged visual workflow for the new model library or GGUF path has been accepted yet. No Hugging Face model was downloaded, no llama.cpp binary was installed or selected, and no GGUF was loaded during these automated checks.
- The earlier visible Ollama acceptance above is historical evidence for the previous app build and does not establish the expanded provider workflow.
- Updated Windows x64 package build: `npx electron-forge make` with `LOCAL_AGENT_OUT_DIR=out-acceptance` completed successfully. It produced the packaged app, Squirrel distributable, and ZIP without touching the older running app in `out/`. The first attempt using default `out/` correctly failed with `EBUSY` because that older instance held the resources directory open.
- The installed endpoint check to `127.0.0.1:11434/api/ps` timed out; the current Ollama process/API state could not be verified from this session. No inference was started by the new package.

## 2026-10-31 runtime payload correction

- Read-only review of the fresh packaged-app run confirmed the exact mradermacher tag loaded at `context_length: 262144`. Ollama's server log showed `keep_alive` being sent as an invalid generation option because the worker copied it into both the top-level request setting and `options`.
- Removed the duplicate `keep_alive` from generation options while preserving the session's selected warm-model duration in its supported top-level field.
- Added a regression test. It failed before the fix because `keep_alive` was present in `runtime_options`, then passed after the fix.
- Verification: `npm run typecheck` passed; `npm test` passed (12 Vitest, 21 Pytest). Starlette reports one existing `python_multipart` pending-deprecation warning.
- Rebuilt the Windows x64 package, Squirrel installer, and ZIP into the isolated `out-acceptance-2026-10-31/` directory; `npx electron-forge make` completed with exit code 0. The packaged `agent-worker.exe` passed a protocol smoke check (`ready`, `ping`, `shutdown`, exit 0) using a temporary `LOCALAPPDATA` under `work/`; it did not call Ollama or load a model.
- This warning did not establish the cause of the earlier live turn ending as `RUN FAILED`. The model completed the HTTP request in 34.75 seconds after producing streamed text, while the saved session did not retain an assistant message. A fresh visible run with durable error details is still required. The 262,144 context and model reasoning default have not been changed.
- Corrected the model selectors after the run exposed two installed Ornith tags with the same short display name. Duplicate labels now add their source namespace while preserving the exact model ID as the option value. The duplicate-name regression test passed, followed by the full 13 Vitest / 21 Pytest suite and typecheck; the Windows x64 app, Squirrel installer, and ZIP were rebuilt successfully to the isolated output directory.
- Latest read-only resource snapshot while the test-started model remained warm: Ollama reports the exact tag at 262,144 context, 15.6 GiB loaded size, and 2.06 GiB VRAM; Windows reports 1.6 GiB free of 31.9 GiB RAM. These are point readings, not peak measurements. No follow-up inference was run under that memory pressure.
- The shared Python engine suite was rerun after these app-side changes: 82 passed, with the same Starlette `python_multipart` pending-deprecation warning. No engine source files were changed in this checkpoint.
