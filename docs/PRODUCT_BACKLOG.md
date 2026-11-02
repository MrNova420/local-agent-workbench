# Product Backlog

The product target is full 1:1 user-facing feature and workflow parity with Codex and OpenCode, as tracked in [CORE_HARNESS_READINESS.md](CORE_HARNESS_READINESS.md). The authoritative cross-repository order and release state is [MASTER_ROADMAP.md](MASTER_ROADMAP.md). The current implementation sequence starts with stabilizing the core agent harness and full-project workflow; deferred parity items remain required and are not dropped scope. Existing runtime and model-support requirements remain in [MODEL_RUNTIME_EXPANSION.md](MODEL_RUNTIME_EXPANSION.md).

- **[x] Urgent privacy cleanup:** removed the static Home label and screenshot, rewrote every published Git ref while preserving the remaining history, and made the beta.3 release a draft. The old ZIP download now returns 404 anonymously. Replace the withdrawn release only after the existing release gates pass; already-downloaded copies and external caches cannot be recalled.

- **Current reasoning controls:** model-advertised thinking mode/levels remain distinct from an optional llama.cpp `thinking_budget_tokens` cap. llama.cpp levels are now discovered from the loaded template and remain unknown when the server does not report them; they are never filled from a generic list. When levels are reported, the explicit Off option is also available. The budget is unlimited by default, custom per request, saved in sessions, and does not reduce the output cap. Ollama has no documented reasoning-token budget field. Focused tests pass; visible packaged control and actual llama.cpp enforcement remain final-gate items.

- **Checkpoint continuation fix:** completed tool results no longer replace an open plan's concrete next action with a generic checkpoint reminder; compacted large plans retain the first open step instead of pointing to a later one. Focused checkpoint tests pass (25); broader continuation suites and live long-run model acceptance remain open.

- **Previous source pairing (2026-11-02):** app `core-revision.txt` advanced from engine `b1981571c9a7680646cb1cef587fe4c384fae869` to add the reasoning budget summarized above. The plan-only loop correction remains in the current engine pin. Focused loop tests passed (79) and focused terminal-status tests passed (6); the current source pairing has separate tests and evidence recorded above. Full harness, packaged UI, long-run model, and release verification remain open.

## Current evidence and this release batch

- **Latest continuity and productivity stabilization:** the current source continues provider responses ended at the selected output-token limit without changing it; identical repeated truncation is surfaced as a recoverable incomplete response while preserving prior completed operations. The audited Ollama path has no response-header/read deadline after connection, and cancellation interrupts the wait. Focused operation-stream tests pass (39), cancellation/header tests (5), renderer workflow-outcome tests (7), app typecheck and source-pin verification pass. The app now pins engine `613bca01a4054c52548ab1071dbe9ee694c3177b`; full suites, package, visible workflow, Flint live acceptance, and release remain unverified. Earlier checkpoint compaction and plan-only loop evidence is recorded in the dated roadmap entries below.
- The user reports a successful simple website project task completed in roughly 2–3 hours on their PC. This validates one real long-running project workflow; it does not establish speed, broad reliability, code quality, or release readiness. See `ACCEPTANCE_LOG.md`.
- **Release state after privacy correction:** beta.3 is draft-only; its former public ZIP URL returns HTTP 404. Beta.2 is now the latest public release. Beta.3 local build evidence remains historical, but the package was not visibly accepted; rebuild and re-publish only after full packaged, updater, restart, and data-recovery gates pass.
- Documentation/planning commits do not bump the app version or create tags. Future distributable releases use new increasing beta SemVer tags only after final verification; tags trigger public release automation. See `RELEASE_RUNBOOK.md` for the paired engine pin, updater-compatible GitHub release flags, and complete Squirrel asset set.
- The README now contains three relevant historical Workbench screenshots; each is labeled historical. Current release-build Home/chat/worksheet captures remain a follow-up because the user-specific Home contains private workspace paths.
- Keep the user's context/output/reasoning values unchanged. The next core-development batch remains isolated from the published beta.
- The active unpublished session-continuity source batch adds rolling task checkpoints, append-only mirrored run journals, coalesced full snapshots, bounded replace retry, durable per-turn provider usage, cached-token forwarding, and the missing Plan-panel binding. These changes are not tested, typechecked, packaged, or visibly accepted yet. The detailed verification queue is in [SESSION_CONTINUITY_IMPLEMENTATION.md](SESSION_CONTINUITY_IMPLEMENTATION.md).
- The current unpublished source also includes Workbench-owned skill switches/sources, durable session run settings, evidence-based terminal outcomes, explicit task intent with a host-generated initial checklist, durable per-request prompt provenance, and agent-defined task acceptance criteria that survive compaction and session restore. Terminal verification records actual project-change, post-change-inspection, and approved-command evidence. Implementation with neither a structured change nor a command side effect is incomplete; command-only implementation remains unverified because its file effects cannot be attributed to a structured write. Commands stopped or timed out after launch are marked uncertain because they may have left partial files. Prompt records show actual source paths, skill/tool inclusion, and estimates without duplicating prompt text. These are not promoted to the public beta and are queued for full cross-repository verification.
- The active sidecar recovery follow-up tracks concurrent operations by operation ID in both live snapshots and journal replay, marks every in-flight operation uncertain after interruption, and presents/sends the complete set during recovery. This closes a source-level state mismatch introduced by safe parallel reads; its regressions remain queued and unrun.
- The chat follow-scroll preference is synchronized immediately with user scrolling so live activity refreshes should not reset the viewport due to a stale state update. Visible acceptance remains queued.
- The stable OpenCode V1 and development-only V2 built-in tool surfaces have now been audited in `CORE_HARNESS_READINESS.md`. Key still-open productivity parity: first-party web/search/browser, experimental LSP, regex search, media attachments, durable background-process reattachment, custom tool/plugin lifecycle, child agents, Code Mode-style tool composition, and session/worktree lifecycle operations. V2 is a design reference only until released and small-model costs are measured.

