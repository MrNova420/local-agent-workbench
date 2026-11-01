# Product roadmap and release state

**Last reconciled:** 2026-11-01
**Current release:** `v0.1.0-beta.3` is published. This remains an unstable beta with visible app acceptance and the installed update canary open.

This is the cross-repository execution order. It preserves the full approved product scope while separating core harness readiness from later parity and quality-of-life work. “Implemented in source” is not the same as tested, packaged, or accepted in a visible workflow.

## Current state

- The public desktop app is `v0.1.0-beta.3`, released from app commit `7a698c3d8b704ad38003c9b9d4959209afa79fd4`; it is marked Latest on GitHub. The paired engine main branch includes commit `742ddb55a0fcdd7d0d205b29c04228cef5b9c0ff`; the active unpublished app worktree pins engine commit `b3057bd322b470cd444e7c3448070d658ee546b4`. The public beta still uses its earlier immutable source pin.
- The app release contains Windows x64 Setup, Squirrel package/manifest, portable ZIP, and checksums. GitHub's beta.2 updater feed returned HTTP 200 with the beta.3 Setup URL; actual installed update/restart/data recovery is still unverified.
- Recent changes include compact inline tool activity attached to its originating turn, persisted turn-to-activity mapping, live model-catalog refresh/deduplication and stale GGUF path filtering, hover-revealed window controls, host-observed implementation continuation independent of assistant wording, more accurate verification outcomes, cancellation-before-worker-start state handling, budgeted inference-only checkpoint summaries, and host-observed progress for the seeded task checklist. The latest checklist progression regression is queued and unrun.
- Local verification for beta.3 passed: 140 engine tests, 53 renderer tests, 45 sidecar tests, TypeScript typecheck, Windows package build, bundled worker ready/ping/shutdown, and Squirrel/ZIP integrity. Production dependency audit found zero vulnerabilities; 18 moderate findings remain in development dependencies.
- The beta.3 package was not launched because the only existing Workbench window was actively generating a user task. That run was preserved, no duplicate app was opened, and no candidate model request was made. Visible acceptance is still pending.
- The source implementation preserves the user's chosen context/output and model-default reasoning. No token/reasoning/model settings were altered in this planning checkpoint.
- **Active unpublished continuity work:** the paired app pins engine `b3057bd322b470cd444e7c3448070d658ee546b4`; plans are expandable and phase-driven for host progress, default repository scans have no hidden file/byte ceiling, tool output uses actual remaining context, and independent read-only batches run concurrently. Small-model guidance encourages known-independent batch calls without reordering side effects. Paged checkpoint and transcript readers recover details omitted from the active prompt, and long reads/search/retrieval observe cancellation. Safe batches already in flight are drained and recorded before finish-after-operation stops the next model request. Inference checkpoint compaction now respects its allocated budget while preserving full plan/history data on disk, including when the projection budget is small. The app renders plan workstream labels and all interrupted concurrent operations. The current source also adds structured clarification with durable question/answer recovery. Regressions are queued. Tests, typecheck, package build, visible acceptance, and hardware attribution checks remain queued until development is complete. See [SESSION_CONTINUITY_IMPLEMENTATION.md](SESSION_CONTINUITY_IMPLEMENTATION.md). These changes are not pushed or packaged.
- **Queued follow-up prompts (app source only):** while a run is active, the user can draft and save session-scoped follow-ups without interrupting inference. The queue is mirrored with the session, remains bound to its workspace, and is visible after resume. Entries start only after explicit selection. Starting one validates and consumes its exact ID/text in the saved run snapshot, avoiding automatic replay. Regression cases cover persistence, project binding, removal, and one-time consumption; they remain queued and unrun.
- **Active core additions (app + engine source; verification queued):** long implementation requests continue as plan/tool/evidence progress advances, without a fixed continuation count or runtime deadline; an unchanged loop is reported as explicitly incomplete with a resumable checkpoint. Large generated files can be written across output-limited model calls through atomic, ordered `append_file` chunks with normal approval and workspace boundaries; saved chat-session approval can persist only after both mirrors accept it, validates its stored boolean grant, and is revoked by switching away from per-session; prompt-cache telemetry no longer presents missing counters as zero, and llama.cpp current-slot prompt-cache tokens are shown when its `/slots` response includes them. Model Library highlights installed models in this order: Ornith 1.0 9B Q4_K_M, Ornith 1.5 9B Q4_K_M, UnderDog Saluki 27B (tag says IQ2 mix; installed GGUF metadata says IQ2_XS), Qwen 3.8 Distill 35B A3B i1-IQ4_XS, Distill Abliterated Apex/Fast (both observed IQ3_XXS), and Flint UD-IQ2_XXS. Other installed models remain selectable and Hugging Face search stays open to alternatives; choosing a card does not load/download it. Existing Windows x64 Squirrel updater behavior was checked against Electron's public update feed contract, but the installed upgrade/recovery canary is still required. No model/context/output/reasoning setting changed.
- **2026-11-01 source follow-up (app + engine; verification queued):** removed prompt-wording-based implementation detection in favor of explicit task intent and structured host evidence; retained the full agent prompt. Automatic mode now receives a visible starter checklist if the model reaches a structured file write without creating its own plan. Home distinguishes model-catalog sync, a confirmed empty inventory, and request failure; it keeps known models through refresh errors, assigns repeatable identity-keyed orbit positions, and provides a persistent optional slow-orbit control. Home now lists saved sessions independently from the open project's session list, shows recovery/conflict/unavailable status, and resolves moved projects by identity before offering resume. Workspace history refresh is independent, ignores stale overlapping search results, surfaces corrupt/unreadable history without replacing the file, and cannot block opening a valid project. Project files now remain usable while session enumeration loads/fails; restored sessions reload their own file inventory, and sequenced navigation/file/session responses prevent stale workspace state from replacing the current project. The idle window-control hover target is limited to the top-right edge. The app pins engine `b3057bd322b470cd444e7c3448070d658ee546b4`. New regressions are authored but unrun; no UI, package, runtime, or model acceptance has occurred.
- **Recovery follow-up:** concurrent active operations are now tracked separately through live state and journal replay; interruption preserves every uncertain operation for the recovery modal and continuation prompt. A two-read session-resume integration regression is queued and unrun.
- **Structured clarification follow-up (source only):** the desktop run can expose an `ask_user` tool for requirements that materially change implementation. It pauses inference, presents a required-choice dialog with optional choices and freeform answer, journals the exchange, and returns the answer as the tool result. This is separate from file/command approval; persistent deny rules still apply. Crash recovery preserves an already-recorded answer, marks unanswered prompts interrupted, and does not classify the interaction as an uncertain file side effect. Engine, sidecar, persistence, and renderer regressions are queued and unrun.
- **Plan progression follow-up:** engine commit `3645c16cc4595f6d375b730d0220b1af467d73c4` adds stable plan phase metadata and marks the already-captured task brief complete. Older title-only plans remain readable; regression coverage is queued and unrun.
- **Batch stop follow-up:** engine commit `5ff104a9d5bc285a54800ce5f3f9dd8ed88e142b` drains and records all already-submitted safe read operations before honoring finish-after-operation. A concurrency regression is queued and unrun.
- **Small-model batch guidance:** engine commit `67edf824327779a98332fe271b0b247dd68ebdee` asks the small-model profile to combine known-independent calls in one response and explains which side effects the host keeps ordered. Prompt regression is queued and unrun.
- **Transcript follow follow-up:** chat now updates its follow-scroll preference synchronously, avoiding a stale React-state frame where streaming activity could pull the viewport down after the user scrolled upward. Existing scroll-helper coverage and visible long-stream acceptance remain queued.
- GitHub Actions for both promoted main commits and the beta.3 tag failed before any steps started because a hosted runner was not allocated. Local checks are not reported as hosted CI passes; recheck runner availability on the next update.
- User-reported evidence: one disposable website task eventually completed after about 2–3 hours and produced a functioning project, though visual quality was modest. This is a positive single-run report, not a speed, quality, or release guarantee.

