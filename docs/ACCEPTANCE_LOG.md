# Visible Acceptance Log

## 2026-11-01 full harness audit: source stabilization pass

- Paired engine commit `f3809e82ed6266e25ac50722535d1d9bb3030ffe`; app `core-revision.txt` pins that exact commit.
- Verification passed locally: engine pytest **251 passed**; app `npm test` **86 renderer + 92 sidecar passed**; TypeScript typecheck passed; `git diff --check` passed.
- The first regression pass exposed 17 sidecar failures. Root fixes were applied for session creation/mirroring, journal replay and duplicate partial text, new-task plan seeding, structured plan/checkpoint recovery, conflict fail-closed behavior, interrupted operation classification, complete tool catalog discovery, live tool-preparation activity, and compaction telemetry context fallback. Stale transport and evidence fixtures were corrected to match their actual documented contracts.
- The engine suite initially failed 45 tests; the fixed schema-keyword traversal was the shared cause of many rejected actions. Focused regressions verified direct plan → file write → inspect completion, tool schema selection under the currently selected request budget, and request-only cancellation. The full engine suite then passed.
- The suite run preserved the exact configured settings in its fixtures, including 65,536 and 262,144 context values. It did not issue model inference, preload/unload a model, or change any user's runtime settings.
- Remaining evidence tiers: Windows package build and bundled-worker smoke; visible app acceptance in a disposable workspace; process/runtime resource attribution; long-run compaction and chat-resume acceptance; updater install/recovery; hosted CI. This entry does not claim product or release readiness.

## 2026-11-01 beta.3 release candidate

- Candidate version: `0.1.0-beta.3`; `package.json` and `package-lock.json` match. The paired app source pins engine `e5158359cca2e780ca506cfd98e8b8015c63852a`.
- Verification passed locally: 140 shared-engine pytest; 53 renderer/Vitest; 45 sidecar pytest; TypeScript typecheck; production dependency audit (0 findings); Windows x64 `npm run make`; bundled worker ready/ping/shutdown (exit 0, isolated temporary app data, no Ollama request); Squirrel `.nupkg` and portable ZIP integrity checks.
- The marker-order test initially had stale expected ordering; its assertion was corrected to match deterministic ID sorting and then the full app/sidecar suite passed. An initial app suite attempt without `LOCAL_AGENT_CORE_PATH` could not collect engine-backed tests; the release-workflow environment was then applied and all tests passed.
- **Visible app acceptance is not complete:** inspection found the existing beta.2 Workbench window actively generating a long task. To preserve that work and avoid duplicate app instances, the beta.3 candidate was not launched. No model request was started, canceled, loaded, or unloaded for this candidate.
- GitHub Actions historically failed before runner startup due to the account-level billing lock. This release is based on local verification; hosted CI must be rechecked after source promotion and is not represented as passed.
- Installer is unsigned. Current packaged Home/chat screenshots and the installed beta.2-to-beta.3 updater cycle are not verified yet. The user requested a quick public release while development continues; keep these limitations visible and schedule the update canary when the current app task is idle.

## 2026-11-01 beta.3 public release

