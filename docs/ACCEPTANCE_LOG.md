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
- Added durable failed-run diagnostics after the earlier transient error notice prevented root-cause identification. Provider/engine failure details now save as `last_error` in the session and appear in the activity trace both immediately and after resume. The regression test failed before implementation, then passed. App verification: typecheck, 13 Vitest and 22 Pytest passed; shared engine: 82 passed. The error cause itself is still unconfirmed until the rebuilt app reproduces or clears it.
- Reproduced the failure through the newly packaged sidecar against the exact installed mradermacher model at 262,144 context, 4,096 output tokens, and default reasoning. The warm model emitted `Hello!` plus 47 characters of thinking; first token arrived at 0.58 seconds. Session diagnostics captured `UnicodeEncodeError: 'charmap' codec can't encode character '\U0001f44b'` while the sidecar serialized the emoji in a JSON event to Windows stdout, before the assistant turn and usage could be persisted. This confirms a Windows protocol encoding bug, not a model/context timeout.
- Changed JSONL event and response serialization to ASCII-escape Unicode (JSON decodes the escapes back to the original text) and added a cp1252 regression test. It failed before the fix and passed after. Typecheck plus full app suite passed: 13 Vitest and 23 Pytest; existing shared engine suite remains 82 passed. The fix is awaiting a rebuilt packaged-sidecar live reproduction and a visible UI acceptance run.

## 2026-10-31 visible packaged acceptance continuation

- The latest isolated package selected the approved exact tag `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`, preserved model-default reasoning, and displayed requested/effective context as 262,144 / 262,144 with 4,096 output tokens.
- A visible hello completed without reading or changing fixture files. The calculator task then created `calculator.py` and `test_calculator.py` in the captured disposable workspace after per-action file approvals. Read-only inspection confirmed four calculator operations and five unittest cases with valid Python indentation.
- The model ended its response by asking in plain text whether it may run `python -m unittest -v`. It made no command-tool request, so no command-approval dialog was emitted and no test command has run in this continuation. This is the expected distinction between conversational consent and the app's actual action approval gate; the run is awaiting a user reply in chat before the model can request the command.
- During the coding run, the work sheet showed 2.6 s first-token delay, 2.2 output tokens/s, and 474 output tokens. A visible resource snapshot showed 20% GPU load, 3,493 / 4,096 MiB VRAM, 12.44 W board power, 12% CPU, and 29.2 / 32 GB system RAM. These are UI snapshots, not continuous samples or proof of full GPU layer offload.
- The 1920 x 1080 screenshot showed activity-trace descriptions extending into the resource/system panel. Source fix `8f08a74` gives the activity trace its own bounded scroll area and pins the resource panel below it. App verification passed: 16 Vitest, 19 Pytest, and TypeScript typecheck. This CSS fix has not yet been packaged or visually rechecked because the existing workbench window was minimized; it was not restored to avoid interrupting PC use.
- Rebuilt the packaged app, Squirrel installer, and ZIP in `out-acceptance-2026-10-31-trace-fix/`; Forge completed successfully. Inspected the packaged renderer stylesheet inside `app.asar` and confirmed the trace scroll containment and fixed resource-panel rules are present. The live visual check remains open; packaged CSS inspection does not replace seeing it in the running window.
- Remaining visible acceptance: rebuild and inspect the worksheet layout; continue through the actual command-tool approval and test output; exercise cancellation, save/resume, and project isolation; and run the previously approved 65,536-context / 8,192-output comparison while collecting active resource samples. No model settings or OpenCode configuration were changed here.

## 2026-10-31 packaged live workflow follow-up

- The rebuilt packaged worker started cleanly, resumed session `20261031-034026-52cc9a10` from its correct isolated data directory, and kept the selected project fixed to `work/acceptance-2026-10-31-empty`. A first test wrapper mistakenly used a different empty data directory for a prior session; that wrapper was stopped, Ollama was left running, and the retry used the original saved-session directory.
- With the exact model `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`, requested context 262,144, output cap 4,096, and reasoning unset, the package streamed a response and used the selected context unchanged (`num_ctx: 262144`, `num_predict: 4096`). One inference reported 875 generated tokens in 392.43 seconds (about 2.23 tokens/second); another reported 61 tokens in 27.33 seconds (about 2.23 tokens/second). The test-wrapper RAM sampler observed peak system RAM used of 22.53 GiB; it did not capture peak VRAM.
- Per-action approval allowed writes only to `calculator.py` and `test_calculator.py` in the disposable fixture. The generated module handles add, subtract, multiply, divide, and raises `ZeroDivisionError`; its five unittest cases cover those operations and division by zero.
- The packaged app's approved `python -m unittest -v` command timed out twice at the engine's 120-second command limit. Other command variants suggested by the model were denied because they differed from the explicitly scoped test command. The same two files and exact command, run directly from the fixture outside the app, completed in 1.7 seconds with all five tests passing. Therefore the test code passes, but the packaged sidecar command boundary is unverified and currently fails this acceptance gate.
- A second hand-written test driver had an accidental 1,200-second observation cap; it sent a request cancellation when that cap elapsed. This was an agent test-wrapper limit, not an application model deadline. Treat that run as cancelled and do not reuse the capped wrapper.
- Ollama currently reports the exact tag at context 262,144, with `size_vram: 2,208,405,913` bytes and `ollama ps` at 87% CPU / 13% GPU. `nvidia-smi` point samples were 9% GPU / 3,656 of 4,096 MiB / 7.20 W, then 6% / 3,699 MiB / 7.44 W, then 7% / 3,616 MiB / 7.64 W. The user observed a sustained 2–5 minute CPU-only interval. Those utilization snapshots were not proof of model-layer GPU compute.
- Root cause was found in Ollama's historical runner logs. At the current 262,144 context, the Q4 GGUF is 5.23 GiB on disk; Ollama projected 13,414 MiB of GPU memory for 4,812 MiB model + 8,242 MiB context + 360 MiB compute versus 3,282 MiB free. It selected zero GPU layers, logged `offloaded 0/33 layers to GPU`, and allocated an 8,192 MiB CPU KV cache. In the earlier ~64K load, it logged 6/34 layers on GPU, a 1,335 MiB CUDA model buffer, and 2,008 MiB total KV (1,757 MiB CPU + 251 MiB GPU). This confirms the full-context selection explains the loss of text-layer offload. The Ollama `/api/ps` `size` of roughly 16.8 GB is the total loaded runtime footprint, not the GGUF file size. No model/context/reasoning setting was changed during this investigation.
- No model, reasoning setting, context maximum, model file, OpenCode configuration, or existing user-project files were changed. The test-created Ollama model was left loaded. The packaged UI has not yet been opened for this latest build; visible acceptance, including the full chat workflow and token-control interaction, remains pending.
- New requested follow-up work for visible 65,536-context / 8,192-output verification, lifetime/session/model analytics, live telemetry, speed-ranking evidence, and continuous GPU correlation is queued in `PRODUCT_BACKLOG.md`.

