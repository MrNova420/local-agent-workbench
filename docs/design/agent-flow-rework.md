# Agent Flow Rework — Design

**Status:** active staged rework; implementation and regression fixes are in progress.
**App branch:** `workbench/agent-flow-rework`, based on beta.4-candidate app commit `42c79b2`.
**Engine branch:** `workbench/agent-flow-rework`; app pin is `bbfaa8237a4932df793b759a2856c38bc1d9103a`.
**Last paired verification:** engine 433 passed + 12 subtests; sidecar 194; renderer 144; TypeScript typecheck clean. App rework branch pushed; beta/main untouched.

## Why

Observed on the developer's machine (Flint IQ2_XXS, ~12 GB model, 4 GB GPU → ~93% CPU / 7% GPU placement):

- Every model request waits 1–3 minutes between `prompt_manifest` ("Model request N") and `request_headers`. With the model resident, this is **prompt evaluation**, not model loading.
- The loop issues tiny tool batches per request (2 shell calls → approval → next request), so the toll repeats many times per task. A simple website task took 2–3 hours.
- Historical evidence is mixed: a controlled prefix pair once showed 93.4% reuse (prompt eval 91.5s → 7.0s), while other real requests reported 0 cached tokens. This rework found and fixed changing tool-schema selection, but **the new fix has not yet passed same-task live acceptance with exact provider cache-token counts**.
- The prompt resends the full system prompt (~8k chars measured), all tool/skill schemas, full transcript incl. reasoning, all tool results, and the checkpoint on **every** request, growing each turn.
- 65k-context UI behavior: presets above provider-reported metadata should be labeled, not blocked; verify the renderer does not hard-limit.

Root cause: the current flow treats every step as a fresh, fully reassembled request. The fix is structural, not prompt-tuning.

## Current flow (as implemented)

```
user send ──► AgentService (worker.py) ──► AgentEngine.run
                │  separate identity checks per path:
                │  run start (_run_request_identity), queue
                │  (consume_queued_prompt), steering, approvals
                ▼
        per request: full prompt assembly (system ~8k chars
        + all tool schemas + transcript + tool results +
        checkpoint) ──► Ollama /api/chat (stateless)
                ▼
        tool batch (often 1–2 calls) → approval → repeat
```

Key code: `sidecar/worker.py` (`AgentService`, `RequestScopedOllama`), `local-9b-dev-app/desktop_engine.py` (`AgentEngine.run`, `OllamaRuntime.stream` at L1671/1697, `ContextManager` L1500), `prompt_manifest.py`.

What stays (verified good, keep): dual-mirror persistence (app + project journals/snapshots), crash recovery, approval/permission model, "host is authoritative" tool validation, engine/sidecar split.

## Target flow

```
┌─ SESSION RUNNER (one per project session) ──────────────────┐
│ Inbox: send | steer | queue | approval | cancel             │
│   one durable admission point, idempotent by request ID     │
│   one replay/recovery path                                  │
│         ▼                                                   │
│ CONTEXT ENGINE                                              │
│   • stable prefix built once/session (system + tool schemas │
│     + compacted history); byte-stable by construction       │
│   • per-step deltas appended (new tool results, user steer) │
│   • background proactive compaction before the wall         │
│         ▼                                                   │
│ STEP LOOP (a turn = many steps, one continuous stream)      │
│   model → validated multi-tool batch → parallel safe exec   │
│   → results appended as delta → model continues             │
│   continuations are incremental suffixes, not reassemblies  │
│         ▼                                                   │
│ EXECUTION LAYER                                             │
│   parallel reads | batched independent writes | background  │
│   commands with reattach | MCP | skills on demand           │
│         ▼                                                   │
│ EVENT LOG → UI timeline (phases, timings, cache %, tokens)  │
│ durable, replayable, crash-safe                             │
└─────────────────────────────────────────────────────────────┘
```

### Stage 1 — Session runner
- Shared admission/identity/replay/queue primitives and a `SessionInbox` facade over serialized run-start replay/active-slot acquisition are implemented and regression-tested.
- Remaining for a durable unified inbox: move or explicitly adapt event admission, safe-boundary steering, queue delivery, approval/question, cancellation, and crash-recovery replay under a single session-owned contract. Preserve existing subsystem ownership until each migration has fault-injection coverage.

### Stage 2 — Context engine (biggest latency win)
- Keep tool-schema and skill-catalog selection stable per task; retain explicit tool loading and context-budget behavior.
- Trim the default prompt only after measuring its actual token contribution and preserving task capability.
- Design proactive compaction; do not replace safe-boundary compaction until tested.
- Keep continuation/checkpoint guidance suffix-only and preserve canonical history.
- Acceptance: a same-task multi-request run on installed Ornith 9B records exact `prompt_eval_count`, `prompt_eval_cached_count`, `prompt_eval_duration`, and header wait; target ≥80% cached from request 2 onward. This is pending.

### Stage 3 — Execution layer
- Batching policy: model encouraged/allowed to issue larger batches; parallel reads stay; add batched independent writes; background command reattach.
- Visible session inbox in the UI.

