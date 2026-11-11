# Separate Platform From-Scratch Design — Queued Brief

**Status:** active design track, prioritized by the user on 2026-11-11.
**Research: COMPLETE for the first pass** — three source-cited review passes consolidated in [`platform-landscape-research.md`](platform-landscape-research.md) (~30 products verified; your 100-item catalog mapped with verification status).
**Design: DRAFTED** — [`separate-platform-v1-design.md`](separate-platform-v1-design.md).
**Next:** design review, then the later research phase (memory/durability/sandbox/evaluation) listed in `platform-landscape-research.md` §6.
**Nothing here is implemented and no framework is selected.**
**This is not a redesign of Local Agent Workbench.** It is a distinct future product/platform design exercise; no implementation or framework decision is authorized by this brief.

## User direction

Design a new platform from scratch, informed by (not copied from) ChatGPT, Codex, OpenCode, Cline, Kilo, DeepAI Code, Pi, Aider, and other relevant products. The design may choose any suitable framework, language, desktop/web/CLI arrangement, or runtime architecture. It should improve on current agent-loop, model-request, safety, visual, and project-development limitations rather than inherit the current app's architecture by default.

## Design baseline — provisional hypotheses to validate

These translate prior user direction into a starting point for research, not approved implementation choices.

### Vision and audience

**Vision:** a professional agentic software-development environment that can take a real project from intent to verified result, with the user able to understand, steer, review, recover, and trust every consequential step.

**Primary audience:** individual developers who want autonomous end-to-end project work, especially users combining local models and hosted models across a desktop/IDE/terminal workflow. Secondary audiences to evaluate: teams needing shared policy/review; power users building custom agents/tools; non-expert creators who need visual verification and guided setup.

### Outcomes to optimize

- User reaches a correct, tested, reviewable result with less supervision and fewer unnecessary model round-trips.
- Every request exposes model/runtime state, elapsed phase, context/cache usage, and why work is waiting; no opaque multi-minute “thinking” gap.
- No silent lost/double-run action; interruptions and recovery preserve completed/uncertain effects faithfully.
- Safety is technically enforced where possible; approval is consent, not a sandbox. User changes are reversible and never silently overwritten.
- Product feels coherent across project exploration, planning, editing, execution, review, and handoff—not like a chat pane with disconnected tools.

### Anti-goals

- Do not clone any named competitor’s UI, code, protected copy, or internal implementation.
- Do not equate longer reasoning, larger context, more tools, model count, or “autonomy” with better outcomes.
- Do not require a specific inference vendor, cloud account, editor, or framework before research supports it.
- Do not hide tool effects, overwrite user work, replay uncertain side effects automatically, or present estimates as provider facts.
- Do not implement the new platform inside the existing Workbench repository as a shortcut.

### Initial quality bar (targets to validate)

| Dimension | Initial target | Evidence required |
|---|---|---|
| Responsiveness | Warm, cacheable follow-up requests avoid full-prefix re-evaluation; user always sees current phase/elapsed time | Same-task provider metrics + latency distributions, across local and hosted adapters |
| Task reliability | No accepted request or side effect disappears/duplicates across retry, crash, or resume | Fault-injection matrix and event-log replay tests |
| Code quality | Completion requires relevant checks and inspection; reports distinguish attempted/passed/failed/unrun | Verifiable operation/test evidence; seeded task evaluations |
| Safety | Permission rules explain what is allowed; contained mode proves OS boundary; uncertainty is visible | Threat model, adversarial tests, process/filesystem/network containment evidence |
| Recovery | Restore code and conversation independently or together; preserve full transcript and result references | Checkpoint/reopen tests including dirty worktrees, untracked files, and crash windows |
| Product clarity | Users can tell what agent is doing, what it needs, and what changed in seconds | Usability sessions and accessibility audit |

## Required research

Build a broad, evidence-backed catalog of **up to 100** relevant platforms/tools (coding agents, IDE assistants, agent harnesses, local-model apps, CLI agents, review/worktree systems, MCP/extension ecosystems). Do not pad the catalog with irrelevant products. The catalog is only the index—not a substitute for depth. For **each selected platform individually**, conduct a comprehensive, in-depth review of its whole product and harness: every major surface, workflow, agent loop, model/runtime path, tool and integration system, context behavior, permission/safety boundary, recovery mechanism, visual interaction, customization path, release/operational model, strengths, weaknesses, and evidence gaps. Do this even when capabilities duplicate across products; those duplications are needed later for overlap analysis and deliberate synthesis. Capture research date, canonical URLs, versions, primary-source evidence, evidence quality, and uncertainty. Compare:
- product surfaces and navigation; chat, editor, CLI, review, and worktree flows
- agent loop/session ownership; send, steer, queue, delegation, and safe boundaries
- context construction, prefix caching, compaction, tool-schema discovery, and model/runtime lifecycle
- filesystem/terminal execution, permissions, approvals, undo/checkpoints, and actual OS containment
- event timelines, streaming/reasoning/progress visuals, diagnostics, and recovery after disconnect/crash
- extensions, MCP, skills, custom tools, model/provider capability declarations, and local-first operation
- accessibility, privacy, packaging, updates, and maintainability