## Source-of-truth map

| Need | Authority |
|---|---|
| Cross-repository sequence, gates, and release state | This file |
| Codex/OpenCode parity, system boundaries, and evidence tiers | [CORE_HARNESS_READINESS.md](CORE_HARNESS_READINESS.md) |
| Prioritized product features and acceptance details | [PRODUCT_BACKLOG.md](PRODUCT_BACKLOG.md) |
| Runtime/model capabilities and exact settings requirements | [MODEL_RUNTIME_EXPANSION.md](MODEL_RUNTIME_EXPANSION.md) |
| Version, packaging, updater, and release mechanics | [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) |
| Dated test, live-use, package, and visual evidence | [ACCEPTANCE_LOG.md](ACCEPTANCE_LOG.md) |
| Shared engine implementation handoff | Engine repository `IMPLEMENTATION_STATUS.md` |

Keep old evidence as history. When status changes, add a dated entry and update the current summary rather than rewriting past results as if they never happened.

## Beta.3 release checkpoint

- **Source promotion:** complete; engine was pushed to `main` before the app branch fast-forwarded `main`, and both remotes now match the release pins.
- **Local source/package gates:** passed with the counts above. The initial test attempts exposed a stale deterministic-order assertion and a missing test environment variable; both were corrected before the passing full runs.
- **Hosted CI:** blocked before steps ran for both repositories. No CI pass is claimed.
- **Visible UI and installed updater:** pending. The prior beta.2 app was visibly still generating; it was left untouched to avoid losing work or starting a second app. The updater feed endpoint returned the beta.3 Setup URL, but no install/restart was performed.
- **Live model measurement:** not run for this release. Preserve the user's selected context/output/reasoning and any active model run.
- **Release:** public beta.3 is live, non-draft, and not GitHub-flagged as a prerelease so the configured updater feed can discover it. Beta designation remains in SemVer/tag/title.
- Next after the existing task is idle: open one beta.3 packaged instance, finish the visible workflow and updater canary, then continue core harness reliability work. Do not reopen the old instance while the task is active.

