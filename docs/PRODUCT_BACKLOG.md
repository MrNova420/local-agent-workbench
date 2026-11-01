# Product Backlog

The product target is full 1:1 user-facing feature and workflow parity with Codex and OpenCode, as tracked in [CORE_HARNESS_READINESS.md](CORE_HARNESS_READINESS.md). The authoritative cross-repository order and release state is [MASTER_ROADMAP.md](MASTER_ROADMAP.md). The current implementation sequence starts with stabilizing the core agent harness and full-project workflow; deferred parity items remain required and are not dropped scope. Existing runtime and model-support requirements remain in [MODEL_RUNTIME_EXPANSION.md](MODEL_RUNTIME_EXPANSION.md).

## Current evidence and this release batch

- The user reports a successful simple website project task completed in roughly 2–3 hours on their PC. This validates one real long-running project workflow; it does not establish speed, broad reliability, code quality, or release readiness. See `ACCEPTANCE_LOG.md`.
- Public beta `v0.1.0-beta.3` is published with Windows x64 Setup, portable ZIP, Squirrel update assets, and SHA-256 manifest. Beta.3 local source checks and package/worker integrity passed; GitHub Actions failed before runner steps. The existing beta.2 app had an active task, so beta.3 was not visibly launched; the installed update/restart/data-recovery canary remains open.
- Documentation/planning commits do not bump the app version or create tags. Future distributable releases use new increasing beta SemVer tags only after final verification; tags trigger public release automation. See `RELEASE_RUNBOOK.md` for the paired engine pin, updater-compatible GitHub release flags, and complete Squirrel asset set.
- The README now contains three relevant historical Workbench screenshots; each is labeled historical. Current release-build Home/chat/worksheet captures remain a follow-up because the user-specific Home contains private workspace paths.
- Keep the user's context/output/reasoning values unchanged. The next core-development batch remains isolated from the published beta.
- The active unpublished session-continuity source batch adds rolling task checkpoints, append-only mirrored run journals, coalesced full snapshots, bounded replace retry, durable per-turn provider usage, cached-token forwarding, and the missing Plan-panel binding. These changes are not tested, typechecked, packaged, or visibly accepted yet. The detailed verification queue is in [SESSION_CONTINUITY_IMPLEMENTATION.md](SESSION_CONTINUITY_IMPLEMENTATION.md).
- The current unpublished source also includes Workbench-owned skill switches/sources, durable session run settings, evidence-based terminal outcomes, explicit task intent with a host-generated initial checklist, durable per-request prompt provenance, and agent-defined task acceptance criteria that survive compaction and session restore. Terminal verification records actual project-change, post-change-inspection, and approved-command evidence. Implementation with neither a structured change nor a command side effect is incomplete; command-only implementation remains unverified because its file effects cannot be attributed to a structured write. Commands stopped or timed out after launch are marked uncertain because they may have left partial files. Prompt records show actual source paths, skill/tool inclusion, and estimates without duplicating prompt text. These are not promoted to the public beta and are queued for full cross-repository verification.

## Queued for review and implementation

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
   - The active app worktree pins engine commit `bb87dc5f6fdee5f0ef8ca89f0312044ad4ee3ecc` in `core-revision.txt`; CI and release workflows read that pin. The source progressively renders long activity histories, separates runtime-worker from device telemetry, and no longer imposes an implicit command timeout; the retained CLI approval preview shows its actual timeout behavior. Mocked telemetry coverage belongs to the engine. Conflicting generic Ollama runtime options cannot override the selected context/output/temperature, and ignored values are disclosed in request activity. Streamed tool-call activity is persisted with safe metadata and correlated to the exact provider request. Incomplete command checks are distinct from completed verification. Oversized checkpoints have a budgeted inference copy with explicit omission counts while full history remains saved. This paired source is not part of a verified package. Final tests and visible acceptance remain queued.
2. **Prove full-project workflow correctness:** build a real project through inspect → plan → edit/write → inspect diff → run relevant checks → report evidence. Replace intent/completion heuristics with an explicit workflow state so discussion, plan-only, blocked, changed, and verified outcomes are distinct.
3. **Complete permission and workspace boundaries:** per-tool allow/ask/deny with hard-deny precedence, exact command previews, and a real opt-in Windows containment backend. Until then, host commands (including PowerShell) must be identified as uncontained even when their working directory is the selected project or disposable copy.
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

