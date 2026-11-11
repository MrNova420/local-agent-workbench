# Platform v1 — Concrete Specification

**Companion to `separate-platform-v1-design.md`.** Where that document sets vision, principles and architecture, this one specifies the parts a builder would otherwise invent inconsistently: screen flows, the event protocol, the state schema, and per-phase acceptance tests.

**Status:** draft for review. No code exists. Live model runs are paused by user instruction, so nothing here has been validated against a running model.

---

## 1. Screen flows

Five screens. Each has one job; nothing is combined for convenience.

### 1.1 Project switcher (home)

```
┌────────────────────────────────────────────────────────────────────┐
│  Projects                                    [Open folder] [New]  │
├────────────────────────────────────────────────────────────────────┤
│  ▸ workbench-core          git:main ↑2   ● 3 active tasks          │
│      last: "fix streaming parser" 2h ago · 1 checkpoint            │
│  ▸ api-gateway             git:feat/x    ● needs approval (1)      │
│      last: "add rate limiting" 1d ago · toolchain ready            │
│  ▸ old-experiment          git:main      ⚠ workspace moved         │
├────────────────────────────────────────────────────────────────────┤
│  Runtime: Ollama ✓ 3 models · llama.cpp ✓ · Host boundary: SANDBOX │
└────────────────────────────────────────────────────────────────────┘
```

One job: **get into a project without ambiguity about its state.**
Must show before entry: git state, active/blocked task count, workspace availability, and the current execution boundary.

### 1.2 Project workspace (task list)

```
┌─ project: workbench-core ──────────────────────────────────────────┐
│  Tasks                    │  Project                             │
│  ─────────────────────    │  instructions: AGENTS.md, 4 files    │
│  ● running  fix parser    │  skills: 6 discovered, 2 enabled     │
│  ⏸ blocked  add limits    │  tools: 11 core · 2 packs · 34 MCP   │
│  ✓ done     rename opts   │  context: 65,536 (model max 262,144)  │
│  + New task               │  boundary: sandbox (docker)          │
└───────────────────────────┴──────────────────────────────────────┘
```

One job: **choose the task** while seeing what constrains it (instructions, skills, tool budget, boundary).

### 1.3 Active task — the work ledger

The central screen. Three columns, fixed.

```
┌─────────────────────┬────────────────────────────────┬──────────────────────┐
│ GOAL & PLAN         │  WORK LEDGER                   │  EVIDENCE            │
├─────────────────────┼────────────────────────────────┼──────────────────────┤
│ Fix the streaming   │  09:12 user                    │  CHANGED FILES (3)   │
│ parser dropping     │   "fix the parser that drops   │  M src/parse.ts  +42 │
│ partial lines       │    partial lines"              │  M test/parse.ts +18 │
│                     │                                │  A fixtures/x.json   │
│ ▸ plan              │  09:12 ↳ context               │                      │
│  ✓ read parser      │   11 tools · 8,240 tok prefix  │  CHECKS              │
│  ✓ reproduce        │   cache: warm                  │  ✓ unit  24 passed   │
│  ● patch decode     │                                │  ✓ lint  clean       │
│  ○ add test         │  09:13 model request 1         │  ✗ e2e   not run     │
│  ○ verify           │   headers 1.2s · eval 3.4s      │                      │
│                     │   4,100 cached (68%) · 206 out  │  BOUNDARY            │
│ acceptance          │                                │  sandbox: docker     │
│  · partial lines    │  09:13 tool run_shell          │  fs: workspace only  │
│    preserved        │   "npm test" → 3 fail          │  net: off            │
│  · no regressions   │   [approved 09:13]             │                      │
│                     │                                │  RECOVERY            │
│ ── controls ──      │  09:15 model request 2         │  checkpoint 09:13    │
│ [Steer] [Queue]     │   headers 0.4s · eval 0.9s      │  (files + turn)      │
│ [Cancel] [Stop>op]  │   3,980 cached (97%) · 118 out  │                      │
│                     │                                │  [restore…]          │
│                     │  09:16 ✓ complete               │                      │
│                     │   3 files · 24 tests · 1 unrun  │                      │
└─────────────────────┴────────────────────────────────┴──────────────────────┘
```

One job: **answer "what is it doing, what did it change, what proves it worked?" without reading the transcript.**

Non-negotiables in this screen:
- Phase and timing on **every** model request row (`headers`, `eval`, cached %, output tokens).
- Tool rows show the **exact command** and the approval decision with timestamp.
- Evidence column is **observed**, never narrated: changed files from the tool layer, checks from actual runs, `not run` stated explicitly.
- Boundary column is always populated, even when it says "uncontained".