## 2026-10-31 command-boundary diagnosis

- Replayed the exact approved `python -m unittest -v` command against the existing disposable fixture through `AgentService` and the shared engine's real `ToolRegistry`; all five tests passed and the worker emitted tool-start, tool-done, session-saved, and run-idle events in 0.25 seconds.
- Rebuilt that diagnostic with the same PyInstaller one-file approach and absolute engine/sidecar import paths. The frozen diagnostic worker also passed the same command and emitted the same complete event sequence in 0.25 seconds. An initial diagnostic build with incorrect relative import paths failed before running the test; it was replaced by the correctly built probe and is not evidence of a product failure.
- Therefore the previous two 120-second failures are not reproduced in either the source engine or a correctly frozen worker. The remaining failure is specific to the actual Electron acceptance run or its captured run configuration/event flow; the app must still be opened and the workflow rerun visibly before that gate can pass. The generated disposable fixture and existing model load remain untouched.
- While the currently loaded model was idle, an 8-sample, 2-second process/GPU observation measured the Ollama runner at effectively zero CPU and the GPU at 1–2%. This is an idle observation only. The user's sustained CPU-only generation report remains supported by the historical runner log showing 0/33 transformer layers offloaded at context 262,144; no model setting was changed.
- Launched the latest packaged build once with an isolated disposable user-data directory for visible acceptance. Its home screen was visible and reported 20 installed models, active context 262,144, reasoning at model default, and Ollama reachable. A window from the older package was also open. The user clarified they closed the duplicate app windows; this was user-directed duplicate cleanup, not evidence of a crash. No project was selected in that brief run. Continue with one latest-package instance only after the desktop is idle; the visible project/chat workflow remains pending.
- Added structured GPU utilization, VRAM used/total, and board-power readings to Python telemetry and the footer/Live Work Sheet. Engine tests passed (84); app tests passed (15 Vitest + 19 sidecar); TypeScript typecheck passed. A live read-only `system_snapshot` from the rebuilt frozen worker returned the exact loaded Ornith tag at context 262,144 and GPU fields; two idle samples were 2% utilization, 3,533/4,096 MiB, and 6.58 W. This confirms the packaged telemetry path, not active inference speed or GPU offload.
- Rebuilt the Windows x64 app, Squirrel installer, and ZIP into isolated `out-acceptance-2026-10-31-telemetry/`. The packaged worker `ping`, `system_snapshot`, and `shutdown` protocol requests completed successfully; this smoke check did not send inference or alter the loaded model. The new metrics still need visible verification in the app.

## 2026-10-31 visible acceptance: first-run model selection correction

- The one visible packaged instance opened the disposable `visible-acceptance-2026-10-31` project at its exact path and showed a 262,144 context, 4,096 output, and reasoning at model default. The greeting was cancelled through the visible button; the app correctly left Ollama running.
- That run exposed a serious selection defect: catalog order chose `hf.co/ressl/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`, while the accepted model is the exact `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`. The wrong source is now active in Ollama at 262,144 context. Read-only `/api/ps` showed about 16.8 GB runtime allocation and Windows had 2.5 GB free RAM at the last sample. No further model request was made.
- Added `chooseDefaultModel()` to prefer the exact accepted mradermacher tag when installed, retain a valid current selection, and fall back to the first available model only if that exact model is absent. Regression tests cover catalog-order independence and fallback behavior.
- Verification: 16 Vitest tests passed, 19 sidecar tests passed (one existing Starlette multipart deprecation warning), and TypeScript typecheck passed. A new isolated Windows package/installer/ZIP build is underway. The fresh-profile UI and remaining coding/session acceptance still need verification with the correct exact model.
