# Product roadmap and release state

**Last reconciled:** 2026-11-01
**Current release:** `v0.1.0-beta.3` is published. This remains an unstable beta with visible app acceptance and the installed update canary open.

This is the cross-repository execution order. It preserves the full approved product scope while separating core harness readiness from later parity and quality-of-life work. “Implemented in source” is not the same as tested, packaged, or accepted in a visible workflow.

## Current state

- The public desktop app is `v0.1.0-beta.3`, released from app commit `7a698c3d8b704ad38003c9b9d4959209afa79fd4`; it is marked Latest on GitHub. The paired engine main branch now includes commit `742ddb55a0fcdd7d0d205b29c04228cef5b9c0ff`, including the exact `e5158359cca2e780ca506cfd98e8b8015c63852a` SHA pinned by the app.
- The app release contains Windows x64 Setup, Squirrel package/manifest, portable ZIP, and checksums. GitHub's beta.2 updater feed returned HTTP 200 with the beta.3 Setup URL; actual installed update/restart/data recovery is still unverified.
- Recent changes include compact inline tool activity attached to its originating turn, persisted turn-to-activity mapping, live model-catalog refresh/deduplication and stale GGUF path filtering, hover-revealed window controls, an approval-safe prose-to-structured-command continuation, more accurate verification outcomes, and cancellation-before-worker-start state handling.
- Local verification for beta.3 passed: 140 engine tests, 53 renderer tests, 45 sidecar tests, TypeScript typecheck, Windows package build, bundled worker ready/ping/shutdown, and Squirrel/ZIP integrity. Production dependency audit found zero vulnerabilities; 18 moderate findings remain in development dependencies.
- The beta.3 package was not launched because the only existing Workbench window was actively generating a user task. That run was preserved, no duplicate app was opened, and no candidate model request was made. Visible acceptance is still pending.
- The source implementation preserves the user's chosen context/output and model-default reasoning. No token/reasoning/model settings were altered in this planning checkpoint.
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