### 1.4 Approval dialog

```
┌────────────────────────────────────────────────────────────────┐
│  Approval required — run_shell                                 │
├────────────────────────────────────────────────────────────────┤
│  Command                                                       │
│  npm test -- --reporter=verbose                                │
│                                                                │
│  Working directory                                             │
│  C:\proj\workbench-core                                        │
│                                                                │
│  This will                                                  ⚠ │
│  · use your Windows account                                    │
│  · reach the network                                           │
│  · write to node_modules, coverage/                            │
│  Boundary: sandbox (docker) — filesystem limited to workspace   │
│                                                                │
│  [Deny]  [Approve once]  [Approve for task]  [Approve always…] │
└────────────────────────────────────────────────────────────────┘
```

One job: **state the consequence before the consent.**
Rules: cannot be dismissed by backdrop or Escape; every button names exactly what it grants; "Approve always" opens a scoped rule editor, never a blanket grant; boundary line is generated from the actual backend, not a template.

### 1.5 Recovery dialog

```
┌────────────────────────────────────────────────────────────────┐
│  Interrupted — 1 operation had uncertain effects               │
├────────────────────────────────────────────────────────────────┤
│  run_shell  npm run migrate   started 09:41, no completion     │
│  It may have partially completed. Nothing will be re-run.      │
│                                                                │
│  Affected paths (observed before interruption)                 │
│  db/schema.sql                                                 │
│                                                                │
│  Restore options                                               │
│  ( ) Files only — revert to checkpoint 09:38, keep conversation │
│  ( ) Files + conversation — revert both                        │
│  ( ) Keep files — resume with the uncertain operation flagged   │
│                                                                │
│  Not restorable: database state, network effects               │
│                                                                │
│  [Inspect workspace first]  [Continue]                         │
└────────────────────────────────────────────────────────────────┘
```

One job: **prevent a blind retry and state exactly what restore cannot fix.**
Non-negotiable: "Not restorable" line is mandatory. Reusing the Lovable database caveat pattern.

---

## 2. Event protocol

Everything the UI shows derives from an append-only event log. One envelope, typed payloads.

### 2.1 Envelope

```ts
type Event = {
  v: 1                      // format version — migrations key off this
  id: string                // monotonic per session (ULID)
  sessionId: string
  taskId: string
  parentId: string | null   // fork/branch provenance
  source: 'input' | 'loop' | 'update' | 'fork' | 'system'
  seq: number               // gap detection
  at: number                // epoch ms, from the runtime clock not the renderer
  type: EventType
  payload: unknown
}
```

`source` and `parentId` are copied from LangGraph's checkpointer because they make forks and "restore history only" unambiguous. `seq` gives gap detection for free; a missing seq is a corrupted session, surfaced rather than silently patched.

### 2.2 Event types

| Group | Types | Required fields |
|---|---|---|
| Session | `session.created`, `session.settings` | model, provider, context, output, reasoning, boundary, approvalMode |
| User | `user.message`, `user.steer`, `user.queue`, `user.cancel`, `user.stop_after_op` | text, clientRequestId |
| Context | `context.assembled`, `context.compacted`, `context.tools_loaded` | prefixHash, toolNames, estTokens, omissions, cacheExpectation |
| Request | `request.prepared`, `request.dispatched`, `request.headers`, `request.stream_ended`, `request.failed` | requestIndex, headerWaitMs, httpStatus, failurePhase |
| Usage | `request.usage` | promptTokens, cachedTokens, evalMs, outputTokens, loadMs |
| Assistant | `assistant.reasoning`, `assistant.text`, `assistant.tool_call` | delta or complete |
| Tool | `tool.proposed`, `tool.approved`, `tool.denied`, `tool.started`, `tool.output`, `tool.completed`, `tool.failed`, `tool.uncertain` | operationId, toolName, args, effectClass |
| Files | `files.changed` | paths, added/modified/deleted, bytes |
| Verification | `check.started`, `check.result` | command, exitCode, passed/failed/skipped counts |
| Plan | `plan.updated` | items[], acceptanceCriteria[] |
| Checkpoint | `checkpoint.created`, `checkpoint.restored` | scope: files / files+conversation / full |
| Terminal | `task.completed`, `task.failed`, `task.cancelled`, `task.blocked` | outcome, evidence summary |

### 2.3 Invariants (enforced by tests, taken from AG2's replay table)