**Source status:** workflow-profile, plan-to-tool continuation, provider cache telemetry, and removal of the hidden 16-action/32-turn ceilings are implemented in source and automated tests pass. The Desktop Squirrel installer and ZIP were rebuilt after the ceiling removal and composer-toggle addition on 2026-10-31. Bundled-worker ping and visible acceptance are queued for the final verification pass.

- The Small-model workflow is an explicit setting, captured in run settings/session history. It instructs the agent to work in short sequential tool operations and inspect results. Standard remains available. Neither profile changes model/runtime, context, output cap, reasoning, temperature, approvals, or access.
- An explicit implementation request that returns only a plan/progress note can receive one follow-up model call requesting structured tool use. Plan-only/read-only work is excluded, and normal approvals still gate actions. Validate for false positives and avoid claiming completion when the follow-up reports a blocker.
- The current app source pins the approval-safe continuation in engine commit `e5158359cca2e780ca506cfd98e8b8015c63852a`; the paired branch is not yet fully verified or included in a public package. A final prose-only “May I run …?” / “Can I execute …?” can request one bounded follow-up for the exact structured command call. This only opens the ordinary approval flow; prose is never treated as consent.
- The engine no longer drops actions after a fixed 16-action batch or terminates a run at 32 model/tool iterations. The task remains user-cancellable; stress-test long loops and verify progress/checkpoint behavior for large batches.
- Capture prompt-evaluation count/duration and provider-reported cached prompt tokens along with generation/load usage; display cache-hit rate only when supported fields are present.
- Keep provider prompt prefixes stable and benchmark runtime cache flags only via repeatable A/B runs. Current source does not turn on cache-reuse or change Ollama/KV settings.
- From the rebuilt package, verify bundled-worker protocol and UI toggle persistence, then in one visible packaged instance test a concise request, an explicit project build that first returns a plan, plan-only request, settings persistence, exact inference options, cache metrics when available, Home navigation, session resume, and project isolation.

### B-010: Public beta repositories and installer releases — beta.3 published; installed updater acceptance pending

The app and shared engine have independent public MIT-licensed Git repositories with separate histories. Public app release `v0.1.0-beta.3` contains the Windows x64 installer, portable ZIP, Squirrel update assets, and SHA-256 manifest. Beta.3's local source/package/worker checks passed; its new UI was not launched because the existing beta.2 window had an active task. The update service returned the beta.3 Setup URL for a beta.2 client, but installed update/restart/data recovery remains unverified. GitHub Actions failed before runner steps; local evidence is recorded in `ACCEPTANCE_LOG.md`. A user-reported long website task completed successfully in 2–3 hours. Production dependencies audit clean; 18 moderate development dependency findings remain for separate review.

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

**Status:** Source catalog is deduplicated and stable-sorted, with the Home catalog refreshed every 30 seconds while visible. Each unique installed local model maps to one clickable marker; visible count/click acceptance remains queued.

- Render one interactive marker per installed local model; render zero model markers when no models are installed. Ring outlines remain decoration only and do not imply models.
- Clicking a marker opens that model's metadata without loading it. Escape and clicking outside dismiss the card.
- Test zero, three, and large model catalogs plus provider metadata and viewport placement in the packaged Home screen.

### B-017: Release screenshots and README visuals

**Status:** README refreshed and three authentic historical Workbench captures added; current release-build screenshots are still pending. The earlier-commit reconstruction remains excluded from user-facing galleries.

- Add real screenshots from the exact rebuilt release candidate: Home/model orbit, chat with compact live activity, and the worksheet showing plan, trace, and resource readings.
- Keep historical screenshots clearly labeled and ensure captures contain no private project paths or credentials.

### B-018: Hover-revealed desktop window controls

**Status:** Source implementation added; native packaged interaction remains unverified.

- Hide minimize, maximize/restore, and close controls during normal use. Reveal them only in the top-right edge hotspot; reserve header space so they cannot overlap application actions.
- Route close through the existing required running-task close decision. Validate hover, keyboard focus, maximize/restore state, and window close behavior in the packaged app.
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

Core priority queue remains: permission rules with deny precedence; real Windows isolation for commands; first-party LSP, browser/search, question and custom tools; session/workspace recovery and history edge cases; explicit task-specific completion/verification; provider capability and overflow handling; packaged MCP lifecycle/error acceptance. Do not drop the full parity register. UI polish, analytics/KV visualization expansion, orbit interactions, and other non-core improvements stay deferred until core reliability gates pass.