## Queued for review and implementation

### B-019: Same-chat steering, queue-next, and first-operation progress

**Priority:** Core harness blocker. Same-chat steering is implemented in source and committed in engine `39ff549` and app `d94f52a`; first structured-operation timing is committed in app `1cab384`. Regression tests and packaged acceptance remain queued. A new message continues the same chat/task and preserves its plan, checkpoint, project, completed operations, and approval state. The sidecar accepts and mirrors the update during an active run; the engine applies it before the next provider request, or after a final-prose response before it marks the task complete. A currently streaming inference response or already-dispatched tool call is allowed to finish, so steering cannot rewrite generated tokens, mutate tool arguments, skip approval, or replay completed work.

- Default a prompt submitted during a run to **Steer this task**. Persist it immediately, deliver it at the next safe boundary after the current inference response or active tool completes, and incorporate it into the existing task without starting a new task ID or replaying completed actions.
- Keep **Queue next task** as a separate explicit choice. Do not silently turn steering into cancellation or task restart.
- Display durable accepted/waiting/delivered/error status. If the current run completes, is cancelled, or crashes before delivery, preserve the message and ask before applying it later; never silently drop or auto-duplicate it.
- Steering changes task direction but grants no approval. Existing per-action, per-task, per-session, and persistent permission checks still apply.
- Record steering in transcript, user-update checkpoint, event journal, compaction, and recovery. Preserve ordering for multiple steering messages and isolate each to its captured session/project.
- Keep the composer editable while the model is reasoning or a tool is active. Explain that steering is applied at a safe boundary; the current response/tool is not modified in place.
- Show whether the model is reasoning with no project operation yet, waiting for a tool result, or actively changing/inspecting files. The Live Work Sheet now shows and persists elapsed time to the first structured tool other than `update_plan`, and separately to the first successful structured file write. Compact activity rows now identify each provider request and show its reported total duration, generated-token count, and finish reason when available. Reads/searches count only as a first tool; a command is not counted as a proven file mutation. Distinguish provider finish reasons from a stalled live request. One focused renderer test for request summaries passed; sidecar/journal timer tests and visible acceptance remain queued; timing to the first command side effect is still unknown.
- [x] Auto-mode no-action ambiguity: the engine now persists `no_action` when Auto completes without a declared mode, plan, or project operation; chat labels this explicitly and offers a composer intent selector plus a same-session “Continue this request as Implement” prefill. No edit permission is inferred and nothing auto-submits. Focused helper and end-to-end persistence tests plus renderer typecheck passed; broader question/plan/build/recovery tests remain queued.
- **Deferred:** no `plan.md` requirement. A concise, optional `progress.md` can be evaluated after task continuity is reliable; it must not duplicate the complete activity journal or become a prerequisite for code changes.
- Tests: steering during inference, active operation and approval; same task/workspace/turn continuity; order; compaction; crash before delivery; cancellation; queue-next; rejection and mirror failure; no approval bypass; rendered chat and activity after resume.

### B-008: Preserve chosen token settings and warm selected Ollama models

**Status:** Source implementation and focused tests are complete; packaged behavior remains to be verified.

- Fresh app windows and newly created sessions use the saved 65,536 context / 8,192 output preference, even after resuming an older session with different settings. Saved values persist, and the model's advertised maximum is no longer substituted when creating a session.
- Explicitly selecting another Ollama model starts a background warm request; a PRELOAD control supports reselecting the current model. The request preserves the chosen context and keep-alive and sends no prompt, output-token limit, or reasoning override.
- Warm-up completion reports elapsed wall time and Ollama's `load_duration` when returned, so the loading delay is observable rather than only shown as a generic ready message.
- While a warm request is active, model pickers are disabled and a task submission gives a clear wait message, preventing overlapping model loads or a silent rejected run.
- Do not load on app launch. If another model is already loaded, the selected model is loaded with a different context, or Keep Alive is set to immediate unload, skip and explain rather than unloading/resizing a model or wasting a preload.
- Verify packaged selection, warm-up status, repeat preload, context persistence, unchanged reasoning default, and safe skip with an externally loaded model before calling the feature complete.

## Active development order: core project work