1. A `tool.completed` **must** follow a `tool.started` for the same `operationId`.
2. A `tool.output` must never appear without its `tool.started`.
3. `assistant.tool_call` must be followed by a matching tool lifecycle or an explicit `tool.uncertain`.
4. `request.usage` must carry `requestIndex` matching a prior `request.prepared`.
5. `checkpoint.restored` must name the scope it restored.
6. No event may be mutated after append. Corrections are new events.
7. A terminal task event must carry an evidence summary — never a bare "done".

These are the orphan-state bugs that make local models hallucinate missing steps. They belong in the test suite, not in review.

### 2.4 Derivation rule

> The UI is a **pure function of the event log**. If a screen shows something not derivable from events, it is either a bug or an unlogged side channel.

This is the single rule that prevents the drift our current app's activity rows and transcript occasionally suffer from.

---

## 3. State schema

### 3.1 Session snapshot (derived, replaceable)

```ts
type SessionSnapshot = {
  v: 1
  id: string
  parentId: string | null
  branch: string            // 'main' | 'retry-1' | ...
  createdAt: number
  project: { root: string; identity: string; gitRef: string }
  settings: {
    model: string; provider: string
    context: number; output: number; reasoning: string | null
    boundary: 'uncontained' | 'worktree' | 'sandbox' | 'remote'
    approvalMode: 'per-action' | 'per-task' | 'per-session'
  }
  turnCursor: string        // last event id folded in
  plan: PlanItem[]
  acceptanceCriteria: string[]
  operations: OperationRef[] // completed + uncertain, with operationIds
  changedFiles: string[]
  verification: VerificationRef[]
  contextLedger: {
    prefixHash: string       // changes here invalidate cache — asserted in tests
    residentTools: string[]
    loadedTools: string[]
    compactions: Array<{ at: number; omittedTurns: number; overlapTurns: number }>
  }
}
```

Snapshots are **derived and disposable**. The log is the truth; a snapshot is a fast-start cache. If a snapshot is missing or stale, replay rebuilds it. This avoids the current design's problem where snapshot and journal can disagree.

### 3.2 Scoped state

| Scope | Lifetime | Examples |
|---|---|---|
| `app:` | install | model catalog, provider config, permission rules |
| `user:` | across projects | preferred boundary, approval defaults |
| `project:` | project | instructions discovery, skill enablement, tool packs |
| `temp:` | current run | current request index, streaming buffers, retry attempt |

`temp:` never persists into a snapshot. Anything that must survive compaction is explicitly `project:` or `app:`.

---

## 4. Request pipeline

The pipeline exists to make the 1–3 minute problem attributable, not to hide it in one phase.

```
build context projection
  ├─ stable prefix (system + tools tier0 + history head)   → hash recorded
  ├─ append deltas (recent turns, tool results)
  └─ append discovered tools at TAIL (never mutate tools array)
        ↓
   estimate tokens vs budget — refuse rather than silently truncate
        ↓
   dispatch  → phase: dispatched
        ↓
   headers   → phase: headers   (record wait; distinct from model load)
        ↓
   model load (if reloading)    → phase: loading   ← surfaced separately
        ↓
   prompt eval (cached/uncached) → phase: evaluating
        ↓
   first token → phase: generating
        ↓
   stream → tool calls → validate → policy → (approve) → execute
        ↓
   append results → next request or terminal
```

**Rule:** if any phase exceeds a display threshold, the UI names the phase and the elapsed time. There is no generic "waiting".

**Rule:** a question a user must never have to ask — "is it thinking or is it broken?" — is answered by the phase row, always.

---

## 5. Acceptance tests per phase

Each phase's gate is executable, not a checklist of impressions.

### Phase 1 — Foundation (single task, single model, local)

| # | Test | Pass condition |
|---|---|---|
| 1.1 | Two-request task on a resident model | `cached_token_ratio` on request 2 ≥ 0.6 **and** no event between them changes the tools array |
| 1.2 | Deliberately change tool selection mid-task | Test **fails** — proves the invariant is enforced |
| 1.3 | Kill process between `tool.started` and `tool.completed` | Restart marks the operation `uncertain`, never re-executes it, and the dialog lists it |
| 1.4 | Kill process after `tool.completed` before snapshot | Replay reconstructs the completed operation from the log |
| 1.5 | Emit a `tool.completed` with no `tool.started` | Log validator rejects; session flagged corrupt rather than silently accepted |
| 1.6 | Compaction crossing a tool call | No orphaned tool result; overlap window preserved; omitted count recorded |
| 1.7 | Denied approval | No execution event; denial recorded; task continues with unrelated safe work or blocks |
| 1.8 | Request that exceeds budget | Refuses with an explicit message; context/output settings unchanged |
| 1.9 | Same task, second `user.message` | Same taskId, no duplicate admission, request index continues |
| 1.10 | 100 sequential tool calls | No cap hit, no silent stop; ledger renders all with virtualisation |

