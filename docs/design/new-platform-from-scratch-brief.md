# Separate Platform From-Scratch Design — Queued Brief

**Status:** queued for after current harness Stage 1/2 stabilization and project-wide audit.
**This is not a redesign of Local Agent Workbench.** It is a distinct future product/platform design exercise; no implementation or framework decision is authorized by this brief.

## User direction

Design a new platform from scratch, informed by (not copied from) ChatGPT, Codex, OpenCode, Cline, Kilo, DeepAI Code, Pi, Aider, and other relevant products. The design may choose any suitable framework, language, desktop/web/CLI arrangement, or runtime architecture. It should improve on current agent-loop, model-request, safety, visual, and project-development limitations rather than inherit the current app's architecture by default.

## Required research

For each platform, use current primary documentation/source where available. Capture date, URLs, evidenced behavior, and uncertainty. Compare:
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

These are workflow references, not claims that the products share implementations or that each pattern is suitable unchanged. Research coverage is incomplete: continue reviewing first-party docs/source for OpenAI Codex CLI/app-server, ChatGPT Projects/Canvas, Kilo modes/checkpoints, Pi session/extension details, and other local-first tools before architecture recommendation.

## Expected design outputs

1. Product vision, target users, goals/non-goals, differentiators, and measurable quality bar.
2. Product capability map and workflow diagrams, including core loop and failure/recovery sequences.
3. At least two architecture options (including a clean-slate option), with tradeoffs and a recommended one.
4. Original UX flows/wireframes for workspace onboarding, model selection/load state, active agent run, approvals, review/undo, sessions, and recovery.
5. Model/runtime strategy covering local and optional hosted providers, cache-aware request sessions, context budget, capabilities, and resource constraints.
6. Safety/threat model separating consent, workspace scoping, process lifecycle, and OS containment.
7. Staged roadmap and acceptance tests; explicitly state which existing Workbench requirements can be reused as product lessons versus which must remain only in the old platform.

## Sequence / gate

Do not start this track until the current Workbench branch has a truthful stabilized status, the initial project-wide audit/roadmap is reconciled, and the user is ready to review a separate design. Research and design only first; implementation requires approval of the written design. Keep any later implementation in a separate repository/branch.


## Next research gates (still required)

- Inspect Codex app-server protocol/docs for thread/turn/event replay, approvals, and safe restart behavior; compare Codex CLI vs desktop instead of treating them as one product.
- Review ChatGPT Projects/Canvas and DeepAI Code official material specifically for broad project surfaces, review/diff flow, access modes, and model switching; distinguish hosted product behavior from local-code capabilities.
- For OpenCode, trace a documented request loop and session/permission lifecycle across stable docs and source; label development-branch V2 ideas separately.
- For Cline and Kilo, compare real checkpoint storage/restore boundaries and how they interact with Git, dirty worktrees, and user changes.
- For Pi and Aider, measure prompt/context strategy, extension APIs, model routing, and action/undo semantics from primary docs/source.
- Add additional platforms only when they offer evidenced differentiators (e.g. IDE-native, terminal-first, local runtime UX, remote sandbox); do not chase an arbitrary "top 100" list at the cost of product focus.

## Initial hypotheses to evaluate (not approved decisions)

1. The new platform may be a session server with multiple clients (desktop + optional CLI/editor/web) rather than a desktop app with a sidecar; compare local-first security and reliability before choosing.
2. The agent runtime should be a durable state machine with explicit admission, event log, and safe-boundary effects; model calls are stateless adapters behind that runtime.
3. Context should be a versioned projection over canonical transcript/checkpoints, with stable cacheable prefix, exact provenance, incremental append, and loss-aware compaction.
4. Execution should use capability adapters and explicit risk classes, with separate policy (consent) and actual containment; undo/checkpoint should work outside the user's Git history.
5. UI should make current goal, next action, model/runtime state, context/cache cost, pending decisions, operations, and evidence understandable at a glance; raw reasoning should not be treated as progress.
6. Test an original agent-workspace layout (project rail + active task/transcript canvas + contextual evidence/operations panel) against focused-chat and IDE-panel alternatives; do not select it from inspiration alone.

These are research prompts only. No framework, runtime, brand, architecture, or UI is selected yet.
