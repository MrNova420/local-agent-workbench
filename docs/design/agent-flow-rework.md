# Agent Flow Rework — Design

**Status:** planning / design only. No behavior changes yet.
**Branch:** `workbench/agent-flow-rework` (cut from `origin/workbench/core-chat-activity` at `42c79b2`, "prepare beta.4 release candidate").
**Engine pair:** `local-9b-dev-app` (`4348529` at time of writing).

## Why

Observed on the developer's machine (Flint IQ2_XXS, ~12 GB model, 4 GB GPU → ~93% CPU / 7% GPU placement):

- Every model request waits 1–3 minutes between `prompt_manifest` ("Model request N") and `request_headers`. With the model resident, this is **prompt evaluation**, not model loading.
- The loop issues tiny tool batches per request (2 shell calls → approval → next request), so the toll repeats many times per task. A simple website task took 2–3 hours.
- Live runs report **0 cached prompt tokens** in real tool-loop requests, while a controlled warm-prefix test showed 93.4% reuse (prompt eval 91.5s → 7.0s). Prefix caching works when the prefix is byte-stable; real runs break it.
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
- One inbox; all current identity checks consolidate into admission (send/steer/queue/approve/cancel become inbox items with request IDs and content fingerprints).
- Behavior-preserving. Suite green before Stage 2.

### Stage 2 — Context engine (biggest latency win)
- Build stable prefix once per session; enforce ordering so Ollama's automatic prefix cache engages (target: verify `prompt_eval_cached_count` > 0 on real tool-loop requests 2+).
- Trim default prompt: system prompt budget, tool/skill schemas paged on demand.
- Proactive background compaction (before context exhaustion), replacing mid-task stalls.
- Continuation/checkpoint requests append a suffix only.
- Acceptance: a multi-request task shows ≥80% cached tokens from request 2 onward on Flint; per-request `header_wait_seconds` drops from ~90–130s to <15s on warm prefix.

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

## Stage 1 progress (2026-11-08)

- `sidecar/run_inbox.py` introduced as the admission-primitives module: run request identity/fingerprint, queued-prompt validation/consumption/mutation, run-start replay decision, and active-run reply identity validation. `worker.py` keeps compatibility aliases; call sites now delegate.
- Consolidated so far: run admission identity + replay, queue add/remove/consume, question-reply and cancel identity binding. Next: steering acceptance binding and approval-reply identity, then the single `SessionInbox` facade over `run_admission_lock`/`run_lock` in `handle("run_start")`.
- 13 focused unit tests added (`tests/test_run_inbox.py`). Grouped passes recorded at each commit; behavior unchanged.

## Stage 2 preparation notes (from code read)

- `OllamaRuntime.stream` (engine `desktop_engine.py` L1697) sends full `messages` + all tool schemas every request with `keep_alive` 30m; `request_headers`/`header_wait_seconds` and `generation_usage` (incl. `prompt_eval_cached_count`) are already emitted — Stage 4 only needs UI surfacing.
- Cache-miss suspects to verify first: message-array prefix stability across requests (system message position/content, tool-result message field ordering), per-request checkpoint/user-context suffix placement, and tool-schema ordering (`registry.schemas + mcp_tools` order).

## Open items to verify during implementation
1. Why cache misses in real runs (hypotheses: per-request checkpoint/user-context suffix placement, tool-schema ordering, skill-catalog churn, timestamp-bearing fields in prefix messages).
2. 65k context renderer limit — label vs. block.
3. r3 packaged first-response failure (runner "Stopping...") — reproduce with saved traceback before Stage 2 perf claims.
4. Launch-identity collision (candidate exe opens installed beta.3) — blocks visible acceptance of any stage.

## Baseline verification (2026-11-08, this branch)

Branch cut at app `42c79b2` / engine `1c0774b`. Grouped baseline pass on this machine:
engine **425 passed + 12 subtests** (54s), renderer **139 passed** (22 files), sidecar **168 passed** (89s), TypeScript typecheck clean. This is the green reference for all rework stages.

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

**Remaining Stage 2 items:** verify message-array prefix stability for the *system
message and transcript* (next suspected source: per-request checkpoint/user-context
suffix placement), leaner default system prompt, then live Flint acceptance measuring
`prompt_eval_cached_count` ≥80% from request 2 and header wait <15s warm.