These core items take priority over visual polish, orbit popovers, usage dashboards, and other quality-of-life backlog work. Verification and visible packaged acceptance remain grouped for the final gate, as requested.

1. **Close the model/tool protocol gate:** exact Ollama second-request payload, streamed and batched calls, the shared engine's stricter common-schema validation, broader MCP schema compatibility, truthful partial/error activity outcomes, cancellation/approval transitions, and legacy session migration. Unsupported MCP schema features are now disclosed during discovery and in Tool Catalog while runtime validation remains fail-closed. A safe transient tool-preparation cue reports tool name and argument size before dispatch without exposing partial arguments. Newly added schema, outcome, and streamed-preview regression cases remain queued for the final verification phase.
   - The active app worktree pins engine commit `613bca01a4054c52548ab1071dbe9ee694c3177b` in `core-revision.txt`; CI and release workflows read that pin. The engine supports appendable/revisable plans, phase-based host progress, dynamically budgeted tool results, concurrent validated read-only batches with correct finish-after-operation draining, paged checkpoint/transcript recovery, cooperative cancellation during project reads/search, and the repeated plan-only loop guard. Large outputs can be built with ordered append chunks and durable file activity; repeated provider output-limit truncation is now continued from the same task state and surfaced as incomplete without replaying writes. Focused engine operation-stream tests pass (39), renderer workflow-outcome tests pass (7); broad suites, packaging, and visible acceptance remain queued.
   - The pinned engine and desktop sidecar contain structured `ask_user` clarification, with a required modal choice, durable activity, answer-as-tool-result, and safe interruption recovery. It remains distinct from action approval and does not replace the model's ability to refine or expand plans repeatedly. Focused engine, persistence, and sidecar cases are authored; complete verification and visible interruption/recovery acceptance remain queued.
2. **Prove full-project workflow correctness:** build a real project through inspect → plan → edit/write → inspect diff → run relevant checks → report evidence. Replace intent/completion heuristics with an explicit workflow state so discussion, plan-only, blocked, changed, and verified outcomes are distinct.
   - Follow-up audit item: unique read/search results are currently observable tool progress, which is useful for broad repository exploration but could also let a model continue inspecting without reaching a project change. Review representative saved traces and test varied project sizes before changing this policy. Any improvement must preserve open-ended discovery and avoid arbitrary file, operation, or runtime caps.
3. **Complete permission and workspace boundaries:** finish testing persistent per-tool allow/ask/deny with hard-deny precedence, exact command previews, and a real opt-in Windows containment backend. Until then, host commands (including PowerShell) must be identified as uncontained even when their working directory is the selected project or disposable copy.
4. **Close resumability and context reliability:** preserve canonical history separately from each request's budgeted context, verify checkpoint tool-result associations, expose compaction/omissions, and fault-test crash recovery without replaying uncertain effects.
   - In progress in source: checkpoint contents are supplied on each inference request; JSONL event journals replay partial streams, plans, usage, and operation state; and an oversized active task can now compact at complete tool-exchange boundaries and retrieve omitted output through a session-scoped read tool. Verify long-task continuation, read-range behavior, one-store/two-store failures, duplicate records, final-response reconstruction, and the current chat Plan surface before promoting either repository.
5. **Add developer capabilities by evidence and adapter:** language-server diagnostics/navigation, browser/web tools, richer test/build workflows, and custom tools/plugins, each with capability reporting and individual permission rules. Do not imply these are available merely because MCP can theoretically provide them.

After those gates, return to deferred runtime benchmarks, analytics/KV presentation, visual customization, and model-orbit interactions. These backlog items remain approved and are not deleted.

### B-001: Compare context presets and output-token performance

**Status:** Selected 65,536 context / 8,192 output has passed a visible packaged run and runtime-context verification. The 262,144 same-prompt comparison remains.

- In the visible app, set context to 65,536 and output cap to 8,192 for the exact local Ornith 1.5 9B Q4_K_M tag.
- Keep reasoning at the model default and retain the existing 262,144-token model maximum setting as the comparison baseline; do not silently clamp or rewrite either selected value.
- Confirm the selected values appear in the run configuration, captured session, exact Ollama request (`num_ctx`, `num_predict`), runtime-reported effective context, and resumed session.
- Use the same short, fixed prompt for each setting. Record first-token time, output tokens, eval duration/tokens per second, total wait, CPU, RAM, GPU utilization, and VRAM during active inference. Label snapshots and continuous samples distinctly.
- Preserve the model/runtime state that existed before the check. Do not change OpenCode configuration or reasoning settings.

The selected-value run is documented in [ACCEPTANCE_LOG.md](ACCEPTANCE_LOG.md). Its session file independently persisted the exact model, project, `context: 65536`, `max_tokens: 8192`, and default reasoning; Ollama `/api/ps` and runner logs confirmed an effective 65,536 context. The runtime adapter maps the stored output cap to `num_predict` and now has an explicit payload assertion. Ollama request-body logging was disabled, so the historical wire body was not captured. Next, compare the same prompt and 8,192 output cap at the 262,144 context only when enough system memory is available; capture request/runner evidence and resource samples, and preserve the loaded model if the run is not started by this check.