## Ordered completion plan

### Gate 1 — Reconcile and promote the current source batch

1. Inspect both worktree histories and diffs, verify the app pin matches engine commit `e5158359cca2e780ca506cfd98e8b8015c63852a`, and confirm no unrelated/user data is included.
2. Run the full verification set in Gate 2 against these exact commits. Fix failures before promotion; do not merge based on a green subset.
3. Push/promote the engine commit first so CI can fetch it. Then promote the app commits whose workflows and package pin that immutable SHA. Preserve the separately published `main` histories and release baseline.
4. Record final branch/commit IDs and evidence in both repositories. **Completed for beta.3:** engine main `742ddb5`; app main/tag `7a698c3`.

### Gate 2 — Source and fault-injection verification

For the next source change, run engine pytest; app sidecar pytest; renderer/Vitest; TypeScript typecheck; workflow validation; and focused fault-injection for:

- Ollama request options: selected context/output actually reach the request/runtime, reasoning remains unset unless explicitly supported and selected, and no unsolicited model load/unload occurs.
- Tool protocol and schema errors, multiple calls, MCP discovery/calls/cleanup, long streamed command output, Unicode, and honest partial/failed/verified outcomes.
- Cancellation before worker start, during model streaming, and between tools; save/checkpoint ordering; approval continuation; no prose interpreted as authorization.
- Restored transcript turn mapping, full operation details, session migration, crash recovery, mirror conflict, project switching, and workspace boundaries.
- Recent live-catalog, stale GGUF, approval state, window-control bridge, and canceled-turn renderer regressions.
- Task checkpoint continuation/legacy migration, compaction disclosure, journal replay and Unicode, interrupted model/tool operations, one/both mirror failures and Windows sharing violations, final-response replay, Plan event propagation after resume, and durable exact-vs-estimated usage telemetry.

**Beta.3 local source checks passed.** Hosted CI remains blocked before runner startup; never count that as a pass. Recheck the hosted runner on the next update.

### Gate 3 — Build and inspect the packaged application

- Build from the promoted app commit and exact engine SHA.
- Inspect Windows x64 Setup, Squirrel manifest and package, portable ZIP, checksums, and bundled Python worker JSONL ready/ping/shutdown.
- Verify first-run setup/repair messaging, one-instance lifecycle, no model load on launch, and no stop/unload of externally loaded models.
- Keep generated artifacts out of source history unless repository policy explicitly requires otherwise.

**Beta.3 package gate:** passed locally; assets are published and their GitHub digests match the built artifacts. The Setup is unsigned.

### Gate 4 — Full visible user workflow