Do not treat a vendor's marketing claim as implementation evidence. Do not copy code, proprietary UI assets, or protected wording; translate useful interaction patterns into original product requirements and designs.

## Initial primary-source research notes (2026-11-10; not a design decision)

| Product | Verified pattern from primary sources | What to evaluate for an original platform |
|---|---|---|
| OpenAI Codex app | Isolated Git worktrees for parallel agents; reusable skills; approvals and sandboxing are separate controls. [App](https://openai.com/index/introducing-the-codex-app/) · [Safety](https://openai.com/index/running-codex-safely/) | Strong workspace isolation and reviewable parallel work, while keeping approval separate from OS containment. |
| Cline | Explicit Plan/Act modes; checkpoints in a shadow Git repository; per-tool auto-approval; local model setup guidance. [Modes](https://docs.cline.bot/core-workflows/plan-and-act) · [Checkpoints](https://docs.cline.bot/core-workflows/checkpoints) · [Local models](https://docs.cline.bot/running-models-locally/overview) | Reversible actions and model lifecycle UX; measure checkpoint cost and failure recovery. |
| Kilo Code | Specialized Code/Ask/Plan/Debug modes; Git-based snapshots around model-call boundaries; local provider support. [Agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) · [Checkpoints](https://kilo.ai/docs/code-with-ai/features/checkpoints) · [Local models](https://kilo.ai/docs/automate/extending/local-models) | Step-level review/rollback and mode-specific capabilities; avoid tool/mode sprawl. |
| OpenCode | Ordered resource-scoped permission rules; automatic compaction with a recent verbatim tail; dynamic MCP and session utilities. [Permissions](https://opencode.ai/docs/permissions/) · [Compaction](https://opencode.ai/docs/compaction/) · [Tools](https://opencode.ai/docs/tools/) | Explicit policy explainability and bounded-but-recoverable context; verify cache impact and exact-history recovery. |
| Aider | Repository map for context; architect/editor split; explicit diff, undo, and Git workflow; Ollama support. [Repo map](https://aider.chat/docs/repomap.html) · [Modes](https://aider.chat/docs/usage/modes.html) · [Git](https://aider.chat/docs/git.html) | Compact structural context and strong edit review; two-model mode may add latency and should not be default for local systems. |
| Pi / DeepAI Code | Pi offers session APIs, steer/follow-up, extensions and compaction; DeepAI Code emphasizes model/access modes, diff review, and branch/worktree isolation. [Pi SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) · [DeepAI Code](https://deepai.org/docs) | Extensible event-driven sessions and a clean review loop; verify local/provider and recovery behavior independently. |
| ChatGPT Projects / Canvas | Project-oriented conversations/files and an editable canvas are relevant interaction patterns; exact coding-agent integration varies by product and requires deeper first-party review. [Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) · [Canvas](https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it) | Evaluate persistent project context and artifact-centric collaboration without assuming hosted features map directly to local execution. |

These are initial, deliberately limited observations—not complete platform reviews and not claims that products share implementations or that any pattern should be copied unchanged. Research coverage is incomplete. The later research phase must individually review each chosen platform end to end from first-party docs/source and, where useful, hands-on evidence, including OpenAI Codex CLI/app-server, ChatGPT Projects/Canvas, Kilo, Pi, and local-first tools. Do not move to the new-platform architecture recommendation until the individual reviews and overlap analysis are complete.

## Candidate product interaction model — to validate, not selected

A candidate concept to compare against ChatGPT-style focused conversation, IDE-native assistant, and terminal-first agent models:

```text
Project space
├── Goals and active tasks
├── Sessions / branches / background work
├── Files, instructions, skills, integrations
└── Evidence and recovery history

Active task workspace
├── User + assistant conversation (reasoning collapsed by default)
├── Work status: next action, current phase, latency/context/cache
├── Proposed/active operations with precise approvals
└── Artifacts: plan, changed files, checks, preview, final report
```

Design questions: Is the primary object a project, task, session, or artifact? Should a single task have a continuous transcript with structured substeps, or distinct request cards? How can the user compare multiple agents/worktrees without fragmented context? How does the UI distinguish “model generating,” “waiting on provider,” “tool executing,” “needs approval,” and “blocked”? Resolve these with user journeys and prototypes, not by assuming the layout above.

## Candidate architecture options — to research before choosing

| Option | Shape | Potential strengths | Risks / evidence needed |
|---|---|---|---|
| A. Local session server + clients | Durable local daemon owns session/event log/runtime/tools; desktop, CLI, editor, and web clients connect through a versioned protocol | Shared state across surfaces; clear process ownership; easier headless/background sessions | Daemon lifecycle, auth/local IPC security, updates/migrations, multi-client conflicts |
| B. Desktop shell + embedded durable runtime | Single desktop app contains session coordinator, model adapters, tool broker, and UI | Tight product integration; simpler setup for a desktop-first product | Harder CLI/editor reuse; renderer/main/runtime boundary and crash recovery complexity |
| C. Editor/host plugin + standalone agent service | Integrate into existing editor(s), with separate reusable runner/service | Native editing/review and existing developer ergonomics | Host fragmentation; less control over polished cross-editor workflow |
| D. Web/remote workspace platform | Web UI and isolated workspace executor; local connector optional | Strong asynchronous delegation, previews, reproducible environments | Cloud costs/privacy, network and identity/security, less suitable for offline/local models |

**No option is recommended yet.** Compare at minimum a local-first server with desktop/CLI clients against a single desktop process and an editor-hosted model. Measure setup burden, crash boundaries, update/migration complexity, model-runtime ownership, cross-surface state, and containment feasibility.

## Expected design outputs

1. Product vision, target users, goals/non-goals, differentiators, and measurable quality bar.
2. Product capability map and workflow diagrams, including core loop and failure/recovery sequences.
3. At least two architecture options (including a clean-slate option), with tradeoffs and a recommended one.
4. Original UX flows/wireframes for workspace onboarding, model selection/load state, active agent run, approvals, review/undo, sessions, and recovery.
5. Model/runtime strategy covering local and optional hosted providers, cache-aware request sessions, context budget, capabilities, and resource constraints.
6. Safety/threat model separating consent, workspace scoping, process lifecycle, and OS containment.
7. Staged roadmap and acceptance tests; explicitly state which existing Workbench requirements can be reused as product lessons versus which must remain only in the old platform.

## Sequence / gate

The user has now asked to move this separate-platform design forward before the broad 100-tool survey. Keep the research/build strictly design-only: no implementation, scaffolding, or changes to current Workbench behavior. Work in this order: (1) define vision, audience, use cases, and quality bar from prior discussion; (2) complete in-depth dossiers for the named inspiration set and relevant adjacent products; (3) synthesize overlaps into original requirements; (4) compare clean-slate architecture and framework options; (5) produce original flows/wireframes, threat model, model/runtime plan, and staged roadmap; (6) self-review against evidence and unresolved assumptions. After the design is complete, do the broader catalog of up to 100 relevant tools/harnesses and feature research requested for future improvement across both products. Any eventual implementation requires the written design to be reviewed/approved and must use a separate repository/branch.


## Next research gates (still required)

- Inspect Codex app-server protocol/docs for thread/turn/event replay, approvals, and safe restart behavior; compare Codex CLI vs desktop instead of treating them as one product.
- Review ChatGPT Projects/Canvas and DeepAI Code official material specifically for broad project surfaces, review/diff flow, access modes, and model switching; distinguish hosted product behavior from local-code capabilities.
- For OpenCode, trace a documented request loop and session/permission lifecycle across stable docs and source; label development-branch V2 ideas separately.
- For Cline and Kilo, compare real checkpoint storage/restore boundaries and how they interact with Git, dirty worktrees, and user changes.
- For Pi and Aider, measure prompt/context strategy, extension APIs, model routing, and action/undo semantics from primary docs/source.
- Expand the catalog toward 100 candidates only when each has a verifiable product identity and a relevant feature; group into tiers (deep-review, feature-reference, catalog-only) to avoid superficial claims or research bloat.

## Initial hypotheses to evaluate (not approved decisions)

1. The new platform may be a session server with multiple clients (desktop + optional CLI/editor/web) rather than a desktop app with a sidecar; compare local-first security and reliability before choosing.
2. The agent runtime should be a durable state machine with explicit admission, event log, and safe-boundary effects; model calls are stateless adapters behind that runtime.
3. Context should be a versioned projection over canonical transcript/checkpoints, with stable cacheable prefix, exact provenance, incremental append, and loss-aware compaction.
4. Execution should use capability adapters and explicit risk classes, with separate policy (consent) and actual containment; undo/checkpoint should work outside the user's Git history.
5. UI should make current goal, next action, model/runtime state, context/cache cost, pending decisions, operations, and evidence understandable at a glance; raw reasoning should not be treated as progress.
6. Test an original agent-workspace layout (project rail + active task/transcript canvas + contextual evidence/operations panel) against focused-chat and IDE-panel alternatives; do not select it from inspiration alone.

These are research prompts only. No framework, runtime, brand, architecture, or UI is selected yet.

## Research coverage plan for the up-to-100 catalog

For each candidate, record canonical name, publisher, category, versions examined, supported platforms, current maintenance evidence, and a complete review dossier. The dossier must cover onboarding/navigation, project/context model, conversation and agent loop, model/provider lifecycle, prompt/context/cache/compaction, tools and batching, MCP/skills/extensions, approvals and actual containment, diff/review/undo/checkpoints, sessions/steering/queue/recovery, UI/accessibility, configuration, privacy, packaging/update/diagnostics, strengths, weaknesses, and known unknowns. Cite each factual claim and label marketing, documentation, source-code, and hands-on evidence separately. Then create cross-platform feature clusters—including duplicates—and a merge matrix: reuse as a requirement, combine, redesign, reject, or investigate further, with rationale and priority. The resulting design must be original and evidence-led, not a copied feature checklist or popularity ranking.