### B-002: Local usage analytics across turns, sessions, and models

**Priority:** High; design before implementation.

- Keep analytics local and organize them by turn, resumable session, model/provider, and lifetime totals, with filters and comparisons.
- Track prompt/input and output token counts when the provider supplies them; otherwise identify estimates as estimates. Include first-token delay, prompt processing time if available, generation duration, output tokens/second, total wait, cancellation/failure, requested/effective context, output cap, reasoning selection, runtime/provider version, and selected run settings.
- Record timestamped resource samples during inference: CPU, system RAM, GPU utilization, VRAM used/total, and GPU power where the hardware exposes them. Mark unavailable readings instead of inventing values.
- Make model speed ranking opt-in and evidence-based. Separate throughput from quality/task success and show sample count, prompt/test conditions, model quantization, context, output cap, reasoning mode, runtime version, and hardware state beside every comparison.
- Include clear local retention, export, and delete controls before the analytics store is implemented.

### B-003: More useful Live Work Sheet resource and generation telemetry

**Priority:** High; the live worksheet and resource layout are implemented and visually verified in the current packaged build. Change review now opens immediately with loading/error feedback, and its project-boundary fix is committed; both changes still need a package rebuild and visible check.

- Present live input/output tokens and tokens/second alongside elapsed time and waiting/generating phase.
- Add CPU percentage, system RAM used/total, GPU percentage, VRAM used/total, and GPU power when available; show unavailable status cleanly for unsupported hardware.
- Keep the most actionable status readable at small window sizes, move `Inspect changes` near the top, and prevent overlap with message text or controls.
- Base live throughput on streamed output and clearly replace estimates with provider-exact final usage.

**Implemented and visibly verified in the packaged app:** The bottom ribbon and Live Work Sheet expose CPU, system RAM, GPU utilization, VRAM used/total, GPU power, and agent-service CPU/RAM. Unsupported readings render as unavailable. Python telemetry parses structured `nvidia-smi` values; unit tests cover available and empty probe responses. The work sheet uses compact responsive tiles, retains live token/s output, and keeps `Inspect changes` in the sheet header. The rebuilt `out-acceptance-2026-10-31-trace-fix` package was visibly checked at 1920x1080: the activity trace stays in its scroll region and does not overlap the resource panel. Change review opens immediately and presents visible loading/error states; project-root isolation (`f35ee11`) and review feedback (`ecc0ea9`) were rebuilt and visibly verified in `out-acceptance-2026-10-31-review-fix`. Active inference sampling remains in B-004.

**KV cache extension in progress:** the source panel now separates provider-reported prompt reuse, uncached prefill time, llama.cpp live slot context, and unavailable KV memory/type fields. Rebuild and acceptance are pending; see B-011.

### B-004: Measure partial GPU offload during active inference

**Priority:** Immediate investigation before performance conclusions.

- **Root cause confirmed:** at 262,144 context the Ollama runner offloaded 0/33 layers; at ~64K it offloaded 6/34. Correlate `nvidia-smi` samples and per-process GPU data with a real inference timeline; do not infer active GPU work from reserved VRAM or a one-time utilization sample.
- Capture Ollama `/api/ps` allocation, model runner, model size, requested/effective context, and system resource readings throughout the same run.
- The Q4 model file is 5.23 GiB; Ollama's 16.8 GB `size` at 262,144 context is the loaded runtime footprint, not the GGUF file size. The 4 GB GTX 1650 SUPER had 3.28 GiB free at model fit. Ollama's log projected 13.4 GiB GPU need (4.81 GiB model + 8.24 GiB context + compute), then selected zero GPU layers. It logged `offloaded 0/33 layers to GPU` and an 8 GiB CPU KV cache. At the earlier 64,096 request / 64,256 effective load, Ollama fit 6/34 layers on GPU, with about 1.34 GiB of model buffers and 251 MiB of KV cache on GPU. This confirms the context increase is why text-layer GPU offload fell to zero. The user also observed a sustained 2–5 minute CPU-only interval. Record active-inference telemetry during the visible 64K/8K comparison; do not change runtime settings before that user-selected test.
- Do not change context, reasoning, OpenCode settings, Ollama environment/configuration, or model files as part of this investigation without separate approval.

### B-005: Verify adaptive model markers and persistent transcript appearance

**Status:** The exact-orbits Windows package passes visible orbit and app-relaunch/session-render checks. A separate issue is now confirmed in the earlier failed test session: the saved user prompt itself contains retrieved `.agent-workbench/sessions/<session>.json` data. The core scanner now ignores `.agent-workbench`; the original assistant-response rendering report remains unconfirmed until checked against the affected response/session.

- Show exactly one orbit marker for each installed local model; show none when the catalog is empty. Give the selected model a distinct marker and distribute larger catalogs cleanly over the existing rings. Markers must be attached to each actual ellipse and distributed evenly by distance along its path.
- Preserve Markdown structure and syntax highlighting when a saved session is resumed and after the app is relaunched. Keep user/model message content as the original Markdown string.
- Run the visible check against one packaged instance after the user is finished using the desktop. Reopen a saved response containing headings, lists, and fenced code, then confirm it keeps its visual rendering after both session resume and app relaunch. Do not call the reported JSON regression fixed until reproduced or ruled out in that exact flow.