Use one newly built packaged app instance and a disposable empty project. Close stale Workbench instances before opening it; do not create duplicate windows. Keep the user's PC available and do not steal focus if they are actively using it. Record screenshots without private paths or credentials.

**Beta.3 visible gate:** pending because the existing app window had an active generation. Preserve that run and do not launch another instance until it is idle or the user closes it.

1. Home: navigate into a workspace and back Home; verify recents persist independently, unavailable workspaces remain visible, and model dots show the actual zero/one/many installed models. Click a model dot and inspect the correct model details.
2. Session: send a short hello, create a coding task, and verify model selection, captured context/output/reasoning, project path, and session identity.
3. Live work: observe first-token/waiting/generating state, live transcript, compact tool rows appearing at the operation's location, worksheet plan/activity/resource updates, and scroll-follow behavior.
4. Approval and edits: verify action approval cannot dismiss by backdrop/Escape, approve a bounded file operation, inspect the diff, and confirm the exact changed project files.
5. Verification: approve a relevant command and see live stdout/stderr, exit status, and a truthful distinction between command completion and passing tests.
6. Stop/recovery: exercise continue, cancel-and-save, and finish-current-operation choices; test close/hide/reopen and resume. Confirm completed operations are not replayed and uncertain writes require review.
7. Isolation/persistence: switch projects and sessions, close/reopen the same app, and verify transcript rendering, activity placement, settings, and history remain bound to their original workspace/session.
8. Settings/update: verify no setting silently changes and test installed-app update discovery/download/user-controlled restart only when a valid release feed is available.

### Gate 5 — Approved exact-model live measurement

Only after source, package, and visible workflow gates pass, perform the previously approved coding check with the exact approved model. Capture the actual request settings and runtime-effective context, first-token delay, generated tokens/second, total wall time, CPU/RAM/GPU/VRAM, and task result. Preserve any model that was already loaded. Do not adjust the user's selected input/output or reasoning values to make a test easier; record inability to allocate selected context as an explicit result.

### Gate 6 — Public release candidate

Follow [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md). Beta.3 was published at the user's request before visible acceptance and installed-update canary; its release notes state these limitations. For subsequent releases, reconcile source, version manifests, engine SHA, changelog, screenshots, licensing, security reporting, installer, update assets, and checksums. Run visible app acceptance before tagging; the actual update canary runs immediately after publication. The GitHub Release prerelease flag remains off under the current updater policy. A docs-only commit never creates a release tag.

## Core harness work after the current batch

**Earlier 2026-11-01 source batch (engine `b051d9663f0d4a00a4e89de8350f254ec88fd240`, app pin synchronized):** task checkpoints now reach the inference engine, compaction includes an explicit continuity checkpoint, app/project event journals retry per mirror, and usage/cache/input estimates are persisted for session restoration. Workbench skill enable/source controls and persistent session run-settings save are added; disabled skills are excluded from the captured model toolset. Terminal turns also report observed outcomes separately from run completion, and stale plans are cleared when a new task begins. Task intent is explicit and persisted; explicit Plan/Implement tasks get a visible host checklist while Automatic mode uses agent-authored structured plans and observed project operations instead of prompt keyword detection. Read-only access hides mutation/command schemas and MCP tools. Terminal verification records project-change, post-change-inspection, and approved-command evidence; an implementation request with no host-observed change is labeled incomplete, while a successful command is never treated as proof of passing tests. Durable per-request prompt provenance records actual message roles and sizes, project instruction/retrieval paths, checkpoint/compaction status, exact skill catalog inclusion, retained skill-load references, and tool/MCP names without duplicating prompt text. Richer task-specific acceptance criteria and exact prompt-content viewing remain open. Source changes and regression cases are still unverified; tests, typecheck, package, visible UI, and live-model gates remain queued until implementation is complete. The configured model context/output/reasoning settings and runtime placement remain unchanged.

**Earlier follow-up engine source (commit `ef711bda954a2eba289760221813de5d20239d48`, paired app pin updated):** implementation commands are now treated as possible project side effects even when structured file tools did not observe a write. The engine stores exact command arguments and subsequent inspection targets, requests one bounded inspection after a possible effect, and reports command-only work as `implementation_unverified`; failed commands can leave partial files and remain `command_failed`. This is still source-only: tests, typecheck, package, visible workflow, and live-model checks remain queued.

