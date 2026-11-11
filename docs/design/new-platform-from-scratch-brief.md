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