Orbit marker generation and styling are implemented; tests cover 0, 3, and 27 installed models, actual ring containment, and even ellipse-perimeter spacing. The `exact-orbits` package visibly showed 20 installed models attached to the rings and highlighted the selected model. After closing the prior window, launching this package, and resuming the saved session, the transcript still displayed Markdown bullets and syntax-highlighted Python code. Transcript restoration also has renderer tests for headings, lists, and code. The exact JSON-looking report remains unverified because inspected disposable sessions do not contain JSON-shaped assistant content. The accepted sessions/activity implementation now persists plan and activity events; verify that side-panel restoration in the new packaged acceptance flow.

### B-006: Clickable model orbit information popover

The orbit markers are interactive in source and the details popover is implemented. The CSS click-through correction is committed, but the currently open packaged build predates it and did not visibly show the dialog. Rebuild and verify the anchored popup, model metadata loading/error state, close behavior, and placement near screen edges after the core packaged workflow passes.

### B-007: Live Work Sheet layout controls and visual telemetry polish

Keep the existing core activity/status/readability fixes. After the harness acceptance gate, revisit section ordering/sizing, small-window responsiveness, and any additional display polish. Do not use the visual task as a substitute for core agent-flow validation.

### B-008: Lifetime/session/model usage analytics and ranking

Design the local-retention and export controls first. Record provider-exact counts where available, label estimates, capture timestamped active-inference hardware samples, and keep speed ranking separate from coding quality/task success. This remains deferred until the core task/session evidence is reliable.

### B-009: Core small-model workflow reliability and measured runtime optimization

**Source status:** workflow-profile, plan-to-tool continuation, provider cache telemetry, and removal of the hidden 16-action/32-turn ceilings exist in source. Older test/package results apply only to their recorded commits; the active steering and timing follow-ups have queued regressions and are not verified. The Desktop Squirrel installer and ZIP were rebuilt after the ceiling removal and composer-toggle addition on 2026-10-31. Bundled-worker ping and visible acceptance are queued for the final verification pass.

- The Small-model workflow is an explicit setting, captured in run settings/session history. It instructs the agent to work in short sequential tool operations and inspect results. Standard remains available. Neither profile changes model/runtime, context, output cap, reasoning, temperature, approvals, or access.
- An explicit implementation request that returns only a plan/progress note can receive one follow-up model call requesting structured tool use. Plan-only/read-only work is excluded, and normal approvals still gate actions. Validate for false positives and avoid claiming completion when the follow-up reports a blocker.
- The active unpublished app worktree now pins engine source `75ca8bddee5e10e9ac4c801d5a8b1a580996f13c`; `e5158359cca2e780ca506cfd98e8b8015c63852a` is the historical beta.3 pin. Automatic implementation continuation uses structured plans and host-observed operations rather than exact assistant phrases. The engine does not turn prose such as “May I run…” into authorization. Host-generated next-action guidance now replaces stale guidance in the system prompt instead of accumulating across continuations. Two focused continuation/plan-flow tests passed; full suites and visible acceptance remain queued. The long-reasoning Flint run was canceled before a complete response or tool call; its eventual tool-use behavior is unknown.
- The engine no longer drops actions after a fixed 16-action batch or terminates a run at 32 model/tool iterations. The task remains user-cancellable; stress-test long loops and verify progress/checkpoint behavior for large batches.
- Capture prompt-evaluation count/duration and provider-reported cached prompt tokens along with generation/load usage; display cache-hit rate only when supported fields are present.
- Keep provider prompt prefixes stable and benchmark runtime cache flags only via repeatable A/B runs. Current source does not turn on cache-reuse or change Ollama/KV settings.
- From the rebuilt package, verify bundled-worker protocol and UI toggle persistence, then in one visible packaged instance test a concise request, an explicit project build that first returns a plan, plan-only request, settings persistence, exact inference options, cache metrics when available, Home navigation, session resume, and project isolation.

### B-010: Public beta repositories and installer releases — beta.3 draft-only after privacy scrub; updater acceptance pending

- Build provenance is now enforced: CI/release workflows read the exact app engine pin; local packaging rejects a mismatched or dirty checkout. The pinned engine commit is reachable on public branch `workbench/app-pair-dcdf7fc` without moving engine `main`. Focused build-configuration tests pass (7). The local package and full release gates remain pending.

The app and shared engine have independent public MIT-licensed Git repositories with separate histories. Public app release `v0.1.0-beta.2` remains available; beta.3 is draft-only after the privacy correction, with old public ZIP access returning HTTP 404. Beta.3's local source/package/worker checks passed; its new UI was not launched because the existing beta.2 window had an active task. The update service returned the beta.3 Setup URL for a beta.2 client, but installed update/restart/data recovery remains unverified. GitHub Actions failed before runner steps; local evidence is recorded in `ACCEPTANCE_LOG.md`. A user-reported long website task completed successfully in 2–3 hours. Production dependencies audit clean; 18 moderate development dependency findings remain for separate review.