**Earlier paired source pin `e9c02cd936fd8404d4e3c152801d05ef2b900ac1`:** plans now support agent-defined task acceptance criteria that persist through compaction, mirrored activity replay, and session restore; new task snapshots explicitly clear prior criteria. The Plan panel separates these criteria from progress steps. Review also found and fixed a registry plan-state initialization gap before the first model request. Regressions are queued, not run; no package, visible UI, or model check has been performed for this source.

**Earlier paired source pin `536b37050566e64c67476de013629a83c089089b`:** approved commands canceled after launch or terminated by timeout now report uncertain side effects, trigger a bounded inspection request, and surface a warning; a command canceled before execution remains a clean cancellation. Regression coverage is queued. No tests or app/model runtime check has been run.

**Prior paired source pin `d4bf35cfb7d949b71a2e98242b0ccff421b1296a`:** the active-task compaction checkpoint now tells the model to inspect saved results and workspace state before repeating an operation marked uncertain, and explicitly forbids automatic replay. A continuity regression is queued; this change has not been tested.

**Latest paired source follow-up:** exact provider request settings and returned usage are linked to durable prompt activity; long provider waits have no implicit generation deadline. Approved commands have no implicit runtime cap. MCP uncertainty/schema gaps are surfaced; active-task compaction retrieves saved results and can recover omitted checkpoint and transcript sections; long activity timelines render progressively. Telemetry separates device-wide GPU load from shared runtime worker CPU/RAM and NVIDIA worker-process VRAM where available. The paired source uses engine `b3057bd322b470cd444e7c3448070d658ee546b4`; Automatic implementation continuation uses agent-authored plans and observed operations instead of prompt keywords, and the host seeds a visible checklist before an Automatic-mode structured write when the model did not plan first. Selected Ollama context/output/temperature remain authoritative. Plans may be repeatedly expanded/revised and host progress uses stable phase metadata; concurrent interrupted operations are preserved individually. Default repository scans have no hidden file/byte ceiling; cancellable independent read batches can execute concurrently, while changes, commands, MCP, and permission-sensitive actions remain ordered. Small-model workflow guidance recommends batching independent tool requests. Safe read batches are drained before finish-after-operation stops before another inference request. Tool schemas now adapt to the selected input budget: core project workflow schemas remain first, optional built-in/MCP schemas can be paged and selected via `load_tools`, the default catalog page fits the response budget without a fixed count, and exact selected/deferred sets persist in provider activity. Failure to fit required schemas is explicit and does not change context/output. Checkpoint compaction budgets only inference copies and reports omissions while preserving canonical plan/history for paging, including at very small projection budgets. Tool excerpts use actual remaining context while full operation results remain recoverable. Structured clarification is durable and recoverable without treating a question as an uncertain workspace side effect. True Windows process containment is still pending. Regression, typecheck, package build, visual acceptance, and hardware confirmation remain queued. No app/model/runtime or release verification has been performed; selected inference settings were not changed.

These remain required for the intended capable local coding-agent platform; they are not dropped because the immediate release gate is narrow.

1. **Permissions and containment:** persistent per-tool/path/command allow/ask/deny rules with hard-deny precedence, precise previews, and real opt-in Windows process containment. Clearly distinguish host execution from containment; approval alone is not a sandbox.
2. **Task correctness:** explicit workflow outcomes for discussion, plan-only, blocked, changed, inspected, command-completed, tests-passed, and verified. Use task-specific completion contracts and require evidence for claims.
3. **Workspace/session integrity:** finish crash/fault recovery, mirror conflict resolution, moved/copied workspace identity, unavailable/read-only projects, resumable operations, and no cross-project context/tool leakage.
4. **Provider/runtime capability:** capability discovery per runtime/model; explicit context overflow and unsupported-feature reporting; Ollama and local Hugging Face GGUF support; evaluate additional compatible runtimes by measured benefit without removing choices.
5. **Development tools:** first-party LSP diagnostics/navigation, browser/web research, question/ask-user, debugger/build/test profiles, and custom tools/plugins. Each requires an adapter, honest prerequisites, permissions, and end-to-end tests; MCP compatibility is not proof those tools exist.
6. **MCP reliability:** packaged stdio and supported HTTP lifecycle, credentials excluded from session mirrors, discovery errors, cancellation, timeout, cleanup, schema capability disclosure, and project-bound authorization.
7. **Long-run controls:** queue/steer/follow-up semantics, durable progress and cancellation, bounded-but-user-configurable operations, and recovery from model/server interruption without duplicate writes.

