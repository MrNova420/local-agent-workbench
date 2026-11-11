# Standing User Directives — Persistent Ledger

**Purpose:** durable record of every standing instruction given for this project, so nothing is silently dropped across sessions. New instructions add to this list; they do not erase earlier ones unless explicitly stated.
**Last updated:** 2026-11-11.

---

## A. Current app (Local Agent Workbench)

| # | Directive | Status |
|---|---|---|
| A1 | Work on a **new git branch** for code safety; never modify beta/main. | Done — `workbench/agent-flow-rework` on both app and engine repos |
| A2 | Fix the **1–3 minute "waiting for response headers" overhead** — decide whether it happens before or after the model request, and handle it. | Source cause found and fixed (unstable tool-schema selection breaking prompt-cache reuse). **Live proof still pending** — requires Ornith resident; Ollama currently offline; probe correctly reports `ollama_unavailable` |
| A3 | Find and fix why the app **only allowed 65k context**. | Audited: no hard cap in source; presets above advertised maxima remain enabled, custom values preserved. Regression test added |
| A4 | Preload model on first message and keep it loaded ~30 min or forever — already correct; keep it that way. | Confirmed in source; no change made |
| A5 | Handle model/runtime loading **on demand and automatically**, like other harnesses. | Existing warm-on-select behavior preserved; no auto-load on app launch (per decision D-003) |
| A6 | Keep user context/output/reasoning settings untouched unless the user changes them. | Honored throughout |
| A7 | Run the **queued regression backlog**. | Ongoing — grouped suites green at each commit (engine 433+12, sidecar 197, renderer 144) |
| A8 | Stabilize, improve, and fix everything proactively — act as lead developer, not a task-taker. | Ongoing |

## B. Packaging

| # | Directive | Status |
|---|---|---|
| B1 | Always produce a **new, separate package**; never overwrite or release over old ones — old builds may still be needed. | Done — `npm run make` now routes to `make:unique`: unique timestamped directory, refuses collisions, isolates artifacts + worker + PyInstaller work dir, records provenance manifest (commits, lockfile hash, Node/npm/Python/PyInstaller versions) |
| B2 | Release builds only after gates pass; keep `make:release` separate. | Done — `make:release` reserved for the final versioned build |

## C. Separate from-scratch platform (items 5 and 6 — current focus)

| # | Directive | Status |
|---|---|---|
| C1 | Design a **new platform from scratch**, independent of Electron and the current app architecture; any framework/language is acceptable. | Design drafted: `separate-platform-v1-design.md` |
| C2 | Draw inspiration from ChatGPT, Codex, OpenCode, Cline, Kilo, DeepAI Code, Pi, Aider and others — as inspiration and research only, never copied. | Research record: `platform-landscape-research.md` |
| C3 | **Comprehensively research each individual product** — its whole system, features, abilities, harness, loops, workflows, methodologies, tools — not a few hand-picked facts. Even when features duplicate, capture them, because they feed later synthesis/dedup/redesign. | **Five** source-cited passes completed (~60 products verified); dossiers cover loop, context, tools, permissions, recovery, UX, packaging |
| C4 | Examine the **top ~100** best / most-used harnesses and similar systems. The user supplied a 100-item list to use as source material. | Your 100 mapped with honest verification status; ~60 now have verified primary-source coverage, ~40 remain leads (mostly memory tools and long-tail frameworks) |
| C5 | Compare features and **decide what to combine, redesign, or reject**. | Overlap matrix + adopted-pattern table + explicit rejects in research §4 and design §3b |
| C6 | Aim for a **professional, high-quality, advanced** platform; be worthy of comparison with the best similar tools. | Quality bar in design §3; concrete screen flows, event protocol and executable acceptance tests in `separate-platform-spec.md` |
| C8 | **Push further / continue focusing on the platform.** (2026-11-11) | Done: research consolidated, design refined, spec written, critical self-review added |
| C7 | **Later research phase:** after the platform design, broadly research additional tools/technologies to improve **both** products. | Recorded as the next phase: research §6 and design §10b |

## D. Working style

| # | Directive | Status |
|---|---|---|
| D1 | Continue continuously; don't stop until everything possible is done. | Ongoing |
| D2 | Don't hard-code or take shortcuts; be professional. | Ongoing |
| D3 | Keep responses concise, organized, and straight to the point. | Ongoing |
| D4 | Maintain all project docs, files, backlog, roadmap, and plans continuously. | Ongoing — roadmap/source-of-truth map updated this session |
| D5 | Recover prior work, decisions, and unfinished tasks rather than repeating them. | Reconciled via delegated audit + direct review |
| D6 | Document blockers honestly; never claim unverified success. | Honored — cache acceptance, package acceptance, and release state all explicitly marked pending |

---

## Immediate open items (truthful state)

1. **Live cache acceptance** — paused by user instruction. One probe request before the pause showed `load_duration` 293.9 s of a 351 s header wait, correcting the earlier assumption that the whole stall was prompt evaluation.
2. **Packaged visible acceptance** — no current-pin package built; existing artifacts are old beta.2. `make:unique` is ready.
3. **Durable inbox** — run-admission facade complete; event/steer/approval/cancel/recovery migration not started.
4. **B-021 recovery defects** — source regressions exist; visible close/reopen acceptance pending.
5. **~70 catalog entries** — leads only, not yet dossiered.
6. **Design review** — the from-scratch design needs the user's read before it becomes a plan.