### B-014: GitHub-release updater and first-run recovery

**Status:** Source implemented; Windows package, update service, and clean install/upgrade acceptance pending.

- Use Electron's Squirrel.Windows updater against the public GitHub release feed for installed Windows x64 builds. Publish the `RELEASES`, full `.nupkg`, and Setup `.exe` assets together; keep SHA-256 sums on the release.
- Automatically check periodically and download in the background, but never restart silently. Show a user-controlled update action and block installation while a task is active.
- Handle Squirrel install/update/uninstall launch events so they do not start the regular app or sidecar. Ensure first-run checks wait until Squirrel releases its installer lock.
- Add first-run guidance and an in-app route to official Ollama setup; keep model weights and provider runtimes separately chosen and downloaded. Preserve no-model-load-on-launch behavior.
- Validate previous-version install → discovery → download → user-approved restart → data preservation in a clean Windows x64 environment. Document that macOS, Linux, Windows ARM, and Authenticode signing are not provided by this beta workflow.

### B-015: Chat reading continuity and concise tool activity

**Status:** Source now places each operation feed below its originating turn and persists turn IDs for resume. Compact clickable rows remain the default; automated and packaged visual acceptance are queued.

- Keep the transcript at the end only while the reader is already following live output. Show a jump-to-latest control after they scroll into earlier messages; restore follow mode when they return to the end.
- In chat, show each operation as a small clickable text line (action, affected path when available, and state), not a bordered panel. Expand that line on demand to see full arguments, output, results, and affected files. Keep the worksheet Activity Trace detailed and unchanged.
- Keep full operation history and results available in the worksheet and after session resume; retain the selectable compact/sidebar/inline modes.
- Verify long streamed output, reader scroll-up, jump-to-latest, session restore, and each display mode in the rebuilt app.

### B-016: Accurate model-orbit home visualization

**Status:** Source now waits for a successful model inventory before reporting zero, preserves the last known inventory on a refresh error, and derives a repeatable, identity-keyed ring position per installed model. A persisted slow-orbit toggle respects reduced-motion preferences and pauses while a model card is open. The authored zero/three/large-catalog and stable-position regressions remain queued; packaged visual acceptance is still pending.

- Render one interactive marker per installed local model; render zero model markers when no models are installed. Ring outlines remain decoration only and do not imply models.
- Clicking a marker opens that model's metadata without loading it. Escape and clicking outside dismiss the card.
- Test zero, three, and large model catalogs plus provider metadata and viewport placement in the packaged Home screen.
- Verify the inventory status on startup, confirmed empty, transient runtime failure, and recovery; each real model marker remains clickable and the optional motion toggle survives relaunch.

### B-017: Release screenshots and README visuals

**Status:** README refreshed and three authentic historical Workbench captures added; current release-build screenshots are still pending. The earlier-commit reconstruction remains excluded from user-facing galleries.

- Add real screenshots from the exact rebuilt release candidate: Home/model orbit, chat with compact live activity, and the worksheet showing plan, trace, and resource readings.
- Keep historical screenshots clearly labeled and ensure captures contain no private project paths or credentials.

### B-018: Hover-revealed desktop window controls

**Status:** Source implementation added; the idle hit target is now limited to the far top-right corner and expands only when revealed. Native packaged interaction remains unverified.

- Hide minimize, maximize/restore, and close controls during normal use. Reveal them only in the top-right edge hotspot; reserve header space so they cannot overlap application actions.
- Route close through the existing required running-task close decision. Validate hover, keyboard focus, maximize/restore state, and window close behavior in the packaged app.

### B-019: Optional project-scoped operation profile

**Status:** Structured built-in file tools support explicit external-folder scopes bound to the project that created each grant. Ask is the UI default; Allow/Deny are enforced by the engine. Commands and MCP still run with host-user privileges; disposable-copy mode is not OS containment. Packaged approval acceptance is pending.

- Explore an opt-in project-scoped file-operation profile that keeps normal project development available while making each operation's root visible. Keep commands/MCP separately permissioned and clearly host-scoped until a real Windows containment mechanism exists.
- Preserve current full-development behavior by default. Do not describe a project-root policy or approval dialog as an OS sandbox.
- Add staged external-folder changes to Copy mode, and test symlink/junction rejection and unavailable saved folder grants in the packaged app.
- Compare safe file-root enforcement, generated-file/build directories, external toolchains, command execution, and MCP before choosing boundaries; add a real contained mode only with an explicit capability and recovery design.

### B-020: Home session recovery visibility

**Status:** Source now shows the complete saved-session list, recovery/conflict/workspace status, and resume actions for available projects. Renderer and sidecar regressions and packaged acceptance remain queued.

- Keep app-wide session history separate from the active project's session tab.
- Make conflicts, interrupted runs, partial operations, recovery issues, and unavailable workspaces visible before resume.
- Resolve moved workspaces through workspace identity where possible; never discard app-side history when the project directory is unavailable.
### B-011: Provider-accurate live KV-cache telemetry