## Deferred product and repository backlog

Keep these visible, but work them after the current core gate unless evidence makes one a release blocker:

- **Runtime performance and caching:** controlled comparisons of context sizes, warm-model behavior, prompt-prefix reuse, provider-reported cached tokens, KV telemetry, GPU offload diagnostics, and opt-in model speed ranking. Keep measured throughput separate from code quality and task success. Do not enable cache or KV tuning without accuracy/memory A/B evidence.
- **Analytics:** local per-turn/session/model/lifetime usage and hardware metrics with estimates labeled, retention/export/delete controls, privacy review, and reproducible ranking conditions. Consolidate duplicate B-002/B-008 into one canonical analytics item; preserve historical notes.
- **Home and visual polish:** adaptive clickable model orbit and detail popover; zero/many model states; current-build README screenshots; light theme and small-model guidance mode; responsive worksheet section layout and customization. Keep private paths/credentials out of screenshots.
- **Chat quality of life:** compact inline tool activity, complete expandable results, restored Markdown/rich rendering, reader-controlled scroll-follow, keyboard shortcuts, and accessible keyboard/focus behavior.
- **Install and support:** first-run setup/repair diagnostics, updater recovery, signed Windows builds, supply-chain attestations/SBOM, macOS/Linux/ARM packaging, and clear model/runtime setup. Treat each platform/signing feature as separate scope and evidence.
- **Public repository quality:** align engine contribution/security guidance and issue/PR templates with the app; define labels and triage; add feature-request guidance, changelog/release-note ownership, dependency/advisory review, CI runner health, branch protection and required checks, screenshot provenance, and community support expectations. Popularity/trending cannot be guaranteed and is not evidence of quality.
- **Future architecture:** evaluate subagents only after single-agent reliability; later consider editor integrations and a TypeScript engine rewrite. Do not destabilize the V1 Python sidecar to pursue these early.

## Deferred acceptance matrix

| Evidence tier | Required proof | Current position |
|---|---|---|
| Source | Unit/integration/fault tests and typecheck on exact commits | Beta.3 local suites passed; hosted jobs failed before steps due to runner allocation |
| Package | Installer/ZIP/manifest/checksum and bundled worker | Beta.3 assets published; local build, worker smoke, and archive checks passed |
| Visible UI | Complete single-instance disposable-project workflow | Pending; existing beta.2 app was left undisturbed during its active task |
| Live model | Exact settings, response, task result, timing, and resource capture | User-reported long task completed; fresh controlled measurement pending |
| Installed update | Previous version discovers and applies a release safely | Feed returned beta.3 Setup URL; installed canary pending |
| Broad release readiness | Security/containment, parity, platform, and support scope | Not claimed; multiple core gaps remain |

### Approved-command side-effect evidence (source in progress)

Approved commands may change project files without producing structured `write_file`/`edit_file`/`apply_patch` evidence. The paired engine change records command arguments and inspection targets, requests a bounded post-command workspace inspection, and keeps command-only implementation outcomes explicitly `implementation_unverified`; a failed command warns that partial effects may remain. This does not claim exact command side effects or make command execution an OS sandbox. Regression coverage is queued with the final implementation verification; no tests, package, UI, or model run has been performed for this source change.

### 2026-11-01 active continuity implementation additions

- Plan activity cards expose recorded decisions and acceptance criteria after session restore; a missing snapshot can recover from the latest turn's journal event without reviving a deliberately empty or older plan.
- Checkpoint updates tolerate malformed legacy decision fields. Large project files use a context-derived per-call excerpt budget with UTF-8-safe streaming and a resumable line/column cursor. Selected context and output settings remain untouched.
- Added renderer, sidecar, and engine regression cases; all automated and packaged/visible verification remains queued until implementation is complete.

- Latest engine continuation work also applies the context-derived per-call budget to file listing/search and discloses every page or matching-line continuation, preserving the selected context/output values.

- Oversized operation results now remain fully journaled and visible while model-facing copies are excerpted with exact read_operation_result cursors; this avoids a single long command/MCP/search result exhausting the active task context.
