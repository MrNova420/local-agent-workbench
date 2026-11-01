# Product roadmap and release state

**Last reconciled:** 2026-10-31  
**Scope of this checkpoint:** documentation and planning only. No app settings, model configuration, source behavior, package version, tag, or release was changed.

This is the cross-repository execution order. It preserves the full approved product scope while separating core harness readiness from later parity and quality-of-life work. “Implemented in source” is not the same as tested, packaged, or accepted in a visible workflow.

## Current state

- The public desktop app is `v0.1.0-beta.2`; the public paired Python engine is MIT licensed. This checkpoint does not advance that version.
- The active app worktree is `workbench/core-chat-activity`. Its latest app change pins engine commit `e5158359cca2e780ca506cfd98e8b8015c63852a` in `core-revision.txt` and both GitHub workflows. The paired engine worktree has that commit. These post-beta changes are local branch history and are not yet part of the public beta/package.
- Recent changes include compact inline tool activity attached to its originating turn, persisted turn-to-activity mapping, live model-catalog refresh/deduplication and stale GGUF path filtering, hover-revealed window controls, an approval-safe prose-to-structured-command continuation, more accurate verification outcomes, and cancellation-before-worker-start state handling.
- Regression tests have been added for recent work but were deliberately queued. The current app and engine worktree commits have not been rerun through the full verification gate, packaged, or visibly accepted. No current-build result should be inferred from older beta.2 evidence.
- The source implementation preserves the user's chosen context/output and model-default reasoning. No token/reasoning/model settings were altered in this planning checkpoint.
- Hosted GitHub Actions previously could not acquire runners because of an account billing lock. Recheck this at the next verification pass; do not call a workflow pass if no runner starts.
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

## Ordered completion plan

### Gate 1 — Reconcile and promote the current source batch

1. Inspect both worktree histories and diffs, verify the app pin matches engine commit `e5158359cca2e780ca506cfd98e8b8015c63852a`, and confirm no unrelated/user data is included.
2. Run the full verification set in Gate 2 against these exact commits. Fix failures before promotion; do not merge based on a green subset.
3. Push/promote the engine commit first so CI can fetch it. Then promote the app commits whose workflows and package pin that immutable SHA. Preserve the separately published `main` histories and release baseline.
4. Record final branch/commit IDs and evidence in both repositories. This is source promotion, not a release.

### Gate 2 — Source and fault-injection verification

Run engine pytest; app sidecar pytest; renderer/Vitest; TypeScript typecheck; workflow validation; and focused fault-injection for:

- Ollama request options: selected context/output actually reach the request/runtime, reasoning remains unset unless explicitly supported and selected, and no unsolicited model load/unload occurs.
- Tool protocol and schema errors, multiple calls, MCP discovery/calls/cleanup, long streamed command output, Unicode, and honest partial/failed/verified outcomes.
- Cancellation before worker start, during model streaming, and between tools; save/checkpoint ordering; approval continuation; no prose interpreted as authorization.
- Restored transcript turn mapping, full operation details, session migration, crash recovery, mirror conflict, project switching, and workspace boundaries.
- Recent live-catalog, stale GGUF, approval state, window-control bridge, and canceled-turn renderer regressions.

Fix hosted runner availability or clearly preserve it as a blocked external CI gate with reproducible local evidence. Never claim hosted CI passed when it failed before a runner started.

### Gate 3 — Build and inspect the packaged application

- Build from the promoted app commit and exact engine SHA.
- Inspect Windows x64 Setup, Squirrel manifest and package, portable ZIP, checksums, and bundled Python worker JSONL ready/ping/shutdown.
- Verify first-run setup/repair messaging, one-instance lifecycle, no model load on launch, and no stop/unload of externally loaded models.
- Keep generated artifacts out of source history unless repository policy explicitly requires otherwise.

### Gate 4 — Full visible user workflow

Use one newly built packaged app instance and a disposable empty project. Close stale Workbench instances before opening it; do not create duplicate windows. Keep the user's PC available and do not steal focus if they are actively using it. Record screenshots without private paths or credentials.

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

Follow [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md). Reconcile source, version manifests, engine SHA, changelog, screenshots, licensing, security reporting, installer, update assets, and checksums. Test update from the existing public installer. Only after all release gates pass, select the next SemVer version, then create a new immutable tag that triggers publication. The GitHub Release prerelease flag remains off under the currently configured public updater policy. A docs-only commit never creates a release tag.

## Core harness work after the current batch

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
| Source | Unit/integration/fault tests and typecheck on exact commits | Newest regression batch queued |
| Hosted CI | Workflows complete on GitHub runners | Previously blocked before runner startup by account billing lock |
| Package | Installer/ZIP/manifest/checksum and bundled worker | Older beta.2 evidence exists; current source package pending |
| Visible UI | Complete single-instance disposable-project workflow | Older partial evidence exists; current source acceptance pending |
| Live model | Exact settings, response, task result, timing, and resource capture | User-reported long task completed; fresh controlled measurement pending |
| Installed update | Previous version discovers and applies a release safely | Pending |
| Broad release readiness | Security/containment, parity, platform, and support scope | Not claimed; multiple core gaps remain |