**Priority:** High; telemetry is implemented in source in both runtime adapters, with end-to-end packaged evidence pending.

- Show prompt tokens cached, total/uncached prompt tokens, exact cache-hit rate, and uncached prefill time only when the selected runtime reports those metrics. Make response-delayed updates clear for Ollama.
- For app-owned llama.cpp, sample documented slot counters to show active/request context-token occupancy and slot capacity. Never include or expose the prompt text from `/slots`.
- Keep actual KV allocation bytes, cache format/precision, and unsupported provider fields explicitly unavailable. Device-wide VRAM remains separate from KV usage.
- Test absent/partial metrics, multiple tool-loop model calls, idle/active llama slots, malformed `/slots` responses, and the packaged UI. Verify the telemetry polling does not pause inference or access/stop an external server.

### B-012: Capability discovery, universal development tools, and safe execution boundaries

**Priority:** Critical for full-product readiness; official cross-provider research is recorded in `CORE_HARNESS_READINESS.md`; implementation remains phased. The in-app tool directory reports built-in, MCP, and missing integrations; root-confined Git status/log tools are implemented in source.

- Maintain a capability registry across provider/model/runtime, platform, project, and installed MCP integrations. Show supported/unsupported/unknown tool-call and modality capabilities; never infer a feature from an endpoint accepting a schema.
- Expand integrations by need: searchable project tools, structured test/build profiles, browser automation, LSP diagnostics/navigation, debugger, Git/review, local MCP, and extensible custom tools. Keep discovery and permission approval host-controlled.
- Make large-repository enumeration/search resumable, cancellable, and progressive, with configurable budgets and visible partial-result status. Do not remove safeguards in a way that permits uninterruptible scans.
- Add per-server MCP health/deadline/environment policy. Approval must describe the exact target and scope. Source now supports stdio and HTTPS Streamable HTTP, env-backed headers, configurable connect/read timeouts, explicit redirects-off, and requires patched SDK 1.30+ within v1; run integration and packaged acceptance before calling remote MCP reliable.
- Design Windows command/MCP process containment before treating project root, copy mode, or auto-approval as a sandbox. Current approved subprocesses run as the Windows user and can touch locations beyond the selected workspace; consent does not provide OS isolation.
- **Current execution boundary:** this build adds an explicit host-permission warning to command/MCP approvals and auto-approval settings. That is transparency only; it does not contain processes. Windows AppContainer integration remains unimplemented and must be acceptance-tested before a contained-mode claim or broad unattended execution.
- Compare Microsoft's AppContainer/Windows sandbox APIs with the app's Python and MCP process model, then implement and fault-test a real opt-in contained executor before broad unattended command permission. Preserve an explicit host-execution mode for tools that require full developer-machine access.
- Keep browser, LSP, debugger, web access, remote MCP, computer control, and multimodal support as distinct adapters with declared prerequisites and per-tool permission rules; MCP extensibility does not mean every configured service is trustworthy or available.
- Maintain a parity register with upstream references, local equivalent, status, evidence tier, and incompatibilities for every Codex/OpenCode user-facing capability.

### B-013: Triage Electron Forge development dependency advisories

The 2026-10-31 full `npm audit` reports 18 moderate findings in development dependencies, while `npm audit --omit=dev` reports zero. npm's suggested remediation downgrades Forge 8 to Forge 7.11.x, a major change. Check upstream advisory details and compatibility with the current Vite/Electron stack; then upgrade or override only with typecheck, tests, and a fresh Windows package gate. Do not apply the breaking downgrade blindly.

## Active acceptance blockers

- **Restored run status — verified:** Saved terminal outcome is shown after session resume, and completed turns show a fully completed phase rail. The final packaged build visibly restored session `20d95dd8` with `TURN COMPLETE`, all rail steps complete, formatted response, 13 activity events, and unchanged 65,536/8,192/model-default settings. See `ACCEPTANCE_LOG.md`.