### Phase 2 — Safe execution

| # | Test | Pass condition |
|---|---|---|
| 2.1 | Sandbox escape attempt (write outside workspace) | Denied by the boundary, not by policy wording |
| 2.2 | Network attempt in a no-network boundary | Blocked; attempt recorded as a boundary event |
| 2.3 | Orphan sweep | A sandbox killed mid-run is reaped within one sweep interval and reported |
| 2.4 | Teardown verification | Teardown result is recorded per resource; failure to release is surfaced, not assumed |
| 2.5 | Approval cannot be replayed | A stale approval from a previous run is rejected |
| 2.6 | Hook/extension attempting an unapproved tool | Blocked structurally; counted in `permission_violations` which must be 0 |

### Phase 3 — Review and recovery

| # | Test | Pass condition |
|---|---|---|
| 3.1 | Restore files only | Files revert; conversation intact |
| 3.2 | Restore files + conversation | Both revert to the checkpoint |
| 3.3 | Human edited a file after checkpoints | Restore reports the conflict and offers skip-or-overwrite, defaulting to skip |
| 3.4 | Retry creates a branch | Original timeline unchanged; branch independently inspectable |
| 3.5 | External effect at restore | "Not restorable" line present and accurate |
| 3.6 | Snapshot mutation attempt | Committed state is immutable; mutation impossible by construction |

### Phase 4 — Tool and skill economics

| # | Test | Pass condition |
|---|---|---|
| 4.1 | Core catalog size | ≤ 14 tools; token count under 2% of the selected context |
| 4.2 | Adding a 100-tool MCP server | Core prefix hash **unchanged**; discovered tools appear at tail |
| 4.3 | `find_tools` retrieval | Returns ≤ 5 schemas; exact-name matches rank above semantic matches |
| 4.4 | Skill pack with 300 skills | Refuses or warns with a measured token cost; does not silently consume the window |
| 4.5 | Skill trust gate | Project skill from an untrusted workspace is hidden, not listed-then-blocked |
| 4.6 | Skill body across compaction | Skill content is not pruned away mid-task |

### Phase 5 — Quality and evaluation

| # | Test | Pass condition |
|---|---|---|
| 5.1 | `false_verification_rate` | 0 across the seeded task set — no success claim after a failed gate |
| 5.2 | `requests_per_task` | Reported median and p90; regression against the recorded baseline |
| 5.3 | Recovery matrix | Every boundary in §Phase 1 tests 1.3–1.4 passes for every effect class |
| 5.4 | `permission_violations` | 0, with denials reported separately as friction |
| 5.5 | Cross-model | Same task run on a small and a large local model; success and request count both recorded, neither hidden |

### Explicit non-gates

- SWE-bench score is **not** an acceptance criterion.
- Tokens/second is **not** a success metric.
- Screenshot appearance is **not** verification evidence.

---

## 6. What is still unspecified (deliberately)

| Item | Why deferred |
|---|---|
| Framework/language choice | Must follow the prototype comparison of local-server vs integrated-desktop, not precede it |
| Remote/cloud execution | The local-first path must be trustworthy first |
| Team/RBAC features | Out of scope for v1; would add a surface to defend |
| Vector indexing | Optional add-on; FTS + explicit reads cover v1 |
| Subagent UI | Not built until child-session isolation exists |
| Undo of external effects | Impossible in general; only honest disclosure is planned |

---

## 7. Open questions for the user's review

1. **Primary shape:** is this a desktop app with a local runtime, or a local *service* with desktop/CLI/editor clients? The screen flows above assume a desktop-first client over a local session server.
2. **Default boundary:** should a new task default to *uncontained working checkout* (fast, familiar) or *isolated worktree* (safer, requires a merge step)? This is the single most consequential default in the product.
3. **Model strategy:** local-first only at v1, or local + BYOK hosted from the start?
4. **Skill packs:** ship zero, ship a small curated set, or ship none and rely on discovery?
5. **Task scope:** one task per session, or multiple concurrent tasks per project from day one?

---

## 8. Self-review: gaps and risks found in this specification

A design review of the documents above, looking for what would actually break a builder.

### 8.1 Definitions that were ambiguous and are now fixed