### Stage 4 — Visual flow (renderer)
- Per-phase timings in activity rows: dispatch → headers (with wait seconds) → first token → stream → tools.
- Show cached/evaluated prompt tokens + cache % per request (telemetry already plumbed: `generation_usage`).
- Real phase labels during waits; reasoning vs. progress distinction.

## Constraints
- No silent removal of documented behavior; parity register rows stay open until tested or explicitly marked incompatible.
- Keep context/output/reasoning user settings untouched; performance work must not change defaults.
- Ollama prefix caching is automatic but fragile (any byte change in the prefix invalidates); llama.cpp slot reuse is controllable. Worst case on Ollama still wins via fewer/fatter requests + leaner prompt.
- Approval ≠ containment; no auto-approval expansion in this rework.

## Risks
- Engine `AgentEngine.run` is a single 2,577-line module; Stage 1/2 require careful extraction with the existing test suites as the net (engine ~425 tests, sidecar ~168, renderer ~139 at last recorded run).
- Renderer/sidecar protocol changes must remain backward-compatible with saved journals (recovery replays old events).

## Alignment with the existing backlog (2026-11-07 review)

Full pass over `PRODUCT_BACKLOG.md`, `MASTER_ROADMAP.md`, `DECISIONS.md`, and the acceptance/readiness records confirms:

- The backlog's grouped-verification convention (author regressions as you go, run one coordinated pass) is adopted for every stage of this rework.
- The backlog says "finish steering/queue crash/cancel acceptance instead of redesigning a durable inbox." This design deliberately supersedes that with Stage 1's unified inbox: the steering/queue behavior is preserved, but its scattered identity checks (`_run_request_identity`, `consume_queued_prompt`, per-path turn bindings) are the accumulated special cases Stage 1 consolidates. Recorded here as a design decision; carry D-00x entry into `DECISIONS.md` when implementation starts.
- Backlog items that fold into this rework rather than duplicating it: B-009 (small-model workflow/cache telemetry, prompt-prefix stability A/B), B-011 (KV/cache telemetry surfacing — Stage 4), B-021 (long-run composer/transcript recovery defects — must be reproduced before Stage 2 touches context paths), B-004 (GPU offload measurement — hardware context for the 1–3 min toll), B-012 (capability registry/containment — post-rework), B-008/B-002 (warm preload + analytics — align with Stage 2/4).
- Active release blockers that stay independent of this branch: r3 packaged first-response failure, launch-identity collision, beta.4 gates. This branch must not be used to claim those closed.
- Decision-log constraints honored: D-003 (no auto-load change beyond B-008's warm-on-select; keep-alive already sent), D-004 (approval/isolation unchanged), D-006 (Windows x64 updater untouched).

## Stage 1 progress (updated 2026-11-10)

- `sidecar/run_inbox.py` owns shared run request identity/fingerprinting, run-start replay decisions, queued-prompt validation/consumption/mutation, active reply identity checks, and steering validation/prior-update lookup.
- `SessionInbox` now serializes run-start replay and admission, performs the busy-slot replay recheck, and guarantees active-slot release on failed or non-started results. `worker.py` lock attributes remain compatibility aliases; operation/persistence/safe-boundary behavior remains in the worker/engine.
- A dedicated same-request concurrency regression confirms retries wait for in-progress admission and replay instead of double-starting. `tests/test_run_inbox.py`: **25 passed**.
- Stage 1 is **admission-facade complete, durable-inbox incomplete**: event journal, steering delivery, approval lifecycle, cancellation, and recovery remain owned by their current subsystems. Do not describe this as a unified durable inbox until those paths are explicitly migrated and fault-tested.
- Latest grouped suites after Stage 1 facade and telemetry update: engine **433 + 12 subtests**, sidecar **194**, renderer **144**, TypeScript typecheck clean. Engine calibration scope is regression-tested; app pin is `bbfaa82`.

## Stage 2 implementation notes (reviewed 2026-11-10)

- `OllamaRuntime.stream` sends full `messages` and selected tool schemas on each stateless request, with `keep_alive` defaulting to 30m. Stable-prefix reuse can reduce re-evaluation, but does not avoid retransmitting request JSON.
- Runtime emits `request_headers` with `header_wait_seconds`; desktop `RequestScopedOllama` emits exact `generation_usage`. The corrected live probe wraps this same adapter behavior; the old direct-engine probe did not.
- Tool schemas were prompt-relevance ranked each request. `AgentEngine` now retains the task's initial selection, merges explicitly requested `load_tools` schemas, checks budget, and updates deferred names. If a newly loaded schema cannot fit, selection must fail/recompute without silently omitting it.
- Other cache-risk surfaces still require real same-task measurement: message history growth, checkpoint suffix, compaction, tool results, skill text, and provider template behavior. Byte-stable tool schema alone is not proof that the entire prompt cache reuses.

## Recovered audit queue (project-wide, still open)

- Cross-repo architecture and source maps: `docs/ARCHITECTURE.md`, engine README/IMPLEMENTATION_STATUS, Electron boundary, sidecar protocol, persistence and provider modules.
- Current feature/status sources: PRODUCT_BACKLOG, MASTER_ROADMAP, CORE_HARNESS_READINESS, FULL_PRODUCT_PARITY_AUDIT, MODEL_RUNTIME_EXPANSION, SESSION_CONTINUITY_IMPLEMENTATION, DECISIONS, ACCEPTANCE_LOG, RELEASE_RUNBOOK, README/SECURITY/CONTRIBUTING, engine docs and tests.
- History and left-behind work: review recent app and engine commits, active/past branches, deferred test notes, all backlog IDs and unverified release logs. Identify superseded statements but preserve them as history.
- Outstanding concrete items: B-021 queue/reasoning close/reopen acceptance; exact context-limit behavior (source suggests custom values above 65k are allowed); beta.4 candidate launch identity, first-response, updater and install gates; Windows command/MCP containment; full parity requirements. These are not closed by the rework source tests.

## Open items to verify during implementation
1. Why cache misses in real runs (hypotheses: per-request checkpoint/user-context suffix placement, tool-schema ordering, skill-catalog churn, timestamp-bearing fields in prefix messages).
2. 65k context renderer limit — label vs. block.
3. r3 packaged first-response failure (runner "Stopping...") — reproduce with saved traceback before Stage 2 perf claims.
4. Launch-identity collision (candidate exe opens installed beta.3) — blocks visible acceptance of any stage.

## Baseline verification (2026-11-08; latest paired pass 2026-11-10)

Branch cut at app `42c79b2` / engine `1c0774b`. Original baseline: engine **425 passed + 12 subtests**, renderer **139**, sidecar **168**, typecheck clean. Latest after rework: engine **433 + 12**, renderer **144**, sidecar **194**, typecheck clean. Source verification only; package and visible acceptance remain separate gates.

## Stage 2 — root cause found and fixed (2026-11-08)

**Confirmed cache killer:** `AgentEngine._tools_for_request` re-scored tool schemas
against the evolving task prompt on **every** request. The selected subset and order
changed as prompts changed, and since chat templates render the tools array early in
the prompt, Ollama's automatic prefix cache was invalidated on every tool-loop request
→ 0% cached tokens → full re-evaluation of ~15–25k tokens per request (~1–3 min on the
dev machine's CPU-heavy runner).

**Fix (engine `1a4f939`, app pin advanced):** tool selection and inline skill-catalog
text are now computed once per task and reused byte-identically while they fit the
budget ("sticky selection"). Explicit `load_tools` selections still recompute; budget
overflow falls back to recomputation; deferred schemas stay reachable. Red/green
regression added (`tests/test_tool_schema_stability.py`). Full engine suite: 427+12.

**Remaining Stage 2 items:** verify actual same-task cache reuse with exact provider counters; assess system prompt token contribution before any trim; then packaged visible acceptance. The earlier planned Flint acceptance is superseded by the user's instruction to use Ornith 1.5 9B.

## Stage 2/4 progress update (2026-11-10)

- Message-prefix architecture is contract-tested: deterministic system prompt, request-local continuation suffix does not mutate canonical history, and provider-only metadata is stripped.
- Stage 4 initial UI slice: compact request rows show exact provider cache percentage and header-wait latency; details show cached and total tokens. Source tests exercise the real summary helper; packaged visual acceptance remains open.
- Sticky tool selection preserves explicitly loaded schemas and removes them from deferred tools; regression covers evolving prompts, actual `load_tools`, and the subsequent stable request. App Stage 1 commit `5b17749`; engine pin `3aa0ebc`.
- B-021 source regression exists for sealing one assistant request segment before reconciling the next; stale queued-item recovery has source tests. Both still need visible packaged/reopen acceptance. Next: same-task Ornith cache acceptance only when it can run without displacing a resident model; complete inbox event/steer/approval/recovery design and fault coverage; package/visible acceptance; then Stage 3 and remaining Stage 4.

## Live cache acceptance — NOT PASSED (corrected 2026-11-10)

The previous 42.0s → 3.1s observation is **retracted as cache-acceptance evidence**.
That probe used two separate `AgentEngine` instances and tasks, chose the first
installed Qwen model rather than Ornith, and failed to capture the provider usage
event. It measured header wait only; it did not establish cache reuse or same-task
prefix stability.

`live_cache_check.py` was rewritten to use one engine across two user messages and
capture exact provider usage. It refuses to load or evict a model. Ornith is installed
as `ornith-1.5-9b-q4-k-m:64k`, but was not resident on the last check; Qwen was
resident, so the live run was correctly deferred and no model was displaced.

Verified: sticky tool-schema selection and explicit `load_tools` regression tests;
message-prefix contract tests; exact renderer summary tests; grouped source tests.
Still required: same-task Ornith run with exact cache counts/timing, package the
fix, then visible packaged acceptance. Code-level tests alone do not prove a
performance improvement.