- A previous wrapper imposed an accidental 20-minute observation cap; that was a test-driver mistake, not an app limit. Do not use a fixed observation deadline for long model generation. The first numbered-list cancellation attempt ended before the user-requested forced stop and is inconclusive. The user's retry had reached 13 items after about 120 seconds; no cancellation was sent. The app was later observed minimized, so the retry's eventual completion/cancellation state remains unknown.
- The single packaged instance visibly completed hello, coding task, per-action approval, and the approved `python -m unittest -v` command; all five tests passed. A modal check confirmed backdrop click and Escape did not dismiss the approval decision. Session resume and project switching/boundary isolation were visibly verified. The 65,536/8,192 session now has independent persisted-session and Ollama runtime-context evidence.
- `Inspect changes` initially did not expose the selected fixture's files because Git walked up to the parent repository and `.gitignore` hid `work/`. The committed fix `f35ee11` confines Git diff review to a repository rooted at the selected project and shows a bounded file snapshot for non-Git projects. The rebuilt `review-fix` package visibly shows the selected fixture files in both Project Home and the Live Work Sheet review dialog.
- The visible packaged run exposed a default-selection bug: a fresh run selected the first Ollama catalog entry (`hf.co/ressl/...`) even though the accepted exact default is `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`. Source now prefers that exact tag when it is installed and preserves a valid user selection. The rebuilt package visibly selected the accepted exact tag.
- The earlier chat-only permission question is resolved in the visible package: the exact command produced a blocking approval dialog and the approved command returned five passing tests.
- CSS containment fix `8f08a74` is confirmed in the rebuilt package visually; the activity trace no longer overlaps the resource/system area.
- Earlier runs briefly selected the wrong ressl source. The latest visible session showed the accepted mradermacher tag, and read-only `/api/ps` plus the runner log confirmed the 65,536 context selected for the token-control run. The model remains loaded; do not unload it.
- The review-fix package was rebuilt and visibly confirmed the selected project's `Inspect changes` output and project/session separation. The 65,536 / 8,192 session settings and effective Ollama context were also verified. Remaining acceptance includes the matching 262,144-context comparison and long-running generation/cancel acceptance (previous evidence is inconclusive). The complete app suite and typecheck passed after adding the `num_predict` payload assertion.
- Session rendering follow-up: a completed Markdown answer reopened after an app restart with its heading, bullets, and inline code still rendered correctly, and a new eight-item list was saved as Markdown text. The user's specific assistant-response JSON-after-reopen symptom remains unconfirmed. Separately, the earlier failed test session was visually reopened in the new package and its saved user prompt visibly contains retrieved `.agent-workbench/sessions/<session>.json` data, explaining that session's JSON clutter; the core scanner exclusion is now covered by tests. The new package still needs visible proof that a fresh request does not retrieve session storage and that saved activity/plan panels render after relaunch.
- New session/activity persistence is committed in `430e8e4`; packaged verification is still pending. Confirm workspace recents, activity modes, full operation output, persisted approvals/errors/plans, cancellation/close choices, crash recovery, session conflicts, and side-panel restoration across app relaunch in the packaged disposable-project workflow.

## Stop-point and next work (2026-10-31)

**Source batch complete and committed; source checks passed.** Next gate is a rebuild/package inspection, then one visible single-instance disposable-project acceptance. No package or live model run is claimed for this checkpoint. After visible acceptance, run the already approved exact-tag model check without changing context, output, reasoning, or unloading a pre-existing model.

Core priority queue remains: packaged permission/cross-workspace acceptance; real Windows isolation for commands; first-party LSP, browser/search, question and custom tools; session/workspace recovery and history edge cases; explicit task-specific completion/verification; provider capability and overflow handling; packaged MCP lifecycle/error acceptance. Compare a durable inbox with steer/queue/cancel delivery and visible retry events against OpenCode V2 before choosing an implementation. Do not drop the full parity register. UI polish, analytics/KV visualization expansion, orbit interactions, and other non-core improvements stay deferred until core reliability gates pass.

### Latest core continuity additions (2026-11-01)

Restored Plan decisions/criteria and latest-turn Plan activity; malformed checkpoint migration guard; context-derived paged file reads. Regression cases are committed but unrun. Core package and visible acceptance are still pending.

File list/search results now use the selected-context response budget with resumable offsets; large lines route to full range reads. Regression verification remains queued.

Large tool outputs are now context-budgeted for inference while preserving the full result in the activity/session history with range retrieval. Verification remains queued.
- The active app source adds durable session-scoped follow-up prompts that can be drafted during long runs without interrupting them. They are mirrored, project-bound, explicitly started by the user, and consumed once with the new run snapshot. Tests are queued; no typecheck/package/visible acceptance has run.
- New core source adds chunked large-file construction, durable chat-session approval, truthful cache metric availability, and exact installed model recommendations. These remain unverified. The public update feed follows Electron's supported packaged Squirrel contract, but an installed upgrade/recovery canary has not passed.

- Core recovery follow-up: terminal failures now expose a same-chat, user-triggered continuation prefill from the saved checkpoint. It explicitly inspects completed and uncertain effects before continuing; focused tests (4) and renderer typecheck passed. Packaged resume/restore behavior remains queued.
- Full-PC access follow-up: built-in project file tools are root-confined with optional external-directory grants bound to their owning project; approved PowerShell/command processes still run with host-user rights and are not contained. Evaluate a real opt-in Windows containment backend. Do not silently widen access or call process approval a sandbox.

- External file access uses concrete folder rules bound to a normalized selected-project identity. The sidecar captures only matching rules, and the engine independently filters against the original project root (including runs using disposable copies). Old app-global external grants are disabled with a repair warning while the saved file remains untouched. Ask is the picker default; Allow is explicit, Deny is hard, and nested deny beats grants. External structured writes remain blocked in Copy mode. Focused engine tests: 50 passed; worker tests: 65 passed including Copy-mode source binding; renderer typecheck passed. Packaged acceptance is pending.
- Still open: meaningful real Windows containment for shell/MCP, packaged approval-modal verification, broader MCP/web/LSP/command capability parity, and full system/release acceptance. Shell approval and selected cwd are not a sandbox.