| Term | Definition |
|---|---|
| **Project** | A filesystem root plus its identity hash. Survives every task. |
| **Task** | A durable unit with a goal, a plan, an event log, and a terminal outcome. One task = one log. |
| **Turn** | One user message plus everything that follows until the model produces a terminal response for it. A task may contain many turns. |
| **Request** | One model HTTP call. Many per turn. This is the unit every timing and cache metric attaches to. |
| **Operation** | One tool invocation with an `operationId`. This is the unit that can be *uncertain*. |

Without these five words fixed, "resume the task" and "retry the operation" get conflated — which is exactly how an uncertain effect becomes a duplicate effect.

### 8.2 Gaps this review found (not yet resolved)

| Gap | Why it matters | Provisional direction |
|---|---|---|
| **No performance budget** | "Fast" is not a spec. Without numbers, a builder ships something that feels slow and blames the model. | Define: cold start < 2 s to first paint; context assembly < 50 ms; event append < 5 ms p95; ledger render 1,000 events without frame drops. Model time is excluded and displayed separately. |
| **No long-session behaviour** | A 2-hour task with 5,000 events and 400 MB of tool output will break naive rendering and naive snapshots. | Virtualise the ledger; snapshot every N events plus at compaction; cap in-memory tool output and page from disk. Needs measurement, not assumption. |
| **MCP approval path unspecified** | MCP tools are the highest-risk surface (arbitrary code, external data) and the approval dialog above only covers `run_shell`. | MCP gets its own proposal event carrying server identity, tool schema digest, and the *data* being sent. Approval must name the server, not just the tool. |
| **No error taxonomy** | "Failed" hides whether the model failed, the provider failed, the tool failed, or policy blocked it. Users cannot act on an undifferentiated failure. | Four distinct terminal reasons — `model_failure`, `provider_failure`, `tool_failure`, `policy_block` — each with a different recovery affordance. |
| **Accessibility unspecified** | A dense three-column ledger is a real accessibility risk (keyboard traversal, screen readers, motion). | Keyboard-first navigation across ledger/evidence; visible focus; ledger as an ARIA live region with an option to silence; reduced-motion honoured. Not optional for v1. |
| **No data-deletion story** | Sessions contain code, paths, and potentially secrets in tool output. | Per-scope deletion (session, project, all), with a statement of what deletion does *not* reach (backups, exports already taken). |
| **No migration/versioning policy for the log** | `v: 1` exists but nothing says what happens at `v: 2`. | Forward-compatible readers: unknown event types render as inert rows, never dropped. Snapshot mismatch triggers log replay, not data loss. |
| **Uncertainty about "task" concurrency** | The spec assumes one active task per project but never says so. | State it: one *running* task per project at v1; additional tasks queue. Concurrent tasks need worktree isolation first. |

### 8.3 Risks where the design could be wrong

| Risk | Consequence if wrong | How to find out early |
|---|---|---|
| **Three-column ledger is too dense** | Users ignore the evidence column and read the transcript anyway, so the whole premise fails | Prototype both layouts; measure whether users find *why did it change this file* faster |
| **Event-log-only UI blocks fast iteration** | Every UI tweak needs a new event type, slowing development | Prototype with a minimal event set; confirm derived-view approach survives real change requests |
| **`sync` durability is too slow on real disks** | Every tool step waits on fsync; interactivity suffers | Measure fsync cost on target Windows hardware before committing to the default |
| **Tool discovery (`find_tools`) is worse than a bigger static catalog for small local models** | Retrieval errors cost more than the tokens saved on a weak model | A/B on the actual small model; if retrieval accuracy is poor, keep more tools resident |
| **Sandbox default is too slow to start** | Users disable it, and the safety story collapses | Measure container start time; if > ~2 s, offer worktree as the fast-but-still-isolated default |
| **Subagent-as-child-session is too expensive to build** | Feature never ships, or ships uncheckpointed and breaks recovery | Decide after Phase 3; if costly, ship without subagents — that is an acceptable v1 |

### 8.4 What this specification deliberately does *not* claim

- No claim that this design is better than any competitor — only that its stated properties are testable.
- No claim that the acceptance tests have been run. None have.
- No claim about performance on Windows hardware. Nothing has been measured beyond token counting.
- No claim that the five open questions in §7 have been answered by anyone.

### 8.5 Recommended next action

The honest next step is **not** more documentation. It is one prototype that answers the two highest-risk unknowns:

1. **Does a `sync`-durable event log feel acceptable on this machine?** Measurable in a day — write events, fsync, measure.
2. **Does the three-column ledger beat a transcript for "why did it change this file"?** Testable with a clickable mockup and three real tasks.

Everything else in this design is downstream of those two answers.
