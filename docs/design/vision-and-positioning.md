# Vision & Positioning — Local Agent Workbench

**Status:** planning input for the agent-flow rework and beyond. Companion to
`docs/design/agent-flow-rework.md`, `docs/PRODUCT_BACKLOG.md`, and `docs/MASTER_ROADMAP.md`.

## Ambition

Build a top-tier (top-100-class) local coding-agent platform and harness: professional,
highest-quality, durable, and honest — the best way to run an autonomous coding agent on
your own machine with your own models. Quality bar: every claim verified, every failure
recoverable, every cost visible.

## Where the market is (researched 2026-11-08)

| Harness | Surface | Local support | Known weakness we can beat |
|---|---|---|---|
| OpenCode | CLI/TUI, agent server | 75+ providers, Ollama/llama.cpp | ~7k-token startup prompt; TUI-only, no desktop review UX |
| Codex CLI `--oss` | CLI | Ollama/LM Studio | ~25k-token default prompt incl. ~17k MCP schemas |
| Cline | VS Code | Yes | IDE-bound; needs ~22B models for reliable runs |
| Aider | Terminal | Wide (LiteLLM) | No approvals/containment model; commit-per-edit workflow |
| Pi / small-prompt harnesses | CLI | Lean context | Minimal durability/recovery surfaces |

Key market facts:
- **Prompt size is the differentiator for local models** (big harness prompts eat context and CPU eval time — exactly our 1–3 min issue). Lean-context harnesses win on small models.
- **Desktop review/approval UX is an open niche** — CLI harnesses dominate; no polished local-first desktop with per-action approvals, live tool activity, durable sessions, and recovery.
- Continue and Roo Code are reportedly no longer maintained — space is opening.
- No competitor centers **verified durability** (dual mirrors, crash recovery, honest partial states) as a first-class feature. That is our credibility moat.

## Positioning statement

*The local-first desktop coding agent: your models, your machine, reviewable autonomy.*
Differentiators to press: (1) lean, cache-aware prompts (fast on consumer GPUs),
(2) durable reviewable sessions with honest recovery, (3) real approval model with a
clear path to opt-in containment, (4) desktop UX that CLI tools lack.

## Brainstorm — improvement backlog beyond the rework (prioritized)

1. **Prompt-budget governor** — hard per-request prompt budget with visible composition
   (system/tools/history/results), auto-trimming to stay cache-friendly. Directly extends Stage 2.
2. **Tool-schema paging on demand** (like Codex --oss minimal mode): advertise a compact
   catalog; load full schemas only for tools the task uses. Large win on MCP-heavy setups.
3. **Benchmark page in-app** (extends B-002/B-004): one-command A/B of quant/context/offload
   with fixed prompts — makes performance honest and user-tunable.
4. **Skills marketplace polish**: skill discovery already walks .agents/.claude/.opencode/.codex — add one-click enable, per-skill permissions, and a curated local catalog.
5. **Subagent/delegation** (post single-agent reliability per backlog): foreground/background child tasks for research vs. implementation splits.
6. **CLI surface on the same engine** (parity row): reuse the sidecar protocol for a terminal client — cheap after Stage 1's inbox contract.
7. **AppContainer containment prototype** (B-012): the top trust differentiator vs. every CLI competitor.
8. **Signed installers + cross-platform builds** (after Windows beta stabilizes).

## Non-goals (keep us sharp)
- No cloud dependency, no telemetry home, no proprietary model lock-in.
- No fake parity claims; the register stays evidence-gated.
- No OS-containment claims until a real contained executor is acceptance-tested.