- Promoted engine commit `742ddb55a0fcdd7d0d205b29c04228cef5b9c0ff` to engine `main`, then promoted app commit `7a698c3d8b704ad38003c9b9d4959209afa79fd4` to app `main`; the app's pinned engine revision is `e5158359cca2e780ca506cfd98e8b8015c63852a`.
- Published public app tag/release [`v0.1.0-beta.3`](https://github.com/MrNova420/local-agent-workbench/releases/tag/v0.1.0-beta.3) as Latest. It is non-draft and GitHub's prerelease flag is off to keep it discoverable by the configured Electron update service. The engine repository does not have a separate app release/tag.
- Uploaded Setup.exe, portable ZIP, full `.nupkg`, `RELEASES`, and `SHA256SUMS.txt`. GitHub's asset digests match the built binaries, and the downloaded checksum manifest matches the local manifest.
- Read-only request to the beta.2 Electron update feed returned HTTP 200 and the beta.3 Setup URL. This confirms feed discovery only; it does not confirm a running installed app has downloaded, restarted, or recovered data.
- Both GitHub Actions workflows failed before any steps started (runner allocation failure). Local verification in the candidate entry above is the available evidence; hosted CI is not passing.
- The previous packaged app window had a live generation. It was left untouched; no beta.3 UI launch, new inference, cancellation, model load/unload, or duplicate app instance was performed. Visible beta.3 acceptance and installed update/recovery remain pending.

## 2026-10-31 roadmap and release-policy reconciliation

- Added `docs/MASTER_ROADMAP.md` as the cross-repository source for current branch state, ordered source/package/visible/live-model/release gates, remaining core work, deferred backlog, evidence tiers, and documentation ownership.
- Clarified release policy: documentation and planning commits do not bump the app version, create a tag, or publish. A new SemVer tag is selected only after an installable app build passes its release gates. No version, tag, release, source behavior, model setting, or user data changed in this checkpoint.
- Corrected stale backlog/readiness notes to state that engine `e5158359cca2e780ca506cfd98e8b8015c63852a` is pinned in the active app worktree but remains unverified, un-packaged, and unpublished.
- Verification was intentionally not run or claimed. Existing automated checks for the latest source batch, hosted CI, current package, full visible workflow, fresh controlled model measurement, and installed-app update remain separate gates.

## Current live acceptance — 2026-10-31

- A fresh beta user-data window started the disposable-project task with the full 262,144 context and 4,096 output cap. The reopened app had fallen back to its fresh-window settings and the untouched-context path selected the model's advertised maximum. This failed to preserve the already verified 65,536 / 8,192 choice; no user instruction authorized changing those values.
- The current live coding turn is still in progress and has not been canceled. At the latest visible sample it had run 1,193 seconds, reported about 319 output tokens, showed the same partial assistant text, and had created no files. The selected reasoning remains model default. Runtime telemetry showed CPU 87%, RAM 29.2 / 32 GB, GPU 37%, and VRAM 3,633 / 4,096 MiB. Do not treat this run as a successful coding-task acceptance until it naturally completes and its files/results are inspected.
- A later visible sample at 1,423 seconds still showed about 319 output tokens and no files, with displayed throughput near 0.2 tokens/second. CPU was 75%, RAM 29.2 / 32 GB, GPU 37%, and VRAM 3,633 / 4,096 MiB. The persisted run checkpoint still says `running`, with the same 262,144 / 4,096 settings and no partial answer text; continue preserving the run and treat its acceptance as pending.
- At 1,663 seconds, the packaged app still showed the same 319-token estimate, no files, and about 0.2 tokens/second; it remained in `GENERATING`. The newest point sample was CPU 70%, RAM 29.3 / 32 GB, GPU 37%, and VRAM 3,633 / 4,096 MiB. No cancellation or second app/model request was issued.
- At 1,913 seconds, the same request was still generating with no visible output growth or created files. The UI still showed about 319 tokens and 0.2 tokens/second; the resource sample was CPU 78%, RAM 29.5 / 32 GB, GPU 36%, and VRAM 3,633 / 4,096 MiB. This is a failed speed/throughput acceptance for the 262,144 / 4,096 run, not a completed-task result.
- At 2,046 seconds the model requested approval to write `index.html` to the exact disposable project. The reviewed write was approved under the previously authorized visible acceptance workflow; the file now exists at 10,947 bytes. The UI recorded 3,712 output tokens for the completed generation and advanced to another model call, so the website task is still active. The request remains at 262,144 / 4,096 with reasoning default. Resource sample: CPU 14%, RAM 29.7 / 32 GB, GPU 31%, VRAM 3,713 / 4,096 MiB.
- Fixed the source default and session creation path to preserve 65,536 / 8,192 for fresh sessions, and added local saved-token preferences. Added Ollama model preloading on explicit selection plus a PRELOAD button, using the selected context and keep-alive without a prompt, output cap, or reasoning override. It declines to replace a different loaded model or resize a loaded model with a different context. It does not preload on app launch.
- New-session creation now reads app-wide saved token preferences rather than inheriting different token settings from whichever older session was last resumed. TypeScript typecheck and the 8 model-control tests passed after this follow-up.
- Focused source checks: TypeScript typecheck passed; model-control tests 8 passed; worker and adapter tests 32 passed; core runtime tests 5 passed. The immediate-unload guard passes its focused worker test. Full suite and a new packaged visual check are deferred until the active inference ends because the live task is using nearly all system RAM. Packaged behavior remains unverified.
- At 2,636 seconds, the incorrect 262,144 / 4,096 run was explicitly cancelled through the app's decision dialog; its received transcript and the completed approved `index.html` write were preserved. The same session was then set to 65,536 / 8,192 and restarted with a continuation prompt. The session JSON now stores context 65,536 and max_tokens 8,192; `ollama ps` independently showed the exact mradermacher model running with context 65,536. Reasoning remains model default. First token arrived after 96.4 seconds; at 127 seconds the UI showed 67 generated tokens and about 2.3 tokens/second. This corrected-context run remains active; the sample is preliminary, not a completed-task benchmark. Resource sample: CPU 70%, RAM 22.5 / 32 GB, GPU 23%, VRAM 3,040 / 4,096 MiB, power 23.02 W.
- The active 65,536 / 8,192 run resumed at 200 seconds with about 137 output tokens and 1.6 tokens/second. The assistant confirmed `index.html`, identified the missing `styles.css` and `script.js`, and began the continuation plan. Resource sample: CPU 72%, RAM 22.6 / 32 GB, GPU 23%, VRAM 3,027 / 4,096 MiB, power 20.33 W. No write for the continuation had completed at that sample.
- Source now refreshes the selected workspace's file index after terminal write/edit/patch, command, and MCP operations, so Files in View and change review can reflect tool results immediately. A regression test has been added but is intentionally queued with the final test pass per the user's latest instruction. Preload notifications now name the model from the actual event, and attempting to submit while a model is warming gives an explicit wait notice instead of silently doing nothing.
- The Home model picker now shares the top-bar lockout while a selected Ollama model is warming, with an explicit warming label; this prevents a second Home selection from racing the in-flight preload. This source change is committed before package verification; its UI test is queued for the final test pass.
- Preload completion now carries elapsed wall time and Ollama's response `load_duration` into its ready notification. A focused assertion was added to the final test queue; no new tests were run during the requested development-first phase.
- The live old package visually concatenates assistant text across model/tool/model segments. Source now inserts a paragraph break when a streamed assistant answer resumes after a tool batch, while preserving ordinary chunk boundaries. A focused transcript test is queued; no test run or package restart was made while inference remained active.

## Source/package checks — 2026-10-31

- Engine suite after explicit build-task continuation and small-model workflow: 114 passed, one upstream Starlette `python_multipart` deprecation warning.
- Electron renderer: 42 Vitest passed; sidecar adapter: 35 pytest passed with the same upstream warning; TypeScript typecheck passed.
- Built isolated package `out-core-acceptance-2026-10-31-small-model-cache` from the current app and engine source. The bundled worker answered JSONL `ping` with `ready` / version `0.1.0`.
- The existing older app instance was left open, so this package was not launched for visual acceptance. The new Home button, profile persistence, plan-to-tool continuation, and cache display still need a visible test in one app instance.
- Copied both full Git repositories to `%USERPROFILE%\Desktop\Local Agent Workbench\` as sibling `electron-agent-workbench` and `local-9b-dev-app` clones. Their pre-optimization checkpoints (`1b1b03b`, `7b21211`) were recreated as local branches; source worktrees were retained. The Desktop clone passed 42 renderer tests, 35 sidecar tests, 114 engine tests, and typecheck.
- Built `%USERPROFILE%\Desktop\Local Agent Workbench\electron-agent-workbench\out\Local Agent Workbench-win32-x64` from the Desktop clones using sibling-engine discovery (no `LOCAL_AGENT_CORE_PATH` override); its bundled worker answered the JSONL `ping` successfully. No new app window was opened.

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

## 2026-10-31 visible workflow and project-review boundary follow-up

- In the one running `out-acceptance-2026-10-31-trace-fix` app instance, the selected project was exactly `work/visible-acceptance-2026-10-31`; the selected model was `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`, context was 262,144 / 262,144, output cap was 4,096, and reasoning remained at model default. Read-only Ollama `/api/ps` confirmed the same model/context remained loaded; this work did not unload it.
- The visible coding workflow reached a real action-approval dialog for exactly `python -m unittest -v` in the disposable project. Clicking the backdrop and pressing Escape left the decision dialog open. After approval, the packaged app displayed all five tests passing (exit 0). This resolves the earlier uncertainty about whether the model's plain chat permission sentence proceeded into the app's approval flow.
- The activity trace and resource panel were visually separate in the rebuilt package at 1920x1080. No overlap was visible. Resource numbers observed during the run are point samples, not a continuous capture or peak benchmark.
- The first numbered-list cancellation attempt ended before the requested forced stop and is not accepted as cancellation evidence. On retry the user observed 13 list items after roughly 120 seconds and reported generation was still continuing. The retry was not cancelled by this check; its eventual outcome is unknown because the app was later minimized. Treat the earlier cancellation claim as inconclusive.
- The user reported that `Inspect changes` did not work. Inspection found the selected fixture is nested under the workbench Git repository, where Git walked up to the parent repo and `.gitignore` excludes `work/`. Therefore the old handler could not show the selected fixture's files. Commit `f35ee11` now scopes Git diff to a repository rooted exactly at the selected project; for a non-Git project it shows a bounded snapshot of files inside that project, and for a Git project it includes untracked files. The fix includes regression cases for nested project isolation and untracked paths with spaces.
- Follow-up commit `ecc0ea9` makes the review modal open before the backend request and show a visible loading or error state, so a failed/slow request no longer looks like an inert button. This complements the data-scope correction; neither review change has been packaged or visually verified yet.
- Built the new app, Squirrel installer, ZIP, and bundled worker into the isolated `out-acceptance-2026-10-31-review-fix/` output; Forge completed with exit 0. The packaged worker protocol smoke test returned `ready`, reviewed the exact nested fixture files without exposing parent-repository changes, shut down cleanly, and exited 0. This did not call Ollama or load/unload a model.
- The prior packaged instance remains the only app window. A visible check of the new package was deferred because desktop automation detected fresh user input and refused to foreground the minimized window; no second app instance was launched. The active/retry generation outcome is still unknown and was not cancelled by this check.
- Verification after the fix: focused project-diff tests passed (2); full `npm test` passed (16 Vitest, 21 Pytest; one existing Starlette multipart pending-deprecation warning); `npm run typecheck` passed. The packaged app has not yet been rebuilt with `f35ee11`; visible confirmation of the fixed Inspect changes behavior remains open.
- At this checkpoint, visible rebuild/package review, project switching/session isolation, and selected context/output runtime acceptance were still pending. Those gates were completed in the following entry; the long-running generation/cancellation outcome and a matched full-context comparison remain open. Keep the model and OpenCode settings unchanged.

## 2026-10-31 rebuilt-package review and selected-token runtime acceptance

- Rebuilt package `out-acceptance-2026-10-31-review-fix` was opened visibly as the only workbench instance. Its `Inspect changes` dialog showed the selected fixture's two files and contents. Switching to the separate empty fixture showed only its own session; switching back restored the original path and only its two saved sessions. No fixture files were changed by review or switching.
- Created session `20261031-053119-20d95dd8` at the exact `work/visible-acceptance-2026-10-31` path. The run configuration selected `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`, context 65,536, output cap 8,192, model-default reasoning, and per-action approval. No OpenCode or model configuration was edited.
- The exact session JSON persisted `context: 65536`, `max_tokens: 8192`, `reasoning: null`, the selected model and workspace, and both submitted prompts. The Ollama `/api/ps` response independently reported the same exact model at `context_length: 65536`; `server.log` recorded its newly started runner with `-c 65536`, `n_ctx = 65536`, and `n_ctx_slot = 65536`. This establishes the effective runtime context rather than relying on the UI label.
- The UI's `REQUEST SENT` fields showed `65,536 / 8,192` and `DEFAULT`. The adapter in `local-9b-dev-app/desktop_engine.py` serializes `state["context"]` as `options.num_ctx` and `state["max_tokens"]` as `options.num_predict`; the mocked adapter test now asserts the `num_predict` mapping. The current Ollama log has request-body logging disabled, so the exact live HTTP body value for `num_predict` cannot be independently recovered from server logs after the completed request. The persisted session setting, the adapter payload mapping/test, successful `/api/chat` responses, and effective runner context together verify the selected configuration end to end without claiming a captured wire body.
- The fixed prompt returned `READY`; the user then sent `hello`, which also completed (`Hello! I'm ready to help you with your software development work. What would you like to do?`). Final visible hello metrics were first token 1.9 s, 2.4 tokens/s, 52 output tokens. A live-generation point sample showed 75% CPU, 34% GPU load, 3,068 / 4,096 MiB VRAM, 17.17 W, and 22.6 / 32 GB system RAM; completion snapshot showed 6% CPU, 20% GPU, 3,034 / 4,096 MiB VRAM, 12.66 W, and 22.5 / 32 GB RAM. These are point samples, not peak or continuous measurements. Ollama remained running with this exact model loaded at 65,536 context; it was not stopped or unloaded.
- `tests/test_engine_adapter.py` now checks that the provider serializes the configured output cap to Ollama's `num_predict`; its five focused adapter tests pass. A fresh same-prompt comparison at the 262,144 context baseline remains before describing speed differences across context settings. The 262,144 advertised context maximum remains unchanged; no context value was silently lowered.

## 2026-10-31 resumed transcript rendering check

- Reopened the packaged app and resumed completed session `bbfac5c7`. Its saved assistant Markdown rendered as styled bullets and inline code in the transcript; no JSON conversion appeared in that resumed answer.
- In the 65,536-context / 8,192-output session `20d95dd8`, a visible response requested as a Markdown heading and numbered list completed in 124 seconds. The live UI rendered a heading, ordered list, and bold item labels. Final Ollama usage was 2.5 seconds to first token, 2.4 tokens/second, and 284 output tokens.
- The session file saved the assistant `content` as a Markdown string containing the heading and all eight list items, not as a JSON-encoded string. The renderer's resume path passes saved `content` through the same ReactMarkdown component used for live output.
- The exact reported “rich list becomes simple JSON” regression was not reproduced. A close/relaunch check of this newly generated response remains incomplete: desktop automation returned `foreground window did not report a process id` for the close action, so the single packaged app instance was left open. The prior post-restart resume check above is the available visual evidence; do not report the new response as restart-verified.
- The plan and activity-trace panels are renderer state and are initialized empty when resuming a session. Persisting those structured panels is a separate gap to inspect against the user's example; it is not evidence that assistant Markdown is converted to JSON.

## 2026-10-31 adaptive model markers and transcript rehydration

- The installed-model orbit code previously emitted marker spans without any marker CSS, while the old three decorative ring dots remained visible regardless of model count. Added explicit marker styles, removed the always-on dots, and extracted the positioning logic for tests. It now emits zero markers for zero models, one per model for 3 or 27, distributes 27 evenly across three rings, and highlights the selected model.
- The reported recent syntax-highlighting commit added a second copy of a Highlight.js theme import already present in its parent, so it had not changed the renderer. Removed the duplicate and extracted the transcript Markdown renderer and session-row restoration into testable functions. A saved Markdown response restores with its headings and list intact and produces Highlight.js token spans for fenced JavaScript.
- Automated verification: `npm test` passed (20 Vitest, 21 Pytest; one existing Starlette `python_multipart` pending-deprecation warning); `npm run typecheck` passed. Windows x64 package `out-acceptance-2026-10-31-transcript-orbits-final` built successfully, including the sidecar. Inspection of the packaged archive confirmed dynamic orbit CSS, removal of default decorative dots, the Highlight.js theme, a single stylesheet bundle, renderer code, and bundled worker.
- Read-only inspection of disposable acceptance sessions found assistant content saved as Markdown strings; neither inspected session contained JSON-shaped assistant messages. This does not reproduce the user's exact visual regression.
- Visible acceptance is still pending: the existing workbench is minimized while the user is active in Codex. No second instance was launched, and no model was loaded, stopped, or unloaded. Once desktop use is idle, reopen the packaged app, resume the saved Markdown/code response, and verify its appearance after both session resume and app relaunch.

## 2026-10-31 final orbit and session-resume visual acceptance

- The final package `out-acceptance-2026-10-31-verified-final` was opened as the only workbench instance. The homepage showed 20 installed models as 20 colored orbit markers, with the selected mradermacher model visibly distinguished. The hero labels were at the outer edges and no longer covered model markers.
- Closed that instance gracefully, confirmed the Ollama loaded-model list was empty, and launched the final package. No model was loaded or inference requested.
- Opened the existing disposable `visible-acceptance-2026-10-31` project and resumed session `bbfac5c7` after the app relaunch. The assistant's saved list and inline-code portions rendered with their expected styling in the packaged app; the screen did not show JSON in place of the response.

## 2026-10-31 exact orbit-path follow-up

- Reworked model markers as children of the corresponding CSS ellipse elements. Their coordinates now follow the actual three ring dimensions and rotation, and their angular positions are calculated from sampled ellipse arc lengths so markers are evenly spaced by distance on oval rings. Removed reliance on the separate overlay; static decorative dots remain disabled, and zero installed models produce no model markers.
- Added renderer-level markup checks proving markers are nested inside their target rings, plus geometry checks for no models, 3 models, and 27 models. The 27-model case checks nine markers per ring and near-equal perimeter spacing. `npm test` passed (20 Vitest and 21 Pytest; one existing Starlette pending-deprecation warning); `npm run typecheck` passed.
- Built Windows x64 package `out-acceptance-2026-10-31-exact-orbits`. Inspected the packaged archive: it contains the marker CSS, disabled static decorative dots, Highlight.js theme CSS, and bundled sidecar executable.
- Visible verification passed in the relaunched `exact-orbits` package: the home page showed 20 colored markers on the three ellipse paths, including a visibly selected marker, without collision with the hero labels. The installed count and selected model matched the app's catalog/selection.
- Closed the previous package's idle window and launched `exact-orbits` as the sole Workbench instance. The same `bbfac5c7` session reopened with Markdown bullets and syntax-highlighted Python code intact; no JSON conversion appeared. The test did not submit a prompt or request inference.
- Read-only `/api/ps` checks immediately before and after the app swap confirmed `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M` remained loaded (reported size 16,798,428,690 bytes). The app swap did not unload it. The exact user-reported JSON-looking response remains unreproduced, and the plan/activity panels still reinitialize empty on session resume.
- The exact reported JSON-looking response remains unreproduced: this session stores ordinary Markdown strings. The resumed Plan and Activity Trace panels remain empty, as they are not persisted today; track that separately from transcript rendering.

## 2026-10-31 reliable session and activity implementation checkpoint

- Committed the worktree implementation as `430e8e4 feat: persist live activity and recover interrupted sessions`. It adds app/project session mirroring and conflict resolution, durable workspace history, persisted activity/plan/output, run checkpoints, interruption recovery, cancel/close decision flows, and the three activity display modes.
- Verification in the worktree: app `npm test` passed (22 Vitest and 31 Pytest; one existing Starlette `python_multipart` pending-deprecation warning); `npm run typecheck` passed; shared engine `python -m pytest -q` passed (93 tests; same warning).
- One visible test attempt used a disposable session set to 8,192 context / 512 output and failed before an Ollama request because the core context budget reserved 8,192 tokens plus tool schemas. This exposed the context-budget regression. The core fix is separately committed as `2a8039d fix: make 8k context tool aware`; it reduces the default reserve to 512, uses a conservative text/token estimate, and excludes `.agent-workbench` from retrieval. No inference request was sent during that failed attempt. The selected session values were changed for that attempt; do not change token settings again without explicit user direction.
- Follow-up test added for durable run-error activity; it failed before the implementation and passed after. Full app suite and typecheck were rerun afterward.
- Remaining: rebuild a separate Windows package, inspect installer packaging, and complete the visible disposable-project workflow. Do not modify context/output settings during that check. Preserve whatever Ollama model is already loaded; do not stop or unload it.

## 2026-10-31 full visible coding and session recovery acceptance

- In the single visible packaged app, the user-confirmed disposable coding task completed in the exact `visible-acceptance-2026-10-31` workspace. It added `power(base, exponent)` and tests for positive, zero, and negative exponents. The model inspected and planned first; the app showed per-action approvals bound to that project before writes and command execution. All eight unittest cases passed, and the output was visible in the chat/activity stream.
- The active session retained context 65,536, output cap 8,192, and reasoning unset/model default throughout. Session JSON preserved those values, full chat, 13 activity records, completed run state, and the exact workspace. The project mirror and app-wide session file were both present and synchronized. No settings were modified for the acceptance run.
- This coding run took about 15 minutes. First token arrived at 36.3 seconds; generation samples were approximately 1.6–2.2 tokens/second. The UI showed live CPU/GPU load, VRAM, system RAM, and power readings during inference. These are observed run samples, not a benchmark or peak-memory measurement.
- Relaunching the app and reopening the saved session restored formatted Markdown (heading, list, and inline code), the complete tool activity history, and the same run settings. The actual user-facing transcript did not turn into JSON.
- Review of the saved activity record did reveal a false-success defect: invalid patch output and tool exceptions were persisted as `completed`. Engine regression tests reproduced both failures. Commit `ddafdd2 fix: report tool failures in activity trace` now maps invalid patches and exceptions to `failed`, command nonzero exits/timeouts to `failed`, and denied/blocked/cancelled actions to their respective states. It deliberately leaves arbitrary `read_file` contents alone, even if the file begins with error-like text. Engine verification: 96 tests passed. Repackage and reopen the updated app after closing the current instance; verify the status styling in that build.
- Packaged the status fix with the committed engine worktree as `out-acceptance-reliable-sessions-status-fix/`; Forge produced the app, Squirrel distributable, and ZIP. Before launch, closed the previous package's window gracefully and verified its Electron/sidecar process tree had exited. Then launched the new package once; desktop inventory shows one Workbench window from that package. Model/token settings were not changed, and no inference was started after reopening.
- Relaunched the app and resumed session `20d95dd8`; Markdown formatting, workspace identity, 65,536/8,192 settings, and all 13 activity rows restored. The prior session's two invalid patch records still show their originally persisted `COMPLETED` states because they predate the fix; new tool outcomes now use the corrected status mapping. This historical-record correction is a separate migration decision, not silently rewritten.
- Remaining visible gates: observe a newly generated failed/denied activity state in the packaged UI, exercise the running-task continue/cancel/finish choices and close/hide reattachment, and verify workspace switching cannot affect a captured run. The engine and renderer tests cover the relevant state mapping and choices, but these remaining app interactions have not been visually accepted. Do not start a duplicate package, alter model token settings, or unload the model during these checks.

## 2026-10-31 restored run outcome and regression check

- Investigated why the saved command result could look unfinished after reopening. The session contained `run_state.status: completed`, the assistant's final answer, and the complete `run_command` result ending in exit 0; the renderer restored transcript and events but initialized its status chip to `Ready` without reading the saved outcome.
- Added explicit restored-status mapping for completed, failed, cancelled, stopped-after-operation, and interrupted runs. Added table-driven renderer tests; the new tests failed before the mapping existed and passed after it was implemented.
- Verification: focused run-state tests passed (9); renderer suite passed (30); sidecar suite passed (35); TypeScript typecheck passed. The first unconfigured `npm test` invocation failed collection because `LOCAL_AGENT_CORE_PATH` was unset in this checkout; rerunning with the engine worktree path set passed all tests. One existing Starlette `python_multipart` pending-deprecation warning remains.
- The first package build `out-acceptance-restored-run-status/` passed packaging and bundled-worker ping/shutdown smoke checks. Its visible session resume showed `TURN COMPLETE` but the phase rail remained on `Ready`, prompting the follow-up correction. The final package `out-acceptance-restored-run-status-final/` was built and opened once after verifying the prior window's process tree exited. It visibly resumed session `20d95dd8`: the status chip reads `TURN COMPLETE`, every phase-rail step shows complete, the final assistant answer remains formatted, the 13 activity events and successful command row remain present, and context/output remain 65,536/8,192 with reasoning at model default. The live model was not requested, loaded, or unloaded by this UI verification. Full app verification passed (37 Vitest, 35 Pytest; one existing Starlette deprecation warning) and TypeScript typecheck passed. The final package was created with `npm run package`; installer/ZIP generation is not part of this UI-only check.
- Post-commit regression: shared engine suite passed (96 tests; one existing Starlette deprecation warning); the final package's bundled worker passed `ping` and `shutdown` over its JSON-lines protocol. The final single app window remains open on the restored disposable session. Commit: `979bc98 fix: restore completed run status in sessions`.

## 2026-10-31 Desktop clone continuation: composer workflow toggle

- Added a one-click Standard / Small-model workflow toggle beside the chat composer. It changes only the guidance profile; it does not modify model selection, reasoning, context, output-token cap, temperature, access, or approval policy. The app-wide profile remains stored locally, and the selected session profile is saved to both session copies.
- Added a renderer profile transition test and a sidecar dual-save/resume test. Verification: all app tests passed (43 Vitest, 36 sidecar); TypeScript typecheck passed; sibling engine suite passed (118). Each suite has one existing Starlette `python_multipart` deprecation warning.
- This change has source-level verification only. It has not yet been packaged or visibly exercised. No model request or inference setting change was made for these checks.

- Rebuilt the Desktop clone after commit `4430808`: `npm run make` produced a Windows Squirrel installer, full nupkg, RELEASES manifest, and ZIP. Source and engine suite checks were completed before packaging; package protocol ping, installer launch, and visible app acceptance are deliberately queued for the final verification pass. No Workbench UI window was opened and no model/runtime request was issued.

## 2026-10-31 KV telemetry, tool inventory, and capability-boundary continuation

- Committed provider-accurate KV/prompt telemetry in the Electron app (`53a52ea`) and llama.cpp slot-token metrics in the engine (`5e33918`). It distinguishes reusable prompt token counts and slot context tokens from actual KV allocation bytes, which remain unavailable through the current interfaces.
- Added a documented parity research cross-check against official OpenAI/Codex, OpenCode, MCP SDK, and Microsoft AppContainer guidance (`495e4ed`). It records that the complete feature target remains open and approval dialogs are not OS sandboxing.
- Added an in-app tools/integrations directory and a tool catalog protocol command (`0067c03`). It reports the existing built-ins and configured local MCP servers, and marks first-party browser, LSP, and debugger adapters as planned.
- Added project-root-only `git_status` and `git_log` tools and fixed the agent Git inspection path so a child workspace cannot disclose a parent repository's diff (`b8cc63f`).
- Added explicit warnings that approved or auto-approved commands/MCP run with Windows account permissions and may access beyond the selected project (`13b146f`). This is a disclosure improvement, not containment.
- New code changes have not yet been tested, typechecked, packaged, or visibly exercised. Those checks remain queued for the final verification pass, per the current work sequence. No model request or inference settings were changed.

## 2026-10-31 remote MCP and tool-boundary implementation

- Added remote MCP Streamable HTTP alongside stdio, with HTTPS required except loopback, redirects explicitly disabled in the HTTP client, environment-reference resolution for credentials, configurable connection/read timeouts, and per-tool approval retained. The config editor documents `${ENV:NAME}` usage. The stdio child now receives the SDK's default allow-listed environment plus only explicitly configured variables; the whole parent process environment is no longer forwarded.
- Updated MCP dependencies to patched v1.30+ and below v2. This avoids the official SDK's affected HTTP redirect behavior (cross-origin redirects could forward custom headers in earlier versions). Direct credential literals in sensitive remote headers are rejected; use `${ENV:VARIABLE_NAME}`.
- Updated the capability directory and parity register to show local/remote MCP support, with remote connection and auth acceptance still pending.
- Commits: engine `5850163`; app `1ccad36`, capability assertion `07f4c4d`, and documentation `4a2f943`.
- Tests/build/package/visible acceptance remain queued for the final verification pass. No MCP server was launched and no model was loaded or requested during this change.

- Follow-up hardening commit `ab1df55` expanded environment-only references to cover token/cookie header names as well as Authorization/API-key headers. This code has not yet been run against the final pinned MCP 1.x dependency or a real HTTP MCP server.

## 2026-10-31 stop-point handoff

Source implementation batch committed; the current source gates passed (engine: 132 pytest; app: 43 Vitest and 38 sidecar pytest; TypeScript typecheck passed). One existing Starlette pending-deprecation warning remains. This is source-level evidence only: package rebuild, visible acceptance, and live-model checks are still open. No inference/model was started for this checkpoint.

Resume order: (1) inspect both repo status/logs and this readiness note; (2) run source suites/typecheck on the committed tree; (3) build and inspect one Windows package/sidecar; (4) run the single-instance disposable-project UI workflow including approvals, file/diff review, test output, cancel choices, hide/reopen, session restore, and project isolation; (5) only then perform the previously approved exact-tag model run, preserving any model already loaded and leaving user token/reasoning settings untouched. Continue core parity gaps in `CORE_HARNESS_READINESS.md`; keep UI polish, analytics/KV display expansion, and orbit interactions deferred until the core gates pass.



## 2026-10-31 packaged build and resumed-session inspection

- `npm run make` completed on Windows x64. It produced `out/make/squirrel.windows/x64/Local Agent Workbench-0.1.0 Setup.exe` (208,450,048 bytes), `LocalAgentWorkbench-0.1.0-full.nupkg` (207,673,440 bytes), `RELEASES`, and `out/make/zip/win32/x64/Local Agent Workbench-win32-x64-0.1.0.zip` (211,604,275 bytes). PyInstaller emitted optional hidden-import warnings for unavailable mypyc/importlib_resources modules; the worker build and Forge targets succeeded.
- The bundled worker passed its actual handshake: startup `ready`/0.1.0, JSONL ping response `ok: true`, shutdown response `ok: true`, process exit 0. An initial smoke script incorrectly expected a request ID before the startup line; that test-driver assumption failed, and the corrected handshake passed. No inference was sent by either smoke attempt.
- Launched one packaged app window after confirming no Workbench process was running. Home reported Ollama reachable, 20 installed models/markers, the selected mradermacher Ornith tag, 262,144 active context, two workspace-history entries, and one saved session.
- Opened the existing disposable workspace at `%USERPROFILE%\Desktop\Local Agent Workbench\acceptance\website-flow-2026-10-31` and resumed canceled session `b3329511`. The UI showed its project path, selected model, 262,144 context, 4,096 output, reasoning at model default, canceled status, and five persisted activity records (three list-files outcomes and two command outcomes). No new user or assistant content was generated.
- The Live Work Sheet's Inspect Changes control remained separated from the task-signal text. Scrolling the sheet brought all five Activity Trace cards into view, followed by resource readings. The trace is below the initial viewport, so users must scroll the sheet to reach it.
- No inference or settings change occurred. The app remains open as one Workbench instance for the user's inspection.
- This is packaging/protocol plus partial visible restoration evidence. It does not cover a fresh model-backed coding task, active cancel choices, full project isolation, or live-model performance/quality. Those gates remain open.

## 2026-10-31 beta repository preparation

- The app README now identifies unstable-beta status, key capabilities, security boundaries, build steps, paired engine revision, and exact evidence/limitations. Added contribution and private-vulnerability reporting guidance, an initial changelog, pull-request and bug templates, and a Windows source-check workflow.
- The engine README now describes its role as the independently versioned Python dependency; added a Windows pytest workflow.
- Paired engine source revision recorded in `core-revision.txt` as `3210b30503cfe529df47997fac678098108dd066`.
- Removed the tracked host-specific `model-inspection.json` from the engine's current tree and added it to `.gitignore`; the local file remains on disk. Redacted the current documentation's Windows profile path to `%USERPROFILE%` for public-facing docs.
- GitHub account authentication and repository-name availability were checked. No remote repository has been created or pushed yet. The license choice is still awaiting the user's selection; do not describe the public repo as license-granted/open-source until that file is added.
- Both local repositories are now registered in GitHub Desktop on clean `main` branches. A targeted pattern scan of every reachable Git blob across both full histories found no private-key blocks, GitHub token patterns, AWS access-key patterns, or long quoted secret assignments (app: 322 blobs; engine: 240 blobs). This is a useful preflight, not a substitute for GitHub secret scanning or a comprehensive security audit.
- The engine's removed `model-inspection.json` still exists in earlier Git history so the full history remains intact; its old contents included a machine-local Ollama model blob path. The current tracked tree ignores/removes that file. No credentials were detected, but the historical local path is disclosed here before public publication.
- The user selected MIT for both repositories. Added MIT license files and updated the app package metadata; this permits reuse and redistribution under the license terms.
- Aligned app package version to `0.1.0-beta.1` and built isolated Windows x64 artifacts under `out-beta/make/`: Squirrel setup (208,448,512 bytes), full nupkg (207,672,179 bytes), and ZIP (211,603,607 bytes). These generated files are not committed to source history; release assets can be attached after public repositories and acceptance gates are ready.
- The bundled beta worker passed `ready` handshake, JSONL ping (`ok: true`), JSONL shutdown (`ok: true`), and exit code 0. No model was loaded or inference started. The worker currently reports protocol/app version `0.1.0`; desktop installer version is `0.1.0-beta.1`.
- The app's `core-revision.txt` and CI checkout now pin the MIT-licensed engine commit `559da92f68d2a13e6ad63d21cd79d05d71b319ac`.
- npm package audit: production dependencies report zero vulnerabilities; the complete development dependency tree reports 18 moderate findings, primarily through the Electron Forge 8 build/maker chain. npm's proposed automatic fix is a major downgrade to Forge 7.11.x, so no forced dependency change was made after the beta package built successfully. Track compatibility review before a follow-up beta.
- Beta asset SHA-256: setup `AD430567F48155D229A84C5E9A2156CEF252AC976D022B53F9BE94AAF47A99FB`; ZIP `DBEC193363DDA6D0485C168F9A1F7C24A931DA89712073D353CD965F6FF66E91`; nupkg `05D3C284B8196B8FCF77D8F74571D524519E61DE156B6B229761A7B0A681A86F`.
- GitHub Desktop published both MIT-licensed repositories publicly: [desktop app](https://github.com/MrNova420/local-agent-workbench) and [Python engine](https://github.com/MrNova420/local-agent-workbench-core). Their descriptions and relevant language/runtime topics are set; both default branches are `main`. The GitHub beta prerelease has not yet been created. Final visible packaged coding and cancellation acceptance still gates that release.
- GitHub Actions on both repositories could not start a runner; check annotations report an account-level billing lock. Do not report remote CI as passing. Local typecheck/tests and packaging evidence are recorded above.

## 2026-10-31 continued live acceptance and activity-trace correction

- The visible coding run remains deliberately untouched in the original single app instance. At 2,505 seconds it is still marked `GENERATING`; the UI continues to show about 3,723 output tokens and `Now the stylesheet:` without advancing the response. `ollama ps` confirms the exact Ornith tag remains loaded with 262,144 context; system RAM is about 30.5 / 32 GB, CPU about 89%, GPU about 36%, and VRAM about 3,637 / 4,096 MiB. Only `index.html` exists in the disposable workspace so far. This is an incomplete and very slow sample, not a completed coding acceptance. No cancel, second app instance, second model request, or unload was issued.
- The current package visibly exposes two cards for one approved write (`Write File` completed and a second `Write File` approved). Source now stores approval state on the operation row (`approvalStatus` / `approvalMode`) and renders it as an approval badge, rather than persisting a second trace row. Regression coverage: activity renderer suite 5 passed; focused worker approval cases 2 passed; TypeScript typecheck passed. The already-running package uses old code, so visual confirmation awaits the next safe package.
- Preload and token-setting changes remain source-only pending package verification. The active package's `262,144 / 4,096` values came from its fresh beta state and the old advertised-maximum default path; the user's established choice was `65,536 / 8,192`. Source now preserves that preference. Do not treat the current run or package as evidence that the corrected defaults have been visually verified.

## 2026-10-31 corrected-context restart and continued core development

- Restarted the disposable Ember & Rye website task in the existing single packaged app using the selected `65,536` context / `8,192` output values and model-default reasoning. The session and Live Work Sheet both show those exact values; runtime status reports 65,536/65,536 tokens. The old run was explicitly canceled through its required decision prompt; the restarted run remains active and has not been canceled.
- Latest visible sample: elapsed 1,257 seconds, still `GENERATING`, about 301 output tokens and ~0.3 tokens/second. The latest output remains “Now creating the stylesheet:” with no write approval shown. CPU was 89%, system RAM 22.6/32 GB, GPU 11%, VRAM 2,995/4,096 MiB, and power 12.37 W. The output-token count had not advanced between the 846-second and 1,257-second samples. This is a slow, incomplete run; it is not a successful full-project acceptance. No second app instance or model request was started.
- Follow-up sample at 1,439 seconds still showed 301 output tokens (`~0.2` tokens/second), `GENERATING`, CPU 75%, RAM 22.7/32 GB, GPU 25%, VRAM 2,995/4,096 MiB, and 10.54 W. The saved checkpoint remained `running`, with 28 partial answer characters, 38 reasoning characters, and no active operation. Read-only Ollama `/api/ps` confirmed the exact model remained loaded at 65,536 context. The run remains untouched.
- Shared engine revision advanced to `1d68312`: structured tool-argument validation now checks common nested JSON Schema constraints/composition, JSON-correct numeric/boolean equality, non-finite numbers, and local JSON Pointer references, while rejecting unsupported schema keywords and external references. Operation outcomes distinguish partial capped scans and failed inspection results. Regression tests were added but deliberately not executed. The paired app source pins this revision and documents the queued verification.
- No automated suite, typecheck, package build, or new live task was run during this development phase, following the instruction to defer testing until development is complete.
## 2026-10-31 user-reported extended full-project run

- The user confirmed the previously slow disposable simple-website task eventually completed successfully after roughly 2–3 hours on their PC. They reported that the model planned the work, proceeded through the workflow, wrote the project, and that the overall run worked well despite the long wait and modest visual quality of the resulting site.
- This is user-reported end-to-end evidence. I did not independently inspect the completed website, capture its final files, or measure the exact model/runtime parameters for that run. It demonstrates one real project-development success, not general reliability, speed, quality, or release readiness.
- Keep the result as a positive acceptance case. Future workflow improvements should preserve the successful plan → action approval → file operation → completion path while making long generation observable and preventing scroll-follow from pulling readers away from earlier chat content.

## 2026-10-31 release-preparation source changes

- Added GitHub-release updating for packaged Windows x64 Squirrel installs through Electron's public update service. It checks after the first-run lock window and every six hours, skips checks during an active model task, downloads in the background, and offers an explicit restart/install control in Settings. The update action refuses to apply while a run is active. Development builds and unsupported platforms have no updater.
- Added Squirrel lifecycle-event handling so installer/update/uninstall launches do not create an ordinary app window or start the Python sidecar. Set the Windows AppUserModelID to match the Squirrel package.
- Added a Home first-run checklist, an in-app official Ollama installer route and retry, a transcript follow mode that respects readers scrolling upward, compact chat operation rows with expandable full output, and outside-click/Escape dismissal for the existing clickable model detail popover. The fixed orbit rings remain decorative; only installed model slots render as dots.
- Replaced the README with public-beta setup, platform/dependency boundaries, model and approval behavior, update expectations, and a clearly labeled historical screenshot. The initial screenshot search was limited to the checked output folder; a later search of saved Windows screenshots found and preserved another full acceptance capture. Current release-candidate Home/chat/worksheet captures still need visible acceptance.
- Added a tagged Windows beta-release workflow and runbook. The workflow uses the engine revision pinned in `core-revision.txt`, runs checks, builds the sidecar/installer/ZIP, creates SHA-256 checksums, and publishes the Squirrel assets required for updates. GitHub Actions execution and current update-feed behavior have not yet been verified.
- Expanded the screenshot search beyond the task output directory after the user noted that more past captures exist. Saved the full project-development acceptance screenshot to `docs/screenshots/history/live-acceptance-session-2026-10-31.png`; excluded captures that show the known worksheet overlap or a blank loading skeleton. The Home hero captures are older static-orbit designs and are explicitly not evidence for current adaptive model dots.
- These changes are source state only at this entry: automated checks, package rebuild, visual UI inspection, installer upgrade, updater discovery, release publication, and screenshots remain pending. Model context, output limit, and reasoning defaults were not changed.

## 2026-10-31 release-preparation verification pass

- App typecheck passed. App suite passed with 52 Vitest tests and 44 sidecar tests.
- Engine suite passed with 140 tests. Its first run caught a false failure classification when `read_file` returned ordinary text beginning with `Invalid`; the engine now limits invalid-result checks to operations where that wording is a tool error. The fix is committed as `ff67bcad93e72fad7add4eb8fc9e8aac1358e633` and pinned by the app and both workflows.
- Verified against Electron's updater service documentation that the feed route is `/{owner}/{repo}/{platform}-{arch}/{version}`. Corrected the previously reversed route before any release; the corresponding feed unit test is included in the 52 passing Vitest tests.
- Rebuilt package, visible current-build acceptance, install/upgrade updater path, release upload, and on-device UI screenshots remain pending. No model request was issued, and model context/output/reasoning settings were left unchanged.

## 2026-10-31 beta.2 packaged acceptance follow-up

- Rebuilt beta.2 into an isolated release-candidate output folder to avoid mixing prior artifacts. It contains the x64 Squirrel Setup.exe, full `.nupkg`, `RELEASES` manifest, and portable ZIP; the bundled worker's JSONL ready, ping, and shutdown exchanges passed without contacting Ollama.
- Opened the packaged beta.2 app after confirming the previous app process tree had exited. Visually checked Home with 20 installed-model markers, selected Ornith model, and the stored 65,536 context / 8,192 output preferences; checked a different marker's detail popover and Run Configuration's model-default reasoning selection. No model request or preload was made.
- Saved screenshots remain historical rather than release-candidate captures. The curated README gallery now includes three relevant historical images; unrelated product screenshots, duplicate hero crops, and captures with known overlap/skeleton problems were excluded. The early orbital concept is labeled as static historical design, not the current adaptive model display.
- Local checks passed: typecheck, 52 app Vitest tests, 44 sidecar pytest tests, and 140 shared-engine pytest tests. GitHub Actions push checks did not acquire a runner (runner ID 0, zero steps); those remote checks are blocked by repository/account infrastructure and are not counted as passing.
- Remaining release evidence: installed Squirrel first-run/update discovery and an actual update cycle. The portable packaged build correctly reports that updates are unavailable. No model settings were changed, no model request was sent, and no model was loaded or unloaded for this verification.
- Published the locally built artifacts as public GitHub release [`v0.1.0-beta.2`](https://github.com/MrNova420/local-agent-workbench/releases/tag/v0.1.0-beta.2): Setup.exe, ZIP, Squirrel `.nupkg`, `RELEASES`, and `SHA256SUMS.txt`. Verified GitHub's published SHA-256 digests against the local artifacts. After upload, corrected the manifest filenames to match GitHub's dot-normalized asset names and replaced the manifest; the listed artifact hashes remain unchanged.
- Tag-triggered Windows source-check and package workflows also failed before starting a runner (runner ID 0, zero steps). The release assets came from the locally verified isolated build; remote workflow execution remains unverified.

## 2026-11-01 continuity source batch (verification queued)

- The isolated app worktree now pins shared engine `b051d9663f0d4a00a4e89de8350f254ec88fd240`; CI and Windows release workflows use the same pin. Engine commit is local source only and has not been packaged or released.
- Added run journals with per-mirror retry state, replayed session-list status, corrupt-journal recovery notices, terminal checkpoint status, and recovery of streamed text/reasoning across provider errors and follow-up model calls. The renderer surfaces journal recovery issues in the Activity Trace.
- Added regression cases for one-mirror journal retry, malformed journal preservation/reporting, partial response retention, and follow-up request checkpointing. These tests, all broader suites, typecheck, packaging, and visible acceptance remain queued; none were run for this batch.

## 2026-11-01 command-side-effect evidence source follow-up (verification queued)

- The app now pins shared engine `ef711bda954a2eba289760221813de5d20239d48`; CI and the Windows release workflow consume that same `core-revision.txt` value.
- Renderer evidence now exposes possible command side effects and whether a later inspection occurred. Command-only implementation is labeled unverified when structured file tools did not observe a write; failed commands warn that partial effects may remain.
- Renderer regressions were added but not run. Engine regressions, all source suites, typecheck, packaging, visible acceptance, updater canary, and exact-model live measurement remain queued.

## 2026-11-01 task acceptance criteria source follow-up (verification queued)

- The app now pins engine `e9c02cd936fd8404d4e3c152801d05ef2b900ac1`. Task plans can carry concrete acceptance criteria in the checkpoint and mirrored plan activity; session restore uses the latest plan snapshot and new tasks reset old criteria.
- The Plan panel displays criteria separately from plan-step status. Engine, sidecar persistence, worker and renderer regressions were added but remain unrun. All full source/package/visible/model gates remain queued.

## 2026-11-01 uncertain command-stop source follow-up (verification queued)

- The app now pins engine `536b37050566e64c67476de013629a83c089089b`. An approved command stopped after launch or terminated by timeout is recorded as uncertain because it may have left partial files; it prompts a bounded workspace inspection and the renderer warns the user. A command denied or canceled before launch is not reported as having possible effects.
- A mock status regression was added but not run. All tests, typecheck, package, visible acceptance, updater canary, and exact-model measurement remain queued.

## 2026-11-01 uncertain-operation recovery source follow-up (verification queued)

- The app now pins engine `d4bf35cfb7d949b71a2e98242b0ccff421b1296a`. The compacted task checkpoint carries an explicit instruction to inspect saved output and workspace state before repeating an uncertain operation and forbids automatic replay.
- A queued continuity regression checks that the uncertain operation reference and review requirement survive compaction. No tests or runtime checks were run.
- Added Workbench-owned skill enablement/source selection, captured it per run, excluded the skill tool when disabled, and added a sidecar command that persists session run settings. Added queued regressions for source filtering, disabled-skill exclusion, captured turn settings, and session persistence; they have not been run.
- Run Configuration now writes selected model and settings to both session mirrors rather than relying on the next run to persist them; changes are refused while a task is active. Switching model selection resets reasoning to that model's default before the user chooses an override.
- Terminal turns now persist an observed workflow outcome distinct from “the run ended”; the worksheet labels discussion, plan-only, blocked, changed, inspected, command-completed, and command-failed evidence. A new task clears stale plan rows. Added queued engine, sidecar, and renderer coverage; no tests or UI verification were run.
- Desktop completion now carries the engine's observed outcome through the post-save terminal event; a successful engine return without its expected completion event is recorded as failed with a checkpoint blocker rather than guessed to be discussion. Queued regressions now cover post-save event ordering and missing-terminal fail-closed behavior. The persistence fixture uses the actual `generation_complete` journal event. This integration remains unverified.
- Added explicit worker regressions for the real engine `complete` → relay `generation_complete` → persisted session → renderer `complete` sequence, plus the fail-closed path when a worker returns without terminal evidence. Updated mocked engines to emit the terminal event contract. These remain queued.
- Added persisted Auto/Discuss/Plan/Implement intent. Build-like prompts in Auto and explicit Plan/Implement receive a visible Workbench checklist before inference; the model receives it through the checkpoint and can replace/refine it with `update_plan`. Read-only intent/access uses a read-only built-in tool catalog and suppresses MCP for that turn. Added queued engine/worker coverage for starter plans, saved settings, effective access, and MCP suppression. This remains source-only and unverified.
- Added an evidence contract to terminal verification: host-observed project change, post-change inspection, and approved-command results are stored with the task checkpoint. The engine requests a post-change inspection even if a command already ran, and implementation turns with no observed project change are labeled `implementation_incomplete`; explicit Implement under Read-only access is `blocked`. The UI explains the incomplete result. Added queued engine and session-recovery assertions; tests remain unrun.
- The session outcome card now restores and displays the evidence contract after reopening: project-change observation, post-change inspection state, and approved-command results, with successful command completion explicitly separated from test success. Added queued renderer coverage for new and legacy evidence records. This path is source-only and unverified.
- Each provider request now creates a durable Prompt Sources activity card with message roles/sizes, context/checkpoint/compaction facts, project instruction and retrieved-file paths, exact skill catalog inclusion and retained skill-load references, and the tool/MCP names actually sent. It stores source metadata, not duplicate prompt text or MCP credentials. Engine, activity rendering, and journal-recovery regressions are queued; this is not yet UI-accepted.
- No app was opened, no model request was sent, and no context/output/reasoning or runtime placement setting was changed.

## 2026-10-31 next core-workbench iteration

- Created isolated worktree `core-workbench-next` from the published app commit `2dc2442` for post-beta core development.
- Refined default chat tool activity from bordered mini-cards into compact clickable text rows showing action, first affected path when available, and operation state. Opening a row reveals complete arguments, output streams, result, all affected files, and approval state; long output remains progressively readable. The worksheet Activity Trace and its panel layout are unchanged. Sidebar-only and full-inline display modes remain available.
- Updated B-015 and the changelog to preserve this interaction contract. Automated tests, typecheck, package build, and visible UI acceptance are deliberately queued for the final verification gate; this change is not yet visually accepted.
- In the separate engine worktree, added one bounded continuation for implementation turns where the model ends by asking in prose to run/execute a command. It requests a structured tool call and leaves the normal approval dialog as the only authorization path. Engine commit `a1c6138` is not yet pinned by this app branch; regression tests and visible approval acceptance are queued.

## 2026-10-31 turn activity, live model orbit, and window chrome follow-up

- Added persisted turn IDs before inference begins and associated restored transcript user messages with their saved turns. The chat now renders activity directly after the matching prompt, using the same activity event stream as the worksheet.
- Made the Home catalog deduplicate and stable-sort Ollama and registered GGUF IDs, and refresh it every 30 seconds while Home is visible. The source maps each unique local model to one marker; live zero/one/many catalog acceptance remains unverified.
- Filtered missing or invalid registered GGUF paths out of the model catalog so stale library entries do not count as installed Home dots.
- Marked transcript-backed turns separately from pre-inference cancellations so hidden/non-transcript records cannot shift restored activity onto the wrong prompt.
- Removed the always-visible Electron titlebar overlay and added a narrow preload/main-process window-control bridge. Custom window buttons are revealed only when hovering/focusing the top-right hotspot; close still goes through the existing run decision.
- The README already includes the Home hero orbit capture. Its caption now more clearly identifies it as a static historical visual reference, not proof of the current live model markers.
- Tests, typecheck, build, screenshots, and packaged visual acceptance remain queued as requested. No inference request, model loading, token/reasoning setting change, or OpenCode configuration change was made.
- Paired source and both GitHub workflows now pin shared-engine commit `a1c6138a41cb4db5c90f31defd11d121568fdbbe`, which contains the approved one-step prose-to-structured-command continuation. Its approval dialog remains the authorization boundary; tests and packaged acceptance are still pending.
- Advanced the paired engine pin to `e5158359cca2e780ca506cfd98e8b8015c63852a`. It now distinguishes successful inspections, completed commands, failed commands, and absent verification evidence; the app warns on failed post-change commands without claiming that a completed command means tests passed. The existing build-task regression was updated to the inspection status but remains unrun. Package acceptance also remains queued.
- Added a queued sidecar regression for cancellation before the worker thread begins. It checks the persisted terminal `cancelled` run state, the unsaved-transcript turn marker, and the terminal/idle events; it was not run.
- Added a queued renderer regression that verifies an early canceled turn cannot shift restored activity links; existing turn records without the new marker retain legacy mapping behavior. It was not run.
- Documented patch releases as monotonically increasing beta tags with the full Squirrel asset set. Release tags automatically publish and therefore remain reserved for a verified build; no tag was created for this development batch.

## 2026-11-01 provider request evidence follow-up (verification queued)

- Paired source pin advanced to engine `4f12fd6eed7aeb708767a4de50474bbdd31a4241`. Each prompt activity now receives the exact provider request settings and the corresponding provider-returned token/timing counters, correlated by turn and request index. Both are saved in the session snapshot and reconstructed from the mirrored event journal; the Activity Trace separates request settings, estimates, and provider-returned metrics. Legacy sessions say when exact request data was not captured.
- Added mocked regression cases for Ollama default-versus-explicit reasoning fields, llama.cpp effective context, sidecar live correlation, journal recovery, and request-card rendering. These tests have not been run. No app, model, typecheck, package, visual acceptance, or external service was used. Context/output/reasoning choices and runtime placement remain unchanged.

## 2026-11-01 cancellable response-header wait (verification queued)

- Paired source pin advanced to engine `021dfadc7916acb6977362b7a65724c35b7ce3bd`. Ollama and llama.cpp inference now expose the active HTTP socket before waiting for headers, so the existing request-only Cancel path can interrupt header waits as well as generation. Connection establishment is bounded separately; after it connects there is no request/header/model-response deadline.
- The request activity now persists its lifecycle (prepared, dispatched/waiting, response headers and status, stream end, failure phase, or cancellation), and session replay restores that state. The trace now describes the request as prepared or waiting until the corresponding transport event confirms progress.
- The live run phase also changes from waiting for response headers to waiting for the first token, reasoning, generation, and response processing from those transport/runtime events. A queued phase-transition regression covers the chat status and progress rail.
- Added a delayed-header local-provider cancellation regression and updated mocked stream/persistence/renderer cases. None have been run; no model/app was launched and no inference settings or model ownership were changed.

## 2026-11-01 llama reasoning phase attribution (verification queued)

- The paired engine pin is now `c7f8fbb48d5df4f7e22f2261f55722a69b28f91e`. llama.cpp now reports a reasoning phase while only reasoning tokens arrive, then switches to generation when answer text or tool-call output begins, matching the Ollama phase behavior. A mocked transition regression was added but remains unrun.

## 2026-11-01 complete provider body fields (verification queued)

- The paired engine pin is `dd4278eeb8413093b58f85fb8c2ae95980c1f47d`. Request evidence now records provider-specific body fields in addition to normalized options: Ollama's explicit `think` field only when present, and llama.cpp's `stream_options.include_usage` setting. Omitted reasoning remains omitted and does not change the model default.
- The sidecar persists these fields in snapshots and mirrored journal recovery; the Activity Trace displays them separately from normalized options. Added queued engine, persistence, worker, and renderer assertions. Tests, typecheck, package, UI, and model checks remain unrun by instruction.

## 2026-11-01 uncertain remote MCP results (verification queued)

- A dispatched MCP operation whose cancellation or response failure prevents confirmation now ends with an `uncertain` result and a durable record of the exact call arguments. The engine stops the rest of that response's tool batch; each unexecuted call is recorded as `blocked`, with no automatic retry. Recovered sessions retain the uncertain operation and its activity state.
- Remote exception detail is not copied into the user-facing result, avoiding accidental disclosure of endpoint-provided credential text. Added mocked engine and journal-replay regressions; they remain queued. No MCP server, app, model, or test suite was run.
- Paired engine commit: `ed1d27f86414bb97b208683d6625e41c87e723ea`. The compact activity row also surfaces “inspect before retry” without requiring expansion; a queued renderer assertion covers that cue.
- A separate queued MCP adapter regression covers timeout after dispatch and asserts that the uncertain result does not echo raw exception text. It has not been run.
- The exact paired engine pin now includes that timeout regression and its implementation note (`11255ad9ea2e289afdd53b74821f6fbff2866577`).

## 2026-11-01 streamed tool-call preparation cue (verification queued)

- Both local streaming adapters now report tool-call name and argument-character progress without exposing partial argument content. Chat and the Live Work Sheet Activity Trace show the same transient “not dispatched” cue; complete operations continue through the existing activity, approval, and persistence flow. The partial preview itself is transient and not journaled.
- Added queued Ollama, llama.cpp, and renderer-state regressions. No tests, typecheck, package build, or visible UI acceptance were run.

## 2026-11-01 MCP schema capability visibility (verification queued)

- MCP discovery now performs a bounded scan of advertised schemas and reports unsupported keywords, types, and non-local references in the tool description before invocation. Validation remains fail-closed; this reports capability gaps and does not claim broader JSON Schema support.
- Tool Catalog displays the warning in the tool and server details, and discovery emits a warning when affected tools are available. Added queued engine schema/discovery and sidecar catalog regressions. No tests, typecheck, package build, or visible acceptance were run.
- JSON Schema `format` metadata is accepted as an annotation under the default specification behavior; values such as date-time are not asserted valid. The shared validator now handles common conditionals, dependent fields, property-name constraints, tuple prefixes, and `contains` bounds, with root-level rejection of unsupported schema features even in inactive branches. App pin advanced to engine `c3e3a11804df72e1c1ed5bfb5b49ef044b14c1b2`; corresponding regressions remain queued. No model, runtime, or inference settings were changed.

## 2026-11-01 active-task compaction and operation-result retrieval (verification queued)

- A single oversized active task can now compact prior assistant/tool exchanges at complete call/result boundaries while preserving the original task prompt and newest exchanges that fit. Full canonical transcript and operation results remain saved. The model can retrieve omitted output with a new read-only operation-result tool, including character ranges for large outputs; lookup is scoped to the session captured by the run.
- Compaction activity records and the Live Work Sheet show omitted exchange counts separately from omitted earlier turns. Added queued engine, sidecar, and renderer regressions. None were run, and no model/context/output/reasoning setting changed.
- App pin advanced to engine `156e05c881c452138d3bd6258014b269b913631d`; no package or release was produced.
- Standalone AgentEngine/CLI now has an in-memory fallback for complete operation results when no app session-store callback exists; the desktop's captured-session lookup remains primary and durable. The regression is queued. App pin advanced to `0f5c7f193f3bab4a162e167cccd6a0f6536e45ff`; no tests or package were run.

## 2026-11-01 progressive activity timeline (verification queued)

- Chat and the Live Work Sheet continue to consume the same full session activity records. The renderer now starts with the most recent 100 cards and exposes older cards in 100-entry increments, keeping long histories available without mounting every card immediately. This window is presentation-only and does not truncate or rewrite session history.
- Added a renderer regression for a 245-event history. No tests, typecheck, package, or visual acceptance were run.

## 2026-11-01 runtime worker resource attribution (verification queued)

- Resource telemetry now separates the Agent Workbench sidecar from detected Ollama/llama.cpp worker CPU and resident memory. Where NVIDIA reports compute-process memory, the worker PID is matched and runtime-process VRAM is shown separately; system GPU utilization/power and device VRAM remain explicitly device-wide. No selected-model GPU percentage is inferred.
- Added mocked telemetry coverage and advanced the app's engine pin to `8e5702467fd7b36249a0574831a5d0261ad89ee3`. Tests, typecheck, packaged UI, and live hardware evidence remain queued; no model or runtime settings changed.

## 2026-11-01 command timeout controls (verification queued)

- Approved commands no longer receive a hidden 120-second timeout or a fixed one-hour ceiling. Omit `timeout_seconds` for an unbounded command wait controlled by completion or the user Cancel action; explicit positive timeouts remain supported with no silent cap.
- Added queued engine coverage. App pin advanced to `f540259cfe195e6e076e848a516cebb2aebbe47f`; tests, typecheck, package, and long-command UI acceptance remain queued. No command was run.
- The retained CLI command approval preview now shows the actual command plus whether there is no deadline or an explicit timeout. App pin advanced to `1b5d5ccdd33f8d0069ac6b4f61687e1955357eac`; source checks and CLI acceptance remain queued.
- The mocked runtime-resource regression now lives with the engine telemetry it exercises. The app pin advances to `51cd9e4a6fc3c414d56b454d0e1c365ac3abf37e`; it remains unrun.

## 2026-11-01 cancel chooser acknowledgment (verification queued)

- Cancel now remains visible until the sidecar acknowledges the action; IPC failure leaves the required decision available for retry. The sidecar reports when there is no active run, and the UI reports that state instead of implying a cancel succeeded. Finish-current-operation also waits for the host's accepted/not-active result. Added mocked worker coverage; no tests or UI checks were run.
- App-close choices now remain pending until Electron acknowledges keep/hide/cancel; cancellation must be accepted and the run must become idle before shutdown. IPC or tray failures leave the choice available and report the error. Packaged close-flow acceptance remains queued.

## 2026-11-01 durable model tool-preparation activity (verification queued)

- Ollama streamed tool-call progress now updates a compact activity card in chat and the Live Work Sheet. The same row is journaled and restored after session recovery. Persisted fields are limited to provider, tool name, request/call identity, and argument character count; partial arguments are not saved or shown.
- Completed tool batches mark their preparation rows `assembled`; a provider request error marks them `interrupted`, keeping saved activity state consistent with the run result.
- The paired engine now includes the inference request index on `tool_batch` events so activity transitions remain tied to the correct request. Engine and sidecar regressions are queued.
- The app pin now advances to `1ca4754432a9f2d974c530bc0d25b56a5ab7521b`; it matches the request-indexed tool-batch event implementation. No tests, typecheck, package, or visible UI verification were run.

## 2026-11-01 incomplete command verification (verification queued)

- The engine now records cancelled, partial, uncertain, and otherwise incomplete command results as `command_incomplete`; that state takes precedence over a generic “changed” outcome when the task also modified files. Failed commands remain `command_failed`, and completed command execution still does not imply a test passed.
- Added helper regressions for partial and cancelled command results. No tests or command execution were run.
- The app pin advances to engine `a846152c539daa235abb6b2d6fa1beb07a1ee851`.

## 2026-11-01 budgeted checkpoint continuity (verification queued)

- Large checkpoints now receive an inference-only budgeted summary when needed to leave input room for the active conversation. The canonical on-disk checkpoint is not modified. The summary preserves the active goal, plan, settings, latest operation references and latest instructions; it reports counts for summarized history.
- The compaction/activity event carries the checkpoint summary state and omission counts through session save/recovery, and the Activity Trace renders those counts.
- Added checkpoint, context-budget, and renderer regressions; they remain queued. No context/output/reasoning value changed, and no model request ran.
- The app pin now advances to `bb87dc5f6fdee5f0ef8ca89f0312044ad4ee3ecc`; app, sidecar, and engine source are paired at this revision.
- Added worker, journal-replay, and renderer regressions, including repeated progress updates coalescing to one call row. They remain unrun with the broader verification pass.

## 2026-11-01 observed task-plan progression (verification queued)

- Engine commits `4597a3f68fbe9c15c71626471d99bc6930dfcaea` and `8f909654763e608942161ca2789098f617242304` advance the Workbench starter checklist from observed project reads, writes, commands, and final verification outcomes. Existing agent-authored plans are left intact, including after resume; saved acceptance criteria are forwarded with host progress.
- The paired app source is pinned at `8f909654763e608942161ca2789098f617242304`. A focused engine regression covers host progression and agent plan ownership. It has not been run; no visible UI/session acceptance has been performed for this change.
## 2026-11-01 selected Ollama settings authority (verification queued)

- Fixed a request-construction precedence bug where generic runtime options could overwrite the selected context, output-token cap, and temperature. The selected controls now win; unrelated supported runtime options still pass through. Conflicts are included in provider request provenance and surfaced in the activity detail.
- Added engine streaming coverage and renderer activity coverage. Neither was run because broad regression verification remains queued until implementation is complete.
- App and engine revisions are paired at `923292b6879ea90e5c647519074ee5dfdfaf164c`. Existing user-selected settings were not edited, and no model was loaded or called.

## 2026-11-01 persistent permission policy source (verification queued)

- Engine commits `4448ad080a07bc37fc60601d91a453da7af48081` and `6841ff5e16a908250ec22e5ffc13ffa07222787f` add a validated rule evaluator for exact or wildcard tools, project-relative path patterns, and command prefixes. Deny wins over ask/allow and auto-approval; ask forces the ordinary approval prompt; no matching rule retains existing run behavior. Path patterns reject absolute paths and parent traversal.
- The Electron sidecar persists rules in app data, locks changes during active runs, and snapshots the rules into run settings before engine dispatch. Settings exposes the rule editor. Command and MCP execution remain host-account operations without OS containment.
- Engine policy, worker persistence/snapshot, and app source tests are queued and unrun. The current app pin is `7b7e575203cd8e3110fe4e89c95c38f451a843d7`; no package or visible UI acceptance has been performed for this change.

## 2026-11-01 project review session-data boundary (verification queued)

- Non-Git project snapshot review omits `.agent-workbench`; Git project review follows Git tracking, preserving the per-project opt-in to track session history. Engine retrieval/search continues to exclude `.agent-workbench`, whether or not the user tracks it.
- Added regression cases for the unversioned and explicitly tracked paths. They remain unrun with the deferred verification pass; no project/session data was read from the user's workspace.

The initial Git-diff exclusion was reversed in the later `Respect opt-in session tracking in Git review` commit because hiding explicitly tracked files contradicted the approved per-project opt-in.

## 2026-11-01 wildcard command permission consistency (verification queued)

- Wildcard command permission rules now require a JSON argv prefix, which the policy evaluator applies consistently to both direct `run_command` argv and parsed `run_shell` commands. Shell-only rules retain their readable text prefix form.
- Added shared parser coverage for wildcard and command-specific formats. Tests and typecheck remain queued; no permission settings were changed in user data.

## 2026-11-01 malformed permission policy recovery (verification queued)

- If saved permission rules are unreadable or invalid, the sidecar now preserves the source file, starts with no persistent overrides, and sends a startup warning to the app. The selected per-run approval mode remains in effect; the UI prompts the user to review Settings before relying on saved overrides.
- Saving a replacement policy clears the warning. A sidecar regression covers malformed JSON preservation and safe fallback; tests, typecheck, and packaged startup acceptance remain queued.

## 2026-11-01 journal-first provider telemetry checkpoints (verification queued)

- Provider dispatch/header/completion, request settings, usage, prompt manifests, tool batches/results, and plan events still flush to both append-only journals immediately, but no longer force a full session JSON replacement for each event. Full snapshots remain periodic (8 seconds) and forced at compaction, approval, and terminal boundaries.
- Added a recovery regression ensuring journal replay restores provider request status, exact usage, plan progress, and complete tool results without an intermediate snapshot. It is queued; fault-injection and long-run save-lock acceptance remain pending.

## 2026-11-01 small-model continuity guidance (verification queued)

- Historical engine commit `3b22665286de0636591f7469850c3e5fa50f2710` added small-model-only guidance that included “plan once.” That wording was removed in engine commit `0f05d7824c16d51ac491c3b48027ef9b9df57b25`; plans can now be repeatedly expanded and revised. No fixed action count, time limit, or inference setting is added.
- Added prompt regression coverage; it remains unrun. The app pin is synchronized to this engine revision; packaging and user-flow verification remain queued.

## 2026-11-01 checkpoint follows visible plan progress (verification queued)

- Engine commit `7f26a2ba4e10ff389ebf7dd215e2d05d72c73373` updates the durable task checkpoint's `next_action` whenever the Workbench starter checklist advances, so compaction receives the next unfinished step rather than stale generic guidance.
- Added a focused engine regression; it remains unrun. The app pin is synchronized; no model or inference setting changed.

## 2026-11-01 sidecar source preflight (verification queued)

- The Windows sidecar build now checks the complete set of directly imported shared-engine modules before invoking PyInstaller, so an incomplete or stale engine checkout fails with the exact missing source filename.
- Package build verification remains queued; no installer was built.

## 2026-11-01 permission-rule UI copy alignment (verification queued)

- MCP setup and persistent-policy dialogs now explain the actual defaults and precedence: approval by default, allow skips the prompt, ask forces it, and deny wins. They also retain the explicit Windows-account/no-OS-containment warning.
- UI rendering and accessibility acceptance remain queued; no permission rules were changed.

## 2026-11-01 small-model workflow description (verification queued)

- Run settings now describe the small-model profile as adaptive tool sizing with useful read batching and full-task continuation, explicitly without a fixed action or runtime limit or inference-setting changes.
- Visual acceptance remains queued.

## 2026-11-01 replay plan next action after interruption (verification queued)

- Session journal replay now derives the checkpoint's next action from the restored plan items, so an agent-authored plan update recovered after a crash does not leave the prior or generic next action behind.
- Added coverage to the existing plan/operation journal recovery case. Persistence tests remain queued.

## 2026-11-01 small-model guidance respects plan-only intent (verification queued)

- Engine commit `b2db2d8428298f6d9d31749e3e469a62c5d2e6b8` scopes anti-loop/progress guidance to implementation tasks and explicitly preserves Discussion and Plan-only behavior.
- Added prompt coverage; it remains unrun. The app pin is synchronized to this engine commit; inference settings are unchanged.

## 2026-11-01 plan decisions survive compaction and replay (verification queued)

- Engine commit `fd1104d1ef6fe321ae238721fe523c9bc4ca854e` adds optional concise design-decision/assumption summaries to `update_plan`. The engine writes them to the durable task checkpoint; the app includes them in Plan activity and reconstructs them from event journals. Guidance excludes hidden chain-of-thought.
- Added engine, sidecar, and journal-replay coverage; it remains unrun. The app pin is synchronized. No model or inference settings changed.


## 2026-11-01 restore plan decisions and criteria in activity cards (verification queued)

- Renderer activity cards now expose persisted concise plan decisions and acceptance criteria in expandable details, so the activity sheet retains why work was chosen and how success is checked after session restoration.
- Added renderer coverage; tests and visible session-reopen acceptance remain queued.

## 2026-11-01 checkpoint plan-decision migration guard (verification queued)

- Engine commit 8f0d477b467008bae802613cd53e89c3050f9969 discards a malformed legacy decisions field safely before recording new concise plan decisions. A regression is added for this recovery case and remains unrun. The app source pin and current readiness/roadmap references are synchronized; no tests or builds were run.

## 2026-11-01 recover missing Plan snapshots on session reopen (verification queued)

- The renderer now uses the latest turn's durable Plan activity only when an older/migrated session lacks its top-level plan field. Explicit empty snapshots remain authoritative, preventing old task checklists from returning.
- Added regression cases for turn filtering and intentional empty snapshots; unrun pending the planned verification phase.

## 2026-11-01 disclose bounded Git review omissions (verification queued)

- The Git project review now reports the exact number of untracked files omitted by its file-count or total-preview-size guard and points users to Git for complete review. Existing tracked diff output is unaffected.
- Added a limit-injected regression case; tests remain queued.

## 2026-11-01 context-aware project-file reads (verification queued)

- Engine commit 53f067c6c6190db0f23afa5065abd191599243f2 bounds each read_file result using the selected run context/output budget. Large files, including long single-line files, can be read as UTF-8-safe chunks with a precise continuation cursor. The operation clearly marks excerpts and reports its budget in the tool schema; it does not change either selected inference setting.
- Added continuation coverage for Unicode line columns; full engine and live context/output acceptance remain queued.

## 2026-11-01 selected-context read budget assertion (historical; superseded by dynamic allocation)

- The earlier source regression checked a fixed one-eighth allocation for a 65,536 context / 8,192 output run. That allocation was too restrictive and has been replaced; the selected settings themselves were never changed.

## 2026-11-01 context-aware file discovery pages (verification queued)

- Engine commit 153cf691edfd7757fc2ecbcc3c5aa488e7aa97a5 extends the selected-context read budget to file listing and text search. Listing and search now return resumable result pages; large matching lines point to their exact file line instead of filling a model request. No context/output setting is changed.
- Added coverage for page continuation and large matching-line disclosure; the complete suites remain queued.

## 2026-11-01 accurate file-scan cap boundaries (verification queued)

- Engine commit 8e377b23fde6dc38f51b3b1ffec12524de186572 checks one additional candidate before calling a bounded file scan incomplete. Projects with exactly the configured number of files no longer receive a false partial-results warning. Added exact-limit and over-limit cases; tests remain queued.

## 2026-11-01 oversized operation-result continuation (verification queued)

- Engine commit 515d2c34837b2cc915a979bc1aed39b70cc2e369 keeps the full operation result in engine/session history and bounds only the next model-facing tool message to the per-run context budget. The excerpt preserves both ends of logs, remains UTF-8-safe, and includes exact read_operation_result coordinates for the omitted middle.
- Added range/cursor and short-result regressions; engine, sidecar, and UI tests remain queued.

## 2026-11-01 expandable plans, concurrent reads, and scan defaults (verification queued)

- Engine commit `0f05d7824c16d51ac491c3b48027ef9b9df57b25` supports repeated plan revision and append-only independent workstreams, while retaining existing plan items and task decisions. The worksheet and restored activity cards now render optional workstream labels.
- Default project retrieval, file listing, and search no longer stop at implicit file/byte ceilings. Explicit scan budgets remain supported and report partial results; large-scan cancellation/progress remains open.
- Read-only batches are concurrent only when every call is schema-valid, independently readable, and free of permission rules. Writes, commands, MCP, and mixed or permission-sensitive batches retain ordered execution. Completion events/checkpoints are persisted as each read finishes.
- Tool output budgets account for current prompt, schemas, assistant tool-call, and prior batch results. Full results remain saved and oversized model-facing output carries a recovery pointer. This supersedes the earlier fixed one-eighth allocation; selected context/output/reasoning remain unchanged.
- Regression coverage was added for concurrency/order, plan expansion, scan defaults, workstream restoration, and selected-context accounting. No tests, typecheck, build, package, UI acceptance, or live model check was run.

## 2026-11-01 paged checkpoint recovery and cancellable file operations (verification queued)

- Engine commit `23f0f000db4d8d32ca063bd8242b879058ecfc0b` adds a read-only paged checkpoint tool for retrieving saved task plan/progress details omitted from a compacted inference copy. Complete transcript, emitted reasoning, and operation results remain in session history.
- Project retrieval, listing, search, and file reads now observe request cancellation. Text search processes files incrementally by line to avoid loading whole files into memory; completed/partial results are preserved and explicitly marked cancelled.
- Regression cases were added but no tests, typecheck, package, app launch, or live model run was performed.

## 2026-11-01 paged full-transcript recovery (verification queued)

- Engine commit `6bcf9c7f0099b54c49c96ae391d035478ddf6e12` adds an on-demand transcript reader for user, assistant, and tool messages, including emitted reasoning stored in assistant messages. It excludes the system prompt and returns character-offset pages.
- This provides access to omitted earlier context without injecting the whole transcript into each model request. No tests, typecheck, package, visible app flow, or live inference check was run.

# 2026-11-01 — Structured clarification source change (unverified)

- Added a desktop-only `ask_user` structured tool for material implementation choices. The host presents a non-dismissible answer dialog, stores question/answer activity, and returns the answer to the paused tool batch; it never substitutes for file or command approval.
- Resume recovery marks unanswered prompts interrupted without labeling them uncertain side effects, and preserves an already journaled answer if the app stops between answer and tool completion.
- Engine, sidecar, persistence, and activity-rendering regressions were added but intentionally not run. Typecheck, package, and visible interaction acceptance remain queued.
- A stale question reply now dismisses only the matching obsolete dialog and reports that the run is no longer waiting, avoiding a stuck non-dismissible modal. Renderer interaction verification remains queued.

# 2026-11-01 — Budget-safe task checkpoint projection (unverified)

- Engine commit `4ec81e176aa7257b03b71b345f62b896d170439c` compacts the inference-only checkpoint to its assigned budget, preserves the full canonical plan and history, and reports omitted details for paging. The fixed assistant-update character cutoff was removed.
- Regression cases for large expandable plans and oversized task goals were added. No tests, typecheck, package, app launch, or model request was run.
- The compact-envelope and omission-parser edge case now has a small-budget regression; it is queued and unrun.

# 2026-11-01 — Session-scoped follow-up queue (source only)

- Added a saved follow-up queue to the active chat: prompts may be drafted during inference, remain attached to that session/project, and start only after explicit user selection. Queue mutations do not cancel or steer the active request.
- Queue persistence, mirror behavior, project isolation, exact one-time consumption, and renderer interaction regressions are added but intentionally unrun. No typecheck, package, app launch, or model request was performed.

# 2026-11-01 — Small-output long-file workflow and controls (source only)

- Engine source adds access-controlled atomic `append_file` chunks so a large file can be assembled across responses while preserving the selected output cap and full-file inspection path. Sidecar activity and task verification recognize appended files as project changes.
- App source adds opt-in saved-chat session approval with deny/ask precedence and mirror fail-closed behavior; exact installed local model picks; and cache metrics that do not treat absent provider counters as zero. The worksheet also exposes llama.cpp's current-slot cached prompt-token count when `/slots` reports it.
- A restored session-wide approval grant is now trusted only when both app and project copies contain the same grant and matching session content; a missing/divergent copy drops the grant. This recovery safeguard is source-only and its regression remains queued.
- The existing update-feed URL and packaged-install gating match Electron's documented GitHub feed shape. The installed previous-version update and workspace/session recovery canary is still pending. No updater installation or app restart was performed.
- Related engine, sidecar, renderer, and updater regression cases are queued. No tests, typecheck, packaging, UI session, or model request was run; configured model/context/output/reasoning values and the running Flint model were left unchanged.

# 2026-11-01 — Progress-based implementation continuation (source only)

- The engine now continues implementation while plan, operation, changed-file, or verification evidence advances; it has no fixed continuation count or runtime deadline. Repeating an unchanged no-progress state ends with a durable `implementation_incomplete` checkpoint and resumable instructions.
- The app pins engine `7203d1123852fb3669fc2c5d1a2c86ce5df73d5b`. Regressions are queued and unrun; no settings or active model were changed.

# 2026-11-01 — Home/session recovery and wording-independent continuation (source only)

- Engine continuation uses host-observed project changes, post-effect inspection, denials, and open plan work. It does not parse phrases in assistant prose, and a command alone does not satisfy an implementation request. The original system prompt was retained; no context, output, or reasoning setting changed.
- Home now distinguishes first model sync, refresh, confirmed empty inventory, and failure. Last-known model dots remain visible while refreshing and after a failed refresh; exact local model IDs receive stable repeatable positions. Optional slow orbit motion persists and stops while a model card is open; reduced-motion preferences disable it.
- Home workspace and session history refresh independently from the active project session list. All app-wide sessions are visible with conflict/recovery/workspace status; available moved projects can be matched by saved identity. Corrupt/unreadable workspace history produces an error without overwriting the file, and does not prevent opening a valid project.
- Window controls now use a 20×14 top-right idle hit target, expanding on hover or keyboard focus. Packaged behavior remains unverified.
- Engine and app/sidecar tests are authored but intentionally unrun. No typecheck, package build, app launch, visual acceptance, or live model request was performed.

# 2026-11-01 — Project access independent of session indexing (source only)

- Project opening now waits for file access only; session enumeration loads independently, reports loading/failure, and provides retry without making the project appear unavailable. File refresh updates usable files even if session history cannot be queried.
- Project session reads are request-sequenced. A late save event for a previous workspace cannot replace the current project's session list. Restoring a session completes independently from its background project-session-list refresh.
- Restoring a session also reloads that session's own file inventory; stale navigation, file, and session requests are ignored to prevent the previous workspace's file panel from remaining visible after a project switch.
- No tests, typecheck, package build, UI acceptance, or model request was run. Verification remains queued for the final phase.

# 2026-11-01 — Automatic implementation state from structured evidence (source only)

- Removed prompt keyword/regex classification from engine continuation and starter-plan selection. Automatic intent now recognizes implementation from agent-owned open plan state and host-observed mutation operations; explicit Implement remains authoritative, while Discussion and Plan remain non-implementing.
- If an Automatic-mode model requests a structured file mutation without first creating its own plan, the host publishes and saves an implementation checklist before executing that write. Updated Run Configuration guidance and added regression coverage for the plan-before-write event order.
- The app now pins engine `b3057bd322b470cd444e7c3448070d658ee546b4`. Regressions remain unrun; no context, output, reasoning setting, active model, or runtime state changed.

# 2026-11-01 — Structured Automatic plan mode (source only)

- Automatic plans now carry an explicit discussion/plan/implement mode in the durable task checkpoint and Activity Trace. An open plan-only checklist does not trigger implementation continuation; a real structured write still activates implementation evidence and inspection. Explicit UI task intent is authoritative over model-supplied metadata.
- A new user follow-up retains plan and progress while resetting the prior Automatic mode choice to `auto`, so an earlier plan-only turn cannot suppress later implementation work. Explicit UI intent is authoritative over model-supplied mode, and unsupported internal `auto` is omitted from typed Activity Trace events. The mode is also included in the compacted inference checkpoint. Added engine, sidecar, and renderer regression cases for visibility, persistence, reset, and continuation. Automatic-mode app integration is in commit `c32145ccc8b0bcc424584e16830d1748702cd016`; the current app pin is engine `b5f989e7d0317e520ab2d50649c0854d87054f8e`. All checks remain queued and unrun.

# 2026-11-01 — Missing final response recovery (source only)

- After tool work, an empty assistant content result now triggers a final-response request. If repeated without observable progress, the engine records `response_missing` instead of completing silently. The status, verification evidence, and blocker are persisted and restored; the UI labels the outcome explicitly. No overall timeout or inference-setting change was added.
- Engine, sidecar recovery, and renderer regressions are authored and queued. The continuation signature now counts task-mode changes, host-observed non-plan operations, file changes, and verification; repeated `update_plan` calls alone do not count, while the plan remains expandable with no item/pass cap. The app pin at this historical checkpoint was engine `63dc15ab629b31c370cd8d1a683138c3d02e84f8`. No tests, typecheck, UI, package, or model checks have run for this change.

# 2026-11-01 — Active run composer and worksheet visibility (source only)

- Follow-up prompts can be drafted and saved while a model request runs. The queue remains explicit and session/project-bound; it does not interrupt or automatically chain the current task. The UI guards duplicate submission and preserves multiline/IME keyboard behavior.
- The renderer keeps the existing plan visible until the sidecar publishes the task's authoritative plan. The default worksheet now prioritizes Plan and Activity Trace and migrates the exact legacy default without overwriting user-customized layouts.
- An active-run status line distinguishes model reasoning from a complete structured tool call and reports elapsed time plus the labeled input estimate. Plan, tool, approval, and command events still flow through the durable event stream.
- Regression cases added, not run. No test/typecheck/build/UI/live-model verification performed; all remain queued.

- Ollama streams now fail visibly if EOF arrives without `done: true`; partial streamed text and reasoning stay in the run checkpoint. This specifically addresses incomplete responses being mistaken for finished reasoning. Regression coverage exists but remains unrun; current paired engine pin is `9d3b4d7e9bd36e3fd05f84a5b7451a78afc6bad1`.

- Added an app-side integration regression that drives an incomplete streaming response through the worker relay, then checks the persisted partial reasoning, terminal failure state, and prompt-activity request error details. It remains queued with all other verification.

# 2026-11-01 — Automatic plans continue into implementation (source only)

- The engine now treats a nonempty agent-authored plan in Automatic mode as an implementation obligation even when the model labels the phase `plan` or marks its checklist complete; it continues into project work and inspection rather than reporting plan-only success. Explicit Workbench Plan-only/Discuss remain read-only.
- The settings copy now explains that distinction. Added a queued regression covering plan → write → inspect → close plan → final response. Source-only; no tests, typecheck, UI, package, or model acceptance has run. Current app pin is engine `e6dea3fb31d1699d9cea214357797440a5036d02`.

# 2026-11-01 — Resume preserves agent plan ownership (source only)

- Task checkpoints persist plan ownership (`agent` or `workbench`), and compaction carries that provenance. Restoring a session with an open agent-owned plan restores the implementation obligation before the next inference call, so a resumed Auto task continues instead of finishing as an ordinary chat response. Explicit Discuss/Plan intents override this behavior.
- Added queued checkpoint and engine regressions. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`. No tests, typecheck, UI, package, or live model check ran.
- Plan continuation treats only explicit terminal statuses as closed. Unknown statuses such as `planned` remain open and actionable; `deferred` is treated as closed. A regression for unknown statuses is queued, not run. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
- Resume recovery now also keeps open Workbench implementation checklists active when their saved task mode is `implement`, in addition to agent-owned plans. The regression is queued. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
- Continuation now compares stable plan fields and acceptance criteria: identical replans do not count as progress, while added items, status movement, and criteria changes do. This preserves expandable planning without a fixed iteration cap. Regression coverage is queued. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
# 2026-11-01 — Distinguish Auto plan-only from the planning phase (source only)

- Added a structured `plan_only` mode for an explicit no-implementation request in Automatic intent. The ordinary `plan` mode is a phase; nonempty agent plans remain implementation obligations until project work is observed, even if the model marks their checklist complete. Plan provenance and mode are saved to the session checkpoint and activity trace; the renderer labels `plan_only` clearly.
- The settings explanation now describes the distinction. Engine and sidecar regressions are authored and queued. No tests, typecheck, UI, package, or model acceptance has run. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
- Moved a pair of checkpoint content assertions back into the checkpoint-continuity test that owns them. Test suite remains queued; current paired engine revision is `e6dea3fb31d1699d9cea214357797440a5036d02`.
# 2026-11-01 — Persist implementation obligation (source only)

- The durable task checkpoint now records whether implementation has been requested. Automatic continuations retain that obligation through checkpoint/compaction/session resume and user follow-ups; an explicit Discuss or Plan follow-up clears it. The engine progress signature tracks the field so reset/reclassification is observable.
- Added queued regressions for persistence, recovery, read-only reset, and continuation state. No tests, typecheck, visual app, package, or live model run occurred. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
- Recovery now migrates older plan provenance from explicit per-item source markers, then from the saved structured `plan`/`implement` mode when markers are absent. The durable implementation obligation remains sticky for Auto and is reset only by an explicit read-only user intent. Migration regressions are queued. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
- Auto-mode structured `plan_only` can clear a prior sticky implementation obligation only before a write attempt, observed change, or command effect; after effects start, the task must inspect and report them. Added a queued regression for a plan-only follow-up before any effects. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
- Plan status interpretation is now shared by continuation, Workbench checklist advancement, and the checkpoint next action, so an unfamiliar open status is resumable after compaction/session recovery. Regression coverage is queued and unrun. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
- Continuation progress now also includes newly saved agent decisions, so a durable design choice can carry the task forward after compaction; duplicate decisions are deduplicated. Regression is queued. Current paired engine revision: `e6dea3fb31d1699d9cea214357797440a5036d02`.
# 2026-11-01 — Live packaged request exposed Ollama system-message ordering

- Opened one packaged `Local Agent Workbench` instance and selected an empty disposable workspace: `C:\Users\kayde\AppData\Local\Temp\LocalAgentWorkbench-Acceptance-20261101` (0 files, 0 saved sessions). The selected model was `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`; selected context/output were 65,536/8,192, reasoning remained model default, and Small-model guidance was off.
- Submitted a short hello prompt. The app recorded requested settings and an estimated 15,628 input tokens, then reported `REQUEST FAILED` with HTTP 500 after 14.73 seconds. No model response token or project mutation was produced. The Ollama server log stated `System message must be at the beginning`.
- The failed request loaded the selected runner at context 65,536; Ollama `/api/ps` reported 81% CPU / 19% GPU allocation and 6.99 GB runner RAM at the observed snapshot. This is one instantaneous shared-runtime reading, not a throughput benchmark or a quality result. The fixture remains unchanged.
- Root cause was a second system-role message introduced by checkpoint compaction. Engine fix `488a2b38495306c7594e55690ebd625bf7bcb6f6` merges provider-bound system instructions and checkpoint into one leading system message. A regression first failed with two system messages, then passed; the complete engine suite passed **251 tests**. App pin is updated to this commit; rebuilding and repeating visible acceptance are pending.

## 2026-11-01 — Flint continuation and live-state observation

- Continued the same disposable-project acceptance with `hf.co/unsloth/flint-GGUF:UD-IQ2_XXS`, context **65,536**, output **8,192**, and model-default reasoning. The request manifest records 26,084 estimated input tokens; no context/output/reasoning setting was changed.
- The request was not idle: the `llama-server.exe` process for the selected Ollama runner used 28.1 CPU-seconds over a 10-second sample, with about 13.3 GB process RAM. `ollama ps` reported 90% CPU / 10% GPU placement; system GPU utilization was 100%, but device-wide GPU load is not model-specific. The event journal then recorded request 4's response headers, a reasoning phase, completed provider stream, and an `update_plan` operation starting. No website files had yet been written at the latest checkpoint.
- A fresh accessibility snapshot of the visible packaged app still showed “WAITING FOR FIRST TOKEN,” the older Model Request 2 row, an empty plan, and an older estimated-input value while the saved session had advanced through request 4 and `update_plan`. This is a live-rendering/event-delivery discrepancy to root-cause; do not use that stale panel as proof the model stopped or as proof the new activity rendered.
- Added a regression for prompt provenance when the checkpoint is embedded inside merged system guidance. It failed before the fix and passed after. Targeted result: `python -m pytest tests/test_prompt_manifest.py -q` — **4 passed**. Engine commit: `48403b4822f5218c3e3a168b72854ee470029601`. Full suite, package rebuild, and visible UI re-acceptance remain pending.

## 2026-11-01 live Flint acceptance follow-up and plan result fidelity

- The earlier UI mismatch was transient, not a confirmed persistent event-delivery failure. A later visible screenshot showed the current six-item plan, current model-request activity, and the live reasoning disclosure. The source change below is a recovery path for missed events; it must still be packaged and visibly re-tested before being called fixed.
- The same active task remains in `C:\Users\kayde\AppData\Local\Temp\LocalAgentWorkbench-Acceptance-20261101`, session `0AF6F3ED`, using `hf.co/unsloth/flint-GGUF:UD-IQ2_XXS`, 65,536 context, 8,192 output, and model-default reasoning. At the latest checkpoint, Model request 7 completed (11,754 prompt tokens, 38 generated tokens); request 8 had response headers and 1,857 characters of saved partial reasoning. The runner remained active and responsive. The plan still had six items and no website files had been written. This is continued planning/reasoning activity, not evidence of a stalled runtime; implementation acceptance is still incomplete.
- The model repeatedly called `update_plan`; inspection found that its tool result was only the generic `Plan updated.` message, leaving the model unable to verify the saved checklist from the result. Engine commit `bad701cbc49b4d6fdeaa09174c19c77746d3e766` now returns the complete current plan, task mode, acceptance criteria, and durable decisions after each update. Planning and plan size remain expandable with no pass cap. Focused engine test suites: 48 passed. The pin is updated in `core-revision.txt`; the currently running packaged build still contains its prior engine until the acceptance run finishes and a new package can be safely built.
- App source now provides an exact-session/workspace live snapshot fallback for plan, activity, live assistant buffers, and terminal transcript recovery. Revision-based reconciliation avoids duplicating late text events; terminal mirror conflicts stay explicit. Sidecar tests: 4 passed; renderer tests: 22 passed; `npm run typecheck` passed. A package rebuild and visible re-test remain pending, so this is source-tested only.

## 2026-11-01 — Full source suites and live acceptance continuation

- Renderer reconciliation now also ignores stale phase revision events from an older turn in the same session. The focused renderer suite and full renderer suite pass; the full run reported **15 Vitest files / 88 tests passed**. `npm run typecheck` passes.
- Sidecar Python tests pass **96 tests** with the pinned engine and sidecar paths configured. One existing Starlette `PendingDeprecationWarning` remains. A first combined invocation incorrectly forwarded Vitest's `--run` option to pytest and lacked the local engine path; that invocation failed during collection, then the corrected test command passed.
- The app CI and Windows release workflows now check out engine `bad701cbc49b4d6fdeaa09174c19c77746d3e766`, matching `core-revision.txt`; this prevents CI/package validation from silently testing an older engine than the source pin.
- Visible acceptance is still running in the single packaged window, session `0AF6F3ED`, using Flint UD-IQ2_XXS at 65,536 context / 8,192 output / model-default reasoning. The saved run remains active and is emitting substantial reasoning. It has not yet created project files or completed the live implementation flow. Do not call the task complete or rebuild over the active packaged app.

## 2026-11-01 — Full suite rerun and Flint model constraints

- App source verification: `npm test` passed **15 Vitest files / 88 tests** and **96 sidecar Python tests** with the exact engine path supplied; `npm run typecheck` passed. The app's CI and release workflows now use the same engine pin as `core-revision.txt`.
- Engine verification: the first full run had one response-header cancellation timeout under the active model load. The specific test, the full cancellation module, and a complete rerun passed; final full-suite result is **252 passed** in 47.19 seconds. The first transient is retained as an observed flake, not represented as a persistent product failure.
- The [official Unsloth Flint GGUF model card](https://huggingface.co/unsloth/flint-GGUF/blob/main/README.md) describes Flint as a roughly 40B-parameter MoE with about 2.5B active parameters per token, supporting reasoning and multi-turn tool use. It recommends at least 32,768 output tokens for hard problems, including reasoning, and says prompt and output share the context window. The active acceptance remains at the user-selected 65,536 context / 8,192 output with model-default reasoning; no setting was changed. The upstream recommendation makes output-budget pressure a plausible factor, but it does not prove the cause of this run's long reasoning.
- Latest live snapshot: the exact Flint request remains active and has produced 14,998 characters of reasoning that include drafted HTML structure; `partial_content` remains empty and no file operation has started. The saved session and visible Workbench both still show the same turn. Keep waiting for its own tool actions; do not replace or restart it.


## 2026-11-01 reasoning-plus-tool stream regression and engine pin

- Engine commit `605dc14935f3e1125a7a9397a34edbdd1437d748` adds a regression proving a default-reasoning Ollama response can stream `thinking` and then return a structured `write_file` tool call in the same response. Focused streaming suite: **7 passed**; full engine suite: **253 passed**, with one existing Starlette deprecation warning.
- `core-revision.txt`, CI, and the Windows release workflow now pin that exact engine commit. The already-running packaged acceptance still uses its previously bundled engine; do not rebuild or replace it before the active Flint task ends.

## 2026-11-01 Flint live placement evidence

- During the same active visible acceptance (`hf.co/unsloth/flint-GGUF:UD-IQ2_XXS`, Ollama 0.40.13, 65,536 context / 8,192 output / model-default reasoning), `ollama ps` reported `90% CPU / 10% GPU`. The runner log for this exact model load says `offloaded 28/50 layers to GPU`, with a 857.30 MiB CUDA model buffer, 10,443.81 MiB CUDA-host model buffer, and CUDA KV buffers of 896 MiB plus 50 MiB. This confirms partial GPU offload, not CPU-only inference.
- The app showed about 26–30% device GPU utilization, 3,436/4,096 MiB VRAM, roughly 91% total system CPU, and about 443–554% summed Ollama worker CPU during sampled moments. These are point-in-time/device-wide versus process readings, not a benchmark. Ollama documents `ollama ps` CPU/GPU as model memory placement; it must not be described as utilization. A controlled speed/quality/offload comparison remains queued until the live acceptance finishes.
- The current estimate has ranged around 4.9 tokens/s in the visible UI; the task remains active and provider-final token/s is not yet available. The user reports Flint is faster on this PC than the 9B model; this run is consistent with that observation but is not yet a matched benchmark. The project folder still has no website source files, and the live task has not finished.

## 2026-11-01 user-directed Flint run cancellation and implementation pacing

- The user clarified they intentionally cancelled the visible Flint request while taking a game break and asked development to continue in the background. The Workbench window and Ollama runner were left open; no inference was restarted. The journal records request 8 as `cancelled_during_request`, preserves the partial assistant reasoning in the transcript, and marks the turn cancelled. The disposable project contains no website files and the run never reached a write approval. This is an interrupted acceptance, not an evaluation failure.
- User feedback asks the agent to spend roughly 10–20% less effort repeating/revising plans and move sooner into implementation. Engine prompt guidance now treats this as a pacing preference: establish a sufficient plan, use authoritative saved plan/checkpoint state, begin structured implementation once safe, then extend the plan when evidence warrants it. No fixed planning-pass, scope, context, output, tool-call, iteration, or runtime cap is introduced. The new prompt regression is queued for final tests and has not yet run.
- Engine worktree has uncommitted pacing guidance and its regression; update the app pin and both workflow pins only after that engine revision is committed. The active packaged app still contains the previous source and has not been rebuilt.
- Engine pacing commit `5ba258afcfcaac13efc2a56d3eff9b7bd5ca5a10` is now the exact app, CI, and Windows release workflow pin. The packaged app running during the cancelled acceptance still contains the earlier engine; rebuild only after queued tests are run and the active acceptance disposition is decided.

## 2026-11-01 action handoff and provider finish-reason source changes

- The user clarified the key issue: a coding model must carry its plan and reasoning into real project operations, rather than spending the task on planning. The engine's plan tool now returns `plan_changed`, its next open checklist action, and mode/access-aware structured-tool guidance. Repeated identical plans point to the same next step; no planning, tool-call, scope, context/output, or runtime cap was added. Coverage is authored and awaiting the final test batch.
- Added provider finish-reason capture for Ollama and llama.cpp, storage through sidecar journal/snapshot recovery, and an Activity Trace display. This will show provider-reported reasons such as `length` where available, helping diagnose when generated reasoning uses the selected output budget. Token settings remain unchanged. Engine/sidecar/renderer regression cases are authored but unrun.
- The cancelled Flint acceptance preserved its 23,477-character partial reasoning message but had no tool calls, final answer, approval request, or project write. Because the user cancelled while taking a break, it is recorded as interrupted rather than a completed-quality verdict. Current UI acceptance still must be rerun with the new engine pin after the user resumes model work and queued tests pass.
- The app source pin, CI checkout, and Windows release workflow now all point to engine commit `3d52c35c52ff7071e70d9b4ebb86211c12b7f415`; this source pair has not yet passed the queued app/engine regression suites or a rebuilt visible acceptance.

## 2026-11-01 explicit next-action handoff

- The engine continuation now supplies the saved next open plan item to the model and asks it to execute that step with a suitable structured tool, avoiding generic “continue implementation” guidance. Shared prompt guidance also asks for the first useful operation after adequate scoping. It does not alter reasoning, context/output, approval, or runtime settings.
- The app pin now targets engine `ff09ab994e3d4b154f21c65fd297bb59ebdf71ee` so the next sidecar build includes this source. New mocked regressions are queued and have not been run. No package, app UI, or model request was started.

## 2026-11-02 Automatic plan-to-build transition

- The source audit confirmed that `task_mode=plan` in Automatic intent did not remove write tools, but the saved mode could remain “plan” until the model changed it. The engine now promotes a non-empty agent-authored plan to `implement` in the same state update. This makes automatic plan-to-build transition host-owned while leaving the plan expandable and honoring workspace access/approval. Explicit Plan-only remains read-only.
- Engine commit `04272e7a997e8e247e639c25a0228ac0a604f28f` is now pinned for the next sidecar build. The regression is queued and unrun. The current running package was not rebuilt and no model task was started.

## 2026-11-02 Same-chat steering research

- Source inspection confirmed that the composer remains editable during generation but Enter saves only a queued follow-up; it cannot inject direction into the active task. No implementation change or live run was made in this research step.
- OpenCode's v2 session design and Codex's Queue/Steer guidance both distinguish steering the active task from starting queued work. The Workbench requirement is to deliver a durable steering message at a safe boundary while preserving the same task/session/project/checkpoint; a pending steer must remain visible if a run ends before delivery. The Codex Responses API has separate steering limitations, so its hosted transport constraints must not be assumed for the local engine.
- The detailed source comparison, confirmed gaps, and ordered acceptance criteria are recorded in `CORE_HARNESS_READINESS.md` and backlog item B-019. No test, package, app launch, model request, or token/reasoning setting change occurred.

## 2026-11-02 Same-task steering source implementation

- Engine commit `39ff5495256e12f5f7e43232f269e5ace8d1ff88` adds an idempotent task-checkpoint update record, applies steering only at complete request/tool boundaries, continues the same task after a steer arrives during final prose, and strips internal steering metadata from provider payloads. Engine regression tests were authored but not run.
- The app sidecar accepts steering only for the active captured session and workspace, persists it before acknowledgment, applies it through the engine boundary callback, and retains undelivered text for explicit follow-up after termination. The renderer now uses Enter for same-task steering, exposes a separate Queue next button, displays delivery state, and restores pending updates without assigning a new task/turn identity. App/sidecar/renderer tests are authored but not run.
- `core-revision.txt`, CI, and Windows release workflow all pin the same engine commit. No tests, typecheck, package build, app launch, or model request were run; existing open app/model processes were not touched.

## 2026-11-02 Reasoning/action-cycle visibility and continuation prompt hygiene

- App commit `978832f` adds a compact request row in chat/activity showing request index and provider-reported total duration, generated-token count, and finish reason when available. `npx vitest run tests/activity.test.ts -t "summarizes each completed model request"` passed: 1 test, 18 skipped. No broad renderer suite, typecheck, build, app launch, or model request was run.
- Engine commit `75ca8bddee5e10e9ac4c801d5a8b1a580996f13c` replaces the previous host continuation instruction with the latest one instead of permanently appending each continuation to the system prompt. A focused unit test and the existing plan-to-implementation integration test passed: 2 passed, 49 deselected. Full engine tests and packaged acceptance remain queued.
- Updated `core-revision.txt` to pin the paired app to `75ca8bddee5e10e9ac4c801d5a8b1a580996f13c`. No inference settings changed and the canceled Flint task was not resumed.

## 2026-11-02 Automatic no-action outcome and chat intent control

- Engine commit `e487e8dd10e75de290a0042213e6a6b3a88d0f3c` records `no_action` when Automatic mode receives no structured plan declaration or project operation and no implementation obligation exists; explicit discussion and plan outcomes remain distinct. The focused pytest passed: 1 passed, 22 deselected.
- The app pins that exact engine revision. The composer now exposes persisted Auto/Discuss/Plan/Implement intent choices; selection is disabled during a run, preserving captured run settings. A `no_action` result explains how to submit an explicit implementation follow-up without bypassing access or approval. `npm run typecheck` passed. `git diff --check` passed in both repositories.
- No full suite, package/build, visible UI acceptance, model request, model load/unload, or runtime setting change occurred. The broader verification batch remains queued.
- A follow-up interaction was added: “Continue this request as Implement” sets the explicit intent and prefills the previous user request in the same session; it does not submit or bypass approval. The renderer typecheck passed again after this addition.
- Engine commit `4db01aa6d6bb4751b1edfc50015469c7682b96bd` adds a focused agent-loop regression: Auto prose with no structured action persists `no_action` in both the completion event and active task checkpoint; `python -m pytest tests/test_operation_stream.py -q -k automatic_no_action_is_persisted_as_observed_outcome` passed (1 passed, 28 deselected). The app pin now targets this test-bearing engine revision.

## 2026-11-02 Terminal chat summary and OpenCode V1/V2 tool audit

- The chat transcript now renders a labeled Workbench status entry for persisted terminal outcomes where no normal completion can be shown: missing final answer, implementation incomplete, failed, interrupted, canceled, or stopped-after-operation. This is derived from the recovered `workflowOutcome`; it does not fabricate a model message or assert that unobserved work completed. `tests/workflow-outcome.test.ts` passed (3 tests); `npm run typecheck` passed. Full renderer suite, packaged display, and session-reopen visual acceptance remain queued.
- `CORE_HARNESS_READINESS.md` now lists stable OpenCode V1 tools and separate V2 development tools against Workbench equivalents and gaps. The audit records V2 as non-stable reference, and highlights Code Mode batching, child sessions, browser and worktree operations as potential parity targets; no V2 feature was assumed stable or implemented from the documentation alone.

### 2026-11-02 continuation recovery source check

App commit `2437473` adds a same-chat continuation prefill after terminal failures/cancellation. It preserves the previous goal and requires workspace/checkpoint inspection in the next turn before retrying uncertain effects. Focused tests: 4 passed; TypeScript typecheck passed. Not yet package-verified. At that point, explicit external folder scopes and OS containment were open; the external-folder scope was later implemented and project-bound as recorded below. Approved PowerShell/commands remain host-user processes.

### Engine retry-loop regression

Engine focused test verifies a failed file read is shown to the model, a corrected same-task retry succeeds, and the final answer is returned: **1 passed, 29 deselected**. Engine commit `2c3acd3f4c8cdb9331d3a4d4fdf7a4dfa1c84b9b`; paired app pin synchronized. This does not replay side effects automatically.

### 2026-11-02 scoped external-folder access checks

Engine permission/tool tests: **48 passed** across `tests/test_permission_policy.py` and `tests/test_tools.py`. Renderer TypeScript typecheck passed; focused permission editor tests: **2 passed**. User-picked external folder rules default to Ask; allow/deny scopes persist, deny takes precedence, unavailable roots and symlinks fail closed, and copy mode blocks outside writes. The full app/worker/engine suites and packaged app interaction are still pending; no model or package run occurred.

Paired engine external-folder implementation committed as `0c51f9eebc80c51aec8405ae81326779e450af59`; app pin synchronized. Renderer typecheck and 2 focused permission tests passed again after synchronization. Packaged UI and full suite acceptance remain open.

- Sidecar integration checks now include persisted `external_directory` Ask rules and confirm the same scope is captured into a run's engine arguments and durable run settings. Focused worker tests: **2 passed** with `LOCAL_AGENT_CORE_PATH` set to the paired engine worktree. This verifies protocol/persistence wiring only; packaged permission prompts remain unverified.

External folder acceptance now includes recursive list/search/read and direct write/edit/append under Edit access. Focused engine suites: **48 passed**. Engine commit `a9c73c6d296ddc91c00a2d8c69ddc02ae8e3cc67`; app pin synchronized. Copy mode outside writes remain blocked pending staging support.

### 2026-11-02 external-folder project isolation follow-up

External-folder permission rules now carry their owning workspace identity. Engine commit `8f2afe62671af4235b2150ab4f80a9c2af8828a7` filters those rules inside `AgentEngine`; the sidecar captures matching grants against the selected source project so disposable-copy runs retain the source identity. Legacy app-global external-folder grants are disabled with a repair warning while preserving the stored file until the user saves rules. Verification: engine permission/tool tests **50 passed**; sidecar worker tests **65 passed** with `LOCAL_AGENT_CORE_PATH` set to the paired engine checkout, including a Copy-mode source-identity regression; `npm run typecheck` passed. Full suites, packaged UI, and visible multi-project acceptance remain pending. No model was loaded and no runtime inference settings were changed.
### 2026-11-02 plan-only loop handling across access modes

Engine commit `b1981571c9a7680646cb1cef587fe4c384fae869` generalizes plan-only loop protection across implementation, explicit planning, read-only mode, and denied project actions. The engine permits one targeted continuation after a repeated plan state, then ends with an explicit workflow outcome instead of exhausting the run or continuing to re-plan indefinitely. Denied/read-only implementation is marked blocked without bypassing permissions; repeated implementation planning is incomplete; planning without a final reply is surfaced as a missing-response error. Real non-plan tool activity resets the guard. Focused engine tests: 79 passed across operation streaming, context, context budgeting, and task checkpoints. The app pins this engine revision; focused renderer tests confirm the blocked chat status preserves the access boundary and offers same-checkpoint continuation (6 passed). No full suite, package, app launch, model request, or inference-setting change occurred. Full acceptance remains open.

### 2026-11-02 reasoning mode and token budget controls

Engine commit `9f0af2756f08d46c3246d99ee76c6da10c1a043b` adds a separate optional `thinking_budget_tokens` field to llama.cpp requests. The app persists the exact integer or unlimited choice and displays it as requested, without changing `max_tokens`; it does not claim the server/model enforced it. The model-specific reasoning selector still sends only advertised modes/levels. Ollama gets no budget field because its documented API exposes `think` mode/levels but not a separate token budget. Focused engine tests: 90 passed; app model/workflow renderer tests: 15 passed; sidecar settings/provider-request tests: 2 passed; `npm run typecheck` passed. No package, app launch, model request, or reasoning/context/output setting was applied to a live model. Visible UI and llama.cpp runtime enforcement remain pending.
### 2026-11-02 llama.cpp reasoning capability discovery

Engine commit `88f158e48d85e5647f9431590b9c6a2b14e84786` reads reasoning-effort levels from the loaded server's `chat_template_caps`; absent levels remain unknown, and no default or generic choices are invented. The Electron sidecar now reports unknown for unloaded GGUFs and refreshes capability metadata after an owned llama.cpp load. Focused runtime tests: **13 passed**; full sidecar worker suite: **66 passed**; app `npm run typecheck` passed. Full renderer suite, package, visible settings acceptance, model-template support, and budget enforcement remain open; no model was loaded and no inference settings were changed.

### 2026-11-02 template-supported reasoning Off control

App commit `026265ce442667fccb5d84b7b482998016a85483` pins engine `ab2d68259309796a60d19a9b5ce4e420b37e4573`, which includes an explicit Off choice only when llama.cpp reports template reasoning-effort levels and verifies that Off launches with `--reasoning off`. The app keeps the exact levels and Off distinct from the numeric token budget; unreported templates remain unknown. The llama.cpp runtime suite passes (14); sidecar unloaded/loaded capability regressions pass (2). Full suites, package, visible UI, and live model behavior remain pending.
### 2026-11-02 preserve plan next action through tool results

Engine commit `878ff68eba9720186945fb4ed2b728ee16ae3771` keeps an open plan's concrete next step in the compaction checkpoint after tool operations. The previous implementation replaced it with a generic review reminder, which could misdirect model continuation. Unplanned tasks still get a result-review fallback. Focused task-checkpoint suite: **25 passed**. App pin synchronized; complete engine/renderer suites, packaging, and long-run model acceptance remain pending.

### 2026-11-02 compacted plan keeps the next open step

Engine commit `dcdf7fc2c3b1ca61bfd44cb2449e4e77b7e69c59` changes budgeted plan compaction to retain the first open action in plan order rather than the last. The full saved plan remains unchanged and recoverable. The checkpoint suite passes: **25 passed**, including a regression that exposed the previous wrong-step behavior. App pin synchronized; full suites, package, and live long-run acceptance remain open.

App commit `e399d86c71dcc64a5fc6bac58055dd5bc97a591d` records and pins that exact engine revision. This documentation synchronization does not add verification: packaged, visible, full-suite, and live-model acceptance remain pending.

Focused engine verification was then run against that pin: `tests/test_operation_stream.py` plus `tests/test_task_checkpoint.py` passed **61 tests**. This adds source-level continuation/checkpoint evidence only; it does not close the queued full-suite, sidecar integration, package, visible UI, or extended model-run gates.

Focused renderer checks for resumed Markdown/code formatting, terminal recovery actions, and reasoning/token-budget controls also passed: `tests/transcript-rendering.test.tsx`, `tests/workflow-outcome.test.ts`, and `tests/model-controls.test.ts` — **20 tests**. Server/runtime enforcement and packaged session-reopen rendering remain unverified.

Additional focused checks passed on the same paired source: engine `tests/test_llama_cpp_runtime.py`, `tests/test_operation_stream.py`, and `tests/test_task_checkpoint.py` — **75 passed**; sidecar settings/request-provenance checks — **2 passed** with `LOCAL_AGENT_CORE_PATH` set to the pinned engine; renderer `tests/activity.test.ts` and `tests/run-sheet-layout.test.ts` — **23 passed**. The focused checks are now 120 passing cases across engine, sidecar, and renderer paths; this is not the full suite or a packaged app acceptance.

The reasoning-control design is now recorded in `CORE_HARNESS_READINESS.md`: preserve each model's advertised effort choices and default; keep llama.cpp's optional token budget unlimited unless the user selects a value and label it as requested, not guaranteed; do not invent an Ollama token-budget field. Improve action cadence through the existing multi-request tool cycle and safe-boundary same-task steering, without cutting off an active stream or adding arbitrary time/turn limits.

Focused sidecar checks for cancel acknowledgment and durable tool-call progress passed (**2 passed**). Together, the targeted checks recorded in this section total **122 passed** across engine, sidecar, and renderer layers. The cancellation chooser's behavior in a running packaged window is still an acceptance gate, not established by these unit tests.

Same-task steering state and transcript follow behavior received another focused pass: renderer `tests/run-state.test.ts` and `tests/transcript-follow.test.ts` — **22 passed**; paired sidecar steering acceptance test — **1 passed**. Focused saved-session approval checks passed as well: sidecar **3 passed** for grant persistence, fail-closed mirror failure, and revocation; renderer `tests/permission-rules.test.ts` — **2 passed**. Focused persistence recovery tests then passed **23/23**. Across the individually listed focused suites, **178 tests passed**; visible composer and non-dismissible approval behavior in a packaged long inference remain unverified.

### 2026-11-02 Home hero coordinate privacy correction

- A fixed geographic coordinate string was found in the Home hero. It was introduced in the initial scaffold commit `65b012086863252fce0d7df37af2bbb6b8ae2dda`; that commit and the beta.3 tag contain it. The current public `origin/main` also contains that commit. The scaffold commit has no rationale for choosing the location. Source inspection found no geolocation API or runtime location lookup; the value was literal UI text.
- Removed the coordinate text and its CSS rule from current source. Removed the historical Home-orbit screenshot and README link because the image itself contained the text. Added `tests/location-privacy.test.ts`, which fails if a coordinate or geolocation access is added to the renderer or the withdrawn screenshot is reintroduced; both cases failed before cleanup and pass now (2 tests).
- Public-history cleanup completed 2026-11-02: all published refs (main and beta.2/beta.3 tags) were rewritten while preserving unrelated commits; the coordinate-bearing screenshot path was removed from history. Anonymous searches across rewritten refs found no coordinate strings or screenshot path. The beta.3 release was moved to draft; its old ZIP asset returns HTTP 404 anonymously. Its installer and update packages remain attached to the private draft for a clean replacement after release gates. Already-downloaded copies cannot be recalled, and GitHub or third-party caches may retain copies outside the public refs.

\r\n

### 2026-11-02 public history scrub verification

The remote `main` and published beta tags were force-updated to rewritten commit IDs. Rewritten history preserves the complete commit sequence except for the withdrawn screenshot path and redacted location text. The beta.3 release was drafted; a HEAD request to the old public ZIP URL returned HTTP 404. The focused privacy regression suite passes 2 tests. Other local-only development branches remain private and are also scrubbed.


### 2026-11-02 build-source pinning correction

A source audit found both GitHub workflows checking out an old fixed engine SHA instead of the app's `core-revision.txt`, and the local PyInstaller spec contained developer-worktree absolute paths. The app now reads the same full engine pin for CI and release checkouts. The local sidecar build rejects missing, dirty, nested, or mismatched engine checkouts before packaging; its paths are derived from the app location or `LOCAL_AGENT_CORE_PATH`. README setup now creates a detached worktree at the selected pin without moving the engine's main branch.

Focused `tests/test_build_config.py` passed **7 tests**; Python compilation, PowerShell parsing, and `git diff --check` passed. The complete app/engine suites and an actual packaged build remain queued. The Desktop engine checkout is currently at a different revision than this app's pin, so the new guard correctly prevents using it until the documented pinned worktree is selected. The pinned commit is now reachable from the public engine repository through branch `workbench/app-pair-dcdf7fc`; public engine `main` was not moved.


### Live-model acceptance constraint

Per the user’s latest instruction, the eventual live model workflow check must use Flint only. Resolve the exact installed tag at test time and preserve any model already active; do not substitute another model. No model was started or switched during this source-only development pass.

### 2026-11-02 source-sidecar revision guard

Source-mode sidecar startup now verifies the configured engine checkout against the desktop app's `core-revision.txt` before importing engine modules. On mismatch, it emits a structured startup error immediately; Electron surfaces that reason instead of waiting for the generic 15-second startup timeout. Packaged workers continue to rely on the build-time pin check. Regression test verified a mismatched fixture is rejected before its `desktop_engine` module can execute. `tests/test_build_config.py`: **8 passed**; `npm run typecheck`, Python compilation, and `git diff --check` passed. Full suites, package, visible acceptance, and live Flint run remain queued.

### 2026-11-02 output-limit continuation

Ollama's streamed chat response includes a `done_reason`; the engine retained it in telemetry but previously did not use an output-limit finish to continue the same task. When a no-tool response ends with `length` (or the equivalent output-limit reason), the engine now continues using the same captured session, plan, checkpoint, completed tool results, and selected settings. The first continuation does not reset the task or replay operations. If the provider repeats the exact same truncated content, the run ends with the new recoverable `response_truncated` outcome and preserves implementation/verification evidence. The renderer explains the partial result and offers same-chat checkpoint continuation. No context, output, reasoning, or runtime setting was changed; no model was started.

Engine `tests/test_operation_stream.py`: **39 passed**. Renderer `tests/workflow-outcome.test.ts`: **7 passed**. App `tests/test_build_config.py`: **8 passed**; TypeScript typecheck and paired engine-pin verification passed. Full suites, package, visible chat flow, long-run behavior, and live Flint acceptance remain queued. The implementation follows Ollama's documented `done_reason` response field and the same-task recovery approach; see [Ollama chat API](https://docs.ollama.com/api/chat) and [OpenCode V2 compaction](https://dev.opencode.ai/v2/docs/compaction/).

### 2026-11-02 inference response-header wait audit

Inspected `cancellable_http.py`: the 10-second bound is only for DNS/TCP/TLS connection establishment. Immediately after connection, the socket timeout is set to `None` before the request is sent, so the app does not impose a response-header, first-token, or overall inference deadline. Cancel still interrupts the request socket. A delayed fake local provider regression observes the unbounded socket while waiting for headers; `tests/test_cancel.py`: **5 passed**. The exact timeout string from the user's separate OpenCode session is not present in this workbench source, and its cause remains unverified. No live model was used and no runtime setting changed.

### 2026-11-02 partial inference recovery

A provider disconnect after sending reasoning or answer text previously raised out of `OllamaRuntime.stream` without returning those already emitted characters to the engine's saved conversation. Engine commit `6aef83a` now carries only fully received reasoning/text on the stream exception; the engine appends it to the transcript/checkpoint and flags `partial_response_saved` on the error event. Incomplete tool arguments are intentionally omitted and never executed. Red/green evidence: `tests/test_cancel.py` **7 passed**, `tests/test_cancel_interrupts_blocked_read.py` **1 passed**, and `tests/test_task_checkpoint.py tests/test_operation_stream.py` **64 passed**. Full suites, app persistence/reopen, package, visible flow, and Flint acceptance remain queued; no model or inference settings changed.

The paired app worker's existing interrupted-stream recovery path was exercised with `LOCAL_AGENT_CORE_PATH` pointing to the paired engine checkout: `tests/test_worker.py::test_incomplete_provider_stream_preserves_partial_reasoning_and_request_failure` and `test_engine_failure_is_saved_with_the_session`: **2 passed**. Without that variable, the source-mode pin guard correctly rejects the absent default sibling checkout; the isolated source workspace must use the explicit paired path.

### 2026-11-02 partial response transcript status

Engine `c10546c` marks saved provider-disconnected assistant messages with the internal `partial_response` flag. Provider serialization removes the flag; the transcript restore mapper converts it to the visible `PARTIAL · INTERRUPTED` label. Sidecar run state and journal replay preserve the partial-response indicator; error-event rendering marks live output too. The renderer transcript test passes (6), and the persistence and worker recovery tests pass (2) with the paired source paths. TypeScript typecheck passes. Re-run these against the next paired engine pin and verify in the packaged chat before calling the persisted visual state accepted.

### 2026-11-02 Windows inference cancellation correction

The delayed-response-header cancellation regression failed repeatedly on Windows: Python socket shutdown/close from a helper thread did not wake the synchronous HTTP read, and the request only exited when the test server was released. Engine `b40f082` now invokes Windows `CancelSynchronousIo` for the exact inference thread before closing the request socket. Focused verification: `tests/test_cancel.py` **8 passed**, `tests/test_cancel_interrupts_blocked_read.py` **1 passed**, including the previously failing delayed-header case. Normal response-header and token waits remain unbounded; no model or runtime setting changed. Packaged visible Cancel acceptance remains queued.

### 2026-11-02 corrected Windows inference cancellation

The prior test did not assert the request exited before the fake server was released. The corrected assertion exposed that `CancelSynchronousIo` did not reliably wake the buffered HTTP read. Engine `cef092f` replaces that read with an HTTP/1.x streaming reader that polls the socket every 250 ms for the request cancel event. This is a cancellation polling interval, not an inference deadline; response headers and model output remain unbounded. Focused engine tests passed: `tests/test_cancel.py`, `tests/test_llama_cpp_runtime.py`, and `tests/test_cancel_interrupts_blocked_read.py` — **25 passed**. A follow-up chunked-body/trailer parser case passes in `tests/test_cancel.py` (**9 passed** total). The current paired engine is `45d6291d84f61c579b25419e758d0eb3c88d935e`. Python compile and diff checks passed. App source-pin recovery tests, packaged behavior, and visible Cancel acceptance remain pending.

### 2026-11-02 current paired core verification

App `core-revision.txt` pins engine `45d6291d84f61c579b25419e758d0eb3c88d935e`. The focused engine suites `tests/test_operation_stream.py`, `tests/test_task_checkpoint.py`, `tests/test_context.py`, `tests/test_search_budget.py`, and `tests/test_tools.py` pass: **123 passed**. Cancellation/runtime suites pass: **26 passed**. App source-pin verification passed; app persistence, interrupted-stream recovery, and ordered steering worker regressions pass: **3 passed**; transcript restoration passes (**6**) and TypeScript typecheck passes. These are source-level checks only; complete suites, fault-injection, package, visible acceptance, long-run Flint behavior, and release readiness remain open.

### 2026-11-02 cancellable Windows save-lock retry

Engine `251acf4a2858f6dd79dcd3c46ba1a8a898c62c88` extends atomic replacement retry from the prior short retry burst to a 30-second filesystem-lock window with exponential backoff, and checks the request cancel event while waiting. The bound applies only to replacement of a workspace file; it does not impose a model/inference timeout. Focused tests simulate nine consecutive sharing violations before success and cancellation during the wait, confirming the prior destination remains intact and the temporary file is removed. `tests/test_operation_stream.py`: **41 passed**; Python compile and `git diff --check` passed. App source pin verification passed; paired worker regressions passed (**4**), transcript restoration passed (**6**), and TypeScript typecheck passed. Packaged, visible, full-suite and Flint live acceptance remain pending.

### 2026-11-02 mirrored session snapshot lock retry

App-side `sidecar/persistence.py::_atomic_json` also had a seven-attempt replacement retry, which was too short for transient Windows sharing locks during session snapshots. It now uses the same 30-second exponential-backoff window and avoids masking the primary failure if temporary-file cleanup fails. A mocked test holds the destination for nine replacements, then allows the new JSON snapshot to replace it and confirms no temp file remains. With `PYTHONPATH` including the app and paired engine source, `tests/test_persistence.py`: **24 passed**; Python compile and `git diff --check` passed. This source-level test is not a real antivirus/indexer lock or mirror-recovery/package acceptance.

### 2026-11-02 app-wide session library lock retry

Review found that app-wide `SessionStore.save`, separate from the project mirror writer, still used seven replacement attempts. Engine `6ef1b3f5fbd29c94fa19d263ec868208563aa4c1` now uses the 30-second exponential-backoff window and does not mask the original save failure if temp cleanup fails. A mocked nine-lock regression verifies the snapshot eventually replaces and leaves no temp file. `tests/test_sessions.py tests/test_session_validation.py tests/test_operation_stream.py`: **54 passed**; Python compile and `git diff --check` passed. The app pin and paired worker checks are being rerun; no packaged/visible mirror acceptance has been performed.
