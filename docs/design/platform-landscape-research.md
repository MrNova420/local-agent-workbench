# Platform Landscape Research — Consolidated Findings

**Status:** research record (2026-11-11). Read-only desk research from official documentation and project sources.
**Scope:** feeds the separate from-scratch platform design. Not an assessment of Local Agent Workbench, and not an endorsement ranking.
**Method:** three independent research passes (CLI/terminal harnesses; IDE/desktop agents; hosted/cloud and project platforms), each instructed to review each product's whole product and loop, keep duplicates, cite primary sources, and separate verified facts from inference. Consolidated here, deduplicated by product family.
**Evidence levels used below:** `doc` = stated in official documentation; `src` = stated in official source repository; `hands-on` = directly observed (none yet in this track). Nothing here is `hands-on`.

---

## 1. How to read this landscape

The single most useful distinction found: most "agent" products are not the same kind of thing. Four layers recur, and a new platform must choose which it owns.

| Layer | What it provides | Examples | What it does *not* provide |
|---|---|---|---|
| **Interactive coding runtime (harness)** | Owns loop, tools, sessions, permissions, UX | Codex CLI, Claude Code, Gemini CLI, OpenCode, Pi, Aider, Crush, Goose | Cross-product portability; guaranteed containment |
| **SDK / orchestration framework** | Loop or building blocks for integrators | Claude Agent SDK, OpenAI Agents SDK, LangGraph, Pydantic AI, Mastra, Deep Agents SDK, DSPy, CrewAI, AutoGen/AG2, Google ADK, smolagents, Semantic Kernel | Product UX, workspace boundary, tool governance |
| **Hosted / async agent platform** | Isolated environments, triggers, PR handoff | Copilot cloud agent, Jules, Devin, Cursor Cloud, Codex Cloud, OpenHands Cloud, Codegen, Factory, Augment Cosmos | Local-first operation; transparent data residency |
| **Protocols and infrastructure** | Interoperability and durability primitives | ACP, MCP, LiteLLM, Temporal, E2B, Daytona, Langfuse, SWE-bench | The agent loop itself |

**Design consequence:** borrowing "features" across layers without deciding which layer you are building produces incoherent products. The from-scratch platform proposes owning the **runtime + product surface**, treating SDKs/protocols as replaceable edges.

---

## 2. Broad candidate catalog (your 100, verified status marked)

Your list, cross-checked against this research. `✓` = an official source was reviewed in this pass (details in §3/§4 below or in the pass reports); `·` = plausible candidate, not individually verified yet; `✗` = evidence indicates deprecated/shutdown/transition and should not be treated as a current recommendation.

### Coding agent harnesses
| # | Product | Status | Note |
|---|---|---|---|
| 1 | OpenCode | ✓ | Local background server owns sessions/tools; ACP + SDK; ordered resource permissions; compaction with retained tail |
| 2 | Claude Code | ✓ | Anthropic-centered runtime + Agent SDK; hooks; shell sandbox does **not** cover file tools/MCP/hooks |
| 3 | OpenAI Codex CLI | ✓ | Local loop; App Server exposes thread/turn/item over JSON-RPC; sandbox separate from approval policy |
| 4 | Gemini CLI | ✓ | Policy engine with argument-aware rules; container sandbox option; shadow-Git checkpoints restore files **and** chat |
| 5 | Cline | ✓ | Plan/Act enforced; shadow-Git checkpoints keep conversation; per-category auto-approve; Cline SDK hub-spoke separates clients from workers |
| 6 | Roo Code | ✓ | Multi-mode + MCP + checkpoint service; docs report shutdown — treat as historical design input |
| 7 | Aider | ✓ | Repo map; architect/editor split; Git auto-commit, `/undo`, lint+test feedback; no OS sandbox |
| 8 | Goose | ✓ | MCP-centric extensions; YAML recipes; tool permissions; CLI/desktop/API surfaces |
| 9 | Pi | ✓ | Minimal extensible harness; branch-aware append-only sessions; in-process extensions inherit OS permissions; deliberately omits plan mode/subagents |
| 10 | OpenHands | ✓ | Append-only conversation event log; Docker runtime as real boundary; local model support; SDK/server/CLI/GUI |
| 11 | SWE-agent | ✓ | Agent-Computer Interface design; README now steers users to mini-SWE-agent |
| 12 | mini-SWE-agent | ✓ | Bash-only linear loop; good minimal control-loop baseline; isolated backends |
| 13 | Crush | · | Terminal agent (Charmbracelet); not individually verified |
| 14 | Plandex | · | Large-task orchestration; not individually verified |
| 15 | Mentat | · | Repo-aware coding agent; maintenance unverified |
| 16 | Continue | ✓ | Agent/Plan/Chat modes; per-tool Ask/Automatic/Excluded; many providers incl. Ollama; CLI (`cn`) shares the agent |
| 17 | Amazon Q Developer | ✓ | IDE agent + GitHub issue-to-PR; IDE plugins end-of-support Apr 30 2027; GitHub app discontinued Jan 30 2027 |
| 18 | Cursor | ✓ | Agent + checkpoints (files only, chat preserved) + CLI + Cloud Agents (isolated VM) + OS-backed SDK sandbox |
| 19 | Windsurf | ✗→✓ | Became **Devin Desktop** (2026-06-02); Cascade removed from later builds |
| 20 | Zed AI | ✓ | Native agent + ACP external agents; profiles vs permissions separation |

### General-purpose agent frameworks
| # | Product | Status | Note |
|---|---|---|---|
| 21 | LangChain | · | Framework baseline; not deeply reviewed |
| 22 | LangGraph | ✓ | Thread checkpoints, interrupts, time travel; resume at checkpoint boundaries, not exact instruction |
| 23 | CrewAI | · | Multi-agent teams; not deeply reviewed |
| 24 | Microsoft AutoGen | ✓ | Explicitly a **predecessor**; migrated into Microsoft Agent Framework |
| 25 | AG2 | · | Community continuation; not verified |
| 26 | OpenAI Agents SDK | ✓ | Runner loop, tools, handoffs, sessions, guardrails, tracing; not a workspace/sandbox |
| 27 | Google ADK | · | Agent development kit; not deeply reviewed |
| 28 | Claude Agent SDK | ✓ | Typed streaming messages; sessions resume/fork; permission callbacks; hooks |
| 29 | Pydantic AI | ✓ | Typed loop + capabilities + MCP + separate durable-execution layer |
| 30 | Agno | · | Not verified |
| 31 | smolagents | · | Code-first agents; not verified |
| 32 | LlamaIndex | · | Data-connected agents/RAG; not verified |
| 33 | Microsoft Agent Framework | ✓ | Agents + workflows + MCP + middleware + harness agent |
| 34 | Semantic Kernel | · | Orchestration SDK; not verified |
| 35 | Mastra | ✓ | TS framework; Mastra Code harness w/ sessions, approvals, plan/build modes, subagents |
| 36 | Vercel AI SDK | · | Not verified |
| 37 | Haystack | · | Not verified |
| 38 | DSPy | ✓ | ReAct loop w/ typed signatures; prompt optimization focus, not runtime safety |
| 39 | Burr | · | Stateful app orchestration; not verified |
| 40 | Llama Stack | · | Not verified |

### Multi-agent platforms
| # | Product | Status | Note |
|---|---|---|---|
| 41 | MetaGPT | · | Not verified |
| 42 | ChatDev | · | Not verified |
| 43 | SuperAGI | · | Not verified |
| 44 | CAMEL-AI | · | Not verified |
| 45 | AgentScope | · | Not verified |
| 46 | AgentVerse | · | Not verified |
| 47 | AutoGPT | · | Not verified |
| 48 | BabyAGI | · | Historical |
| 49 | Open Interpreter | ✓ | **Renamed/rewritten**: current Rust version based on Codex w/ native sandbox; legacy Python fork is separate |
| 50 | DeerFlow | · | Not verified |
| 51 | OWL | · | Not verified |
| 52 | MetaGPT X | · | Not verified |
| 53 | TaskWeaver | · | Not verified |
| 54 | Dify | · | Not verified |
| 55 | Flowise | · | Not verified |

### Always-on / personal agent runtimes
| # | Product | Status | Note |
|---|---|---|---|
| 56 | OpenClaw | · | Not verified |
| 57 | Hermes Agent | · | Not verified — priority candidate for persistent memory research |
| 58 | Agent Zero | · | Not verified |
| 59 | OpenHarness | · | Not verified |
| 60 | Khoj | · | Not verified |
| 61 | Letta | · | Priority candidate for stateful memory architecture |
| 62 | (Open Interpreter) | ✓ | see #49 |
| 63 | PraisonAI | · | Not verified |
| 64 | Agent Squad | · | Not verified |
| 65 | OpenAgents | · | Not verified |

### Extensions, skills, harness configurations
| # | Product | Status | Note |
|---|---|---|---|
| 66 | Anthropic Agent Skills | · | Skill standard; conceptually analogous to Pi/Cline skill loading |
| 67 | Everything Claude Code | · | Config collection |
| 68 | Superpowers | · | Skill pack (also present in this repo's docs) |
| 69 | GStack | · | Not verified |
| 70 | Oh My Pi | · | Pi extension set |
| 71 | AutoHarness | · | Not verified |
| 72 | RepoMaster | · | Not verified |
| 73 | Claw Code Agent | · | Not verified |
| 74 | MCP-Zero | · | Dynamic tool discovery research |
| 75 | ToolRAG | · | Retrieval-based tool selection research |

### Browser / computer-use / execution
| # | Product | Status | Note |
|---|---|---|---|
| 76 | Browser Use | · | Not verified |
| 77 | Stagehand | · | Not verified |
| 78 | Skyvern | · | Not verified |
| 79 | Playwright | · | Baseline automation; not agent-specific |
| 80 | Puppeteer | · | Baseline automation |
| 81 | WebArena | · | Benchmark environment |
| 82 | E2B | · | Sandboxed execution infra |
| 83 | Daytona | · | Agent dev environments |
| 84 | Modal | · | Cloud compute |
| 85 | Docker | · | Container baseline; the actual boundary used by OpenHands |

### Memory / context / knowledge
| # | Product | Status | Note |
|---|---|---|---|
| 86 | Mem0 | · | Memory layer |
| 87 | claude-mem | · | Cross-session memory |
| 88 | Zep | · | Long-term memory |
| 89 | Graphiti | · | Temporal knowledge graphs |
| 90 | Cognee | · | Memory/knowledge graph |
| 91 | RAGFlow | · | RAG platform |
| 92 | Chroma | · | Vector store |

### Orchestration, automation, evaluation
| # | Product | Status | Note |
|---|---|---|---|
| 93 | n8n | · | Workflow automation |
| 94 | Langflow | · | Visual agent builder |
| 95 | LiteLLM | ✓ | Multi-provider routing (used by mini-SWE-agent per its docs) |
| 96 | Langfuse | · | Tracing; not verified |
| 97 | Arize Phoenix | · | Tracing/eval |
| 98 | Braintrust | · | Eval platform |
| 99 | Inspect AI | · | Eval framework |
| 100 | SWE-bench | · | Benchmark; not verified in this pass |

**Honest accounting:** ~30 of your 100 have an official source reviewed in this pass. The remainder are leads. This document does not claim 100 deep dossiers; it claims ~30 verified entries plus a structured plan for the rest (§6).

Also added from this research (not in the 100): **Kiro**, **Amp**, **Augment Code**, **Qoder**, **TRAE**, **PearAI**, **Void** (`✗` deprecated), **BLACKBOX AI**, **Tabnine**, **Sourcegraph Cody**, **JetBrains Junie**, **Sweep**, **Zed ACP**, **Agent Client Protocol**, **Model Context Protocol**, **Ollama**, **Temporal**, **Factory Droid**, **Ona (ex-Gitpod)**, **Codegen**, **Qodo**, **CodeRabbit**, **Greptile**, **GitLab Duo**, **Jules**, **v0**, **Lovable**, **Bolt.new**, **Replit Agent**, **Firebase Studio** (`✗` sunset announced), **Google AI Studio Build Mode**, **Deep Agents Code**.

---

## 3. Verified dossiers (condensed; citations preserved)

### 3.1 OpenAI Codex CLI + App Server
- **Loop/session:** local coding loop; App Server exposes runtime over bidirectional JSON-RPC using **thread → turn → item** typed streaming, and can call back to the client for approvals (`doc`/`src`).
- **Context:** standard loop appends tool results and re-queries; caching guidance favors stable exact prefixes (`doc`).
- **Safety:** sandbox constrains reach; approval policy decides when to pause — separate controls (`doc`).
- **Lesson:** thread/turn/item is the strongest published shape for a UI that must reconnect, show pending approvals, and resume.
- Sources: github.com/openai/codex · learn.chatgpt.com/docs/app-server · learn.chatgpt.com/docs/agent-approvals-security · openai.com/index/unrolling-the-codex-agent-loop/

### 3.2 Claude Code + Agent SDK
- **Loop/session:** SDK runs the same loop as the CLI; typed system/assistant/tool/result messages; sessions resume and fork (`doc`).
- **Context:** automatic + manual compaction; project/memory inputs re-injected after compaction (`doc`).
- **Safety — critical finding:** the built-in OS sandbox applies to **shell commands and children only**; file tools, MCP servers, and hooks run outside it. Permission rules are a separate layer (`doc`).
- **Lesson:** "sandboxed" must be scoped per capability, never asserted platform-wide.
- Sources: code.claude.com/docs/en/agent-sdk/overview · /sessions · /context-window · /sandboxing · /permissions

### 3.3 Gemini CLI
- **Loop/tools:** file/shell/web tools; MCP discovery registers tools through the CLI core; extensions bundle MCP servers, prompts, commands, hooks, agents, skills (`doc`).
- **Safety:** prioritized policy rules (allow/deny/ask), argument-aware; docs state sandboxing is **disabled by default** but can be enabled, including container mode (`doc`).
- **Recovery:** shadow-Git checkpoints restore project files **and** conversation history, and can re-propose the pending tool call (`doc`).
- Sources: google-gemini.github.io/gemini-cli/docs/ · geminicli.com/docs/reference/policy-engine/ · /cli/sandbox/ · /cli/checkpointing/

### 3.4 OpenCode
- **Loop/session ownership:** shared local background **server** owns sessions, config, integrations, permissions, tool execution; SDK can embed in-process; ACP over stdio (`doc`).
- **Context:** compaction config with retained-token target and buffer; local summary default, native provider compaction optional (`doc`).
- **Permissions:** ordered allow/ask/deny by action+resource; expressive but **not** OS isolation (`doc`).
- **Lesson:** the closest published match to the "local session server + clients" hypothesis.
- Sources: opencode.ai/docs/cli/ · /config/ · /permissions/ · /acp/ · opencode.ai/v2/docs/build/sdk

### 3.5 Pi
- **Loop/session:** minimal extensible harness; branch-aware sessions; the model sees the active branch only (`doc`).
- **Context:** compaction summarizes older history **without deleting original entries** (`doc`).
- **Safety:** in-process extensions inherit the process's OS permissions (`doc`).
- **Scope choice:** deliberately omits built-in plan mode and subagents (`doc`).
- **Lesson:** a small stable core with a loud extension boundary can beat a feature-heavy core.
- Sources: pi.dev/docs/latest/{sdk,sessions,compaction,extensions,models}

### 3.6 Aider
- **Loop:** repo-map context; architect/editor split uses two models and two requests (`doc`).
- **Context/cache:** repo map + explicit files; documented prompt-caching strategy (`doc`).
- **Verification/recovery:** Git auto-commit, `/undo`, lint and test feedback in-loop (`doc`).
- **Gap:** no documented OS sandbox or policy engine (`doc` absence).
- Sources: aider.chat/docs/{repomap,usage/modes,git,usage/lint-test,llms/ollama}

### 3.7 OpenHands
- **Session architecture:** append-only conversation **event log** + persistence services; clients receive live updates over WebSocket (`doc`).
- **Execution boundary:** Docker Runtime is the recommended local sandbox; the process sandbox is explicitly described as unsafe/no isolation (`doc`).
- **Models:** documented local servers incl. Ollama, LM Studio, vLLM, SGLang (`doc`).
- **Lesson:** event-sourced conversations + a real container boundary is the most credible published combination for durability.
- Sources: docs.openhands.dev/sdk/arch/conversation · /usage/architecture/runtime · /usage/sandboxes/overview · /usage/llms/local-llms

### 3.8 Cline (+ Cline SDK)
- **Loop:** enforced Plan (read-only) ↔ Act; per-category auto-approval; "YOLO" materially widens risk (`doc`).
- **Recovery:** shadow-Git checkpoints separate from project Git; restoring files keeps the task conversation (`doc`).
- **Architecture (SDK):** hub-spoke — UI clients separate from execution workers (`doc`).
- **Context:** official enterprise docs say it does **not** index/embed the repo; it reads on demand (`doc`).
- **Lesson:** "undo code, keep the discussion" is the recovery semantic worth adopting.
- Sources: docs.cline.bot/core-workflows/{plan-and-act,checkpoints} · /features/auto-approve · docs.cline.bot/sdk/architecture/hub-spoke

### 3.9 Kilo Code
- **Loop:** role modes (Architect/Ask/Debug/Orchestrator) + separate agents; iterative tool loop (`doc`).
- **Permissions:** allow/ask/deny shared by built-in and MCP tools; `ask` default on no match (`doc`).
- **Recovery:** Git snapshots outside project Git, captured **before and after** model-call/tool boundaries (`doc`).
- **Caveat:** rebuilt-extension docs say code indexing was temporarily unavailable (`doc`).
- Sources: kilo.ai/docs/{getting-started/settings/auto-approving-actions,code-with-ai/features/checkpoints,automate/extending/local-models}

### 3.10 Cursor
- **Loop:** Agent + Explore subagent for broad parallel search (`doc`).
- **Context:** Instant Grep indexes locally and does not upload paths/code for index construction — but opened files still go to the model; `.cursorignore` does **not** block terminal/MCP (`doc`).
- **Safety:** docs describe approval classifiers and sandboxing as **best-effort guardrails, not a hard boundary** (`doc`).
- **Recovery:** checkpoints store modified files locally outside Git; restore files only, keep chat (`doc`).
- **Cloud:** separate VM per cloud agent; transcripts retained indefinitely by default, VM snapshots expire after 30 days (`doc`).
- Sources: cursor.com/docs/agent/overview · /agent/security · /reference/ignore-file · /cloud-agent/security

### 3.11 GitHub Copilot (IDE + cloud + CLI)
- **Loop:** agent mode selects files, edits, runs commands (approval normally required), iterates (`doc`).
- **Isolation:** cloud sessions in isolated Linux sandboxes or Actions environments; local sandboxing can restrict FS/network/credentials/subprocess in supported CLI/app workflows (`doc`).
- **Recovery:** `/undo`/`/rewind` can restore files while **skipping files changed since Copilot last wrote them** — the best published conflict-aware restore (`doc`).
- **Content exclusion caveat:** not a filesystem security boundary; cannot guarantee exclusion via indirect/third-party paths (`doc`).
- Sources: docs.github.com/en/copilot/reference/copilot-feature-matrix · /concepts/security-governance-and-network-settings/{content-exclusion,about-cloud-and-local-sandboxes} · CLI roll-back docs

### 3.12 Continue
- **Loop:** agent sends tools, checks per-tool policy, executes, returns result, repeats; Plan mode exposes read-only tools; Chat mode none (`doc`).
- **Models:** many providers incl. Ollama; legacy `@Codebase` embeddings deprecated in favor of newer codebase awareness (`doc`).
- **Gap:** no strong current official evidence for agent checkpoints (`doc` absence).
- Sources: docs.continue.dev/ide-extensions/agent/how-it-works · /cli/quickstart · /reference/deprecated-codebase

### 3.13 Goose
- **Architecture:** interface / agent / extensions separation; extensions via MCP; CLI + desktop + API (`doc`).
- **Workflow:** sessions, context engineering, skills, hooks, slash commands, YAML **recipes** that package instructions+tools+settings (`doc`).
- **Safety:** fine-grained tool permissions; docs do not support treating default setup as OS sandbox (`doc`).
- Sources: goose-docs.ai/docs/goose-architecture/ · /guides/{sessions,context-engineering,recipes}

### 3.14 Deep Agents Code / Deep Agents SDK
- **Product:** `dcode` terminal agent w/ TUI, interactive + headless, resume, approvals (`doc`).
- **Capabilities:** memory across conversations, skills, subagents, goals/rubrics, compaction, remote sandboxes (`doc`).
- **SDK:** virtual filesystems + pluggable backends for thread-scoped state, local files, sandboxes (`doc`).
- **Naming trap:** old `deepagents` CLI now means deployment tooling (`doc`).
- Sources: docs.langchain.com/oss/deepagents/code/overview · /oss/python/deepagents/{overview,backends}

### 3.15 Hosted platforms — key distinct findings
- **Jules:** plans → approval → fresh Cloud VM → setup script + snapshot → diff → PR (`doc`).
- **Devin:** session includes shell/IDE/browser, steerable, snapshots as prepared baseline, take-over (`doc`).
- **Replit Agent:** isolated task copies; user reviews log/tests/preview then applies or dismisses; checkpoints span project state + conversation (`doc`).
- **v0:** chat → GitHub branch → preview → CI → PR; versions restore as new versions (`doc`).
- **Lovable:** separate drafts per teammate; history restores code but **not database data**; browser testing with screenshots/console errors (`doc`).
- **Bolt.new:** project code runs in browser-side **WebContainers**; GitHub sync with auto-commits (`doc`).
- **Firebase Studio:** sunset announced — new workspaces disabled 2026-06-22, shutdown 2027-03-22 (`doc`).
- **Factory / Ona / Codegen / Augment Cosmos:** trigger-driven agents (Slack/GitHub/Linear/schedule/webhook), customer or hosted compute, on-prem options (`doc`).
- **Qodo / CodeRabbit / Greptile:** PR-review-first agents with bounded fix tasks; retention differs sharply from "no training" claims (`doc`).
- **GitLab Duo:** flows run on hosted **or customer CI runners**; IDE flow stages changes locally (`doc`).

---

## 4. Cross-cutting synthesis

### 4.1 The four separable concepts everyone conflates

| Concept | Question it answers | Failure if conflated |
|---|---|---|
| **Session history** | What was said/observed? | Lost reasoning, unrecoverable state |
| **Checkpoint** | What can I undo? | Users believe data/DB/network effects are reversible |
| **Approval** | May I do this? | Treated as security; prompt injection bypasses it |
| **Sandbox** | What can this process actually reach? | Claimed isolation that does not exist |

Highest-confidence finding across the whole landscape: **no reviewed product cleanly delivers all four with per-capability disclosure**. Several explicitly admit gaps (Claude sandbox scope, Cursor best-effort, GitHub content exclusion).

### 4.2 Feature overlap matrix (verified entries)

Legend: `✓` documented · `△` partial/optional/version-dependent · `—` absent or deprecated · `?` not established.

| Product | Plan mode | Repo index | MCP | Policy gate | Checkpoint | Real isolation | Local models | Durable session |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Codex CLI | △ | △ | ✓ | ✓ | △ | ✓ | ? | ✓ |
| Claude Code | ✓ | △ | ✓ | ✓ | ✓ | △ (shell only) | △ | ✓ |
| Gemini CLI | △ | ✓ | ✓ | ✓ | ✓ | △ (opt-in container) | ? | △ |
| OpenCode | △ | △ | ✓ | ✓ | ? | — | ✓ | ✓ |
| Pi | — | △ | △ | △ | ✓ (branch) | — | ✓ | ✓ |
| Aider | ✓ | ✓ | ? | △ | ✓ (Git) | — | ✓ | △ |
| OpenHands | △ | △ | ✓ | △ | ✓ (event log) | ✓ (Docker) | ✓ | ✓ |
| Cline | ✓ | — | ✓ | ✓ | ✓ | △ | ✓ | ✓ |
| Kilo | △ | △ | ✓ | ✓ | ✓ | △ | ✓ | ✓ |
| Cursor | △ | ✓ | ✓ | ✓ | ✓ | △ | △ | ✓ |
| Copilot | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (cloud/local CLI) | △ | ✓ |
| Continue | ✓ | △ | ✓ | ✓ | ? | △ | ✓ | ✓ |
| Goose | △ | ? | ✓ | ✓ | ? | — | ✓ | ✓ |
| Deep Agents Code | △ | △ | ✓ | ✓ | △ | ✓ (remote) | ✓ | ✓ |
| Devin Local | ✓ | △ | ✓ | ✓ | ? | ✓ (OS sandbox) | ✓ | ✓ |
| Kiro | ✓ | △ | ✓ | ✓ | ✓ | △ | ? | ✓ |
| Qoder | ✓ | ✓ | ✓ | ✓ | ✓ | △ | △ | ✓ |

### 4.3 Recurring original ideas worth adopting

1. **Typed event-sourced session** (Codex thread/turn/item + OpenHands append-only log) — one canonical record feeding UI, recovery, and audit.
2. **Derived, reversible compaction** (Pi's non-destructive summarization) — never destroy canonical history to fit context.
3. **Conflict-aware restore** (Copilot's "skip files changed since last write") — the strongest published safety semantic for checkpoints.
4. **Selectable restore scope** (Cursor = files only + chat preserved; Gemini = files + chat; Replit = broader project state) — make the choice explicit rather than implicit.
5. **Separate restore from containment**, and state external effects that cannot be undone (Lovable's database caveat).
6. **Ordered, argument-aware policy** (OpenCode/Gemini/Kilo) with deny precedence and an explainable decision trace.
7. **Execution-boundary selection before launch** (local checkout / worktree / container / remote VM), visible in the UI.
8. **Deferred tool-schema loading** (Augment MCP Tool Search, OpenCode/Codex tool paging) to protect context budget.
9. **Structured verification artifacts** (Aider lint/test feedback, Agentless candidate validation) rather than prose claims.
10. **Portable, exportable sessions** (OpenCode export/import/sanitize) to avoid lock-in and support the lifecycle-migration problem that Q→Kiro and Windsurf→Devin Desktop exposed.

### 4.4 Explicit rejects

- Approval prompt sold as security.
- One flattened global tool catalog.
- In-process third-party extensions by default.
- Destructive/irreversible compaction as the only mechanism.
- A single YOLO switch as the whole autonomy model.
- Benchmark-repair pipelines presented as general interactive agents.
- Default multi-agent complexity before single-agent reliability.
- Shadow-Git presented as isolation.
- Claiming "any model" without capability disclosure.

---

## 5. What this means for the from-scratch platform

Applied conclusions now recorded in `separate-platform-v1-design.md`:

- Own the **runtime + product surface**; treat SDKs, ACP, MCP, container runtimes, and model adapters as replaceable edges.
- Canonical **append-only event log**; prompts are derived projections with recorded provenance and omissions.
- **Four separate concepts** modeled explicitly: history, checkpoint, approval, containment — each with its own UI surface and honesty statement.
- **Execution backend chosen per task** with a clear merge/apply path; Docker/VM/OS-sandbox only where actually enforced.
- **Conflict-aware restore** and explicit restore scope.
- **Per-capability boundary disclosure** in the UI, generated from an inventory rather than marketing copy.

---

## 6. Remaining research plan (for the later phase)

Priority-order verification of the unverified leads, grouped to avoid re-reading duplicates:

1. **Memory/state runtimes:** Letta, Mem0, Zep, Graphiti, Cognee, Hermes Agent, OpenClaw — what durability model actually survives crashes.
2. **Orchestration/durability:** LangGraph internals, Temporal patterns, Burr, Pydantic AI durable execution — checkpoint-at-instruction vs at-boundary.
3. **Sandbox/execution:** E2B, Daytona, Modal, Docker patterns, Windows containment options — measurable isolation evidence, not claims.
4. **Computer/browser use:** Browser Use, Stagehand, Skyvern, WebArena — verification semantics for visual work.
5. **Evaluation:** SWE-bench, Inspect AI, Braintrust, Langfuse, Arize — how to measure task success rather than token speed.
6. **Multi-agent:** CrewAI, AutoGen/AG2, MetaGPT, CAMEL, AgentScope — only if delegation proves necessary.
7. **Tool discovery:** MCP-Zero, ToolRAG — evidence for on-demand tool selection.
8. **Legacy/adjacent:** Roo Code, Void, PearAI, Mentat, Plandex, Crush, AutoGPT, BabyAGI, OpenHarness, Agent Zero — mine for ideas, not dependencies.

Each entry needs: primary-source citations, version/date, verified vs unknown, and a merge/adapt/reject decision.

---

# 7. Second research pass — remaining ~70 leads (2026-11-11)

Four parallel source-cited passes covered the catalog entries that were still leads. This section records the decision-relevant findings. Full per-claim citation indexes live in the pass outputs; commit-pinned URLs below are stable.

## 7.1 Memory, state and always-on agents

**Verified products:** Letta / Letta Code, Mem0, Zep + Graphiti, Cognee, claude-mem, RAGFlow, Chroma, Hermes Agent, OpenClaw, Agent Zero, OpenHarness, Khoj, OpenAgents, PraisonAI, Agent Squad, TaskWeaver (archived).

### Concrete durability mechanisms found (the useful part)

| Product | Mechanism | Evidence |
|---|---|---|
| **Hermes Agent** | **Write-ahead log** (`hermes_state_wal.py`), **lock guard** (`hermes_state_lockguard.py`), **FTS index** (`hermes_state_fts.py`), separate `memory_manager` / `memory_context` / `context_compressor` | commit-pinned src |
| **Letta Code** | **Memory filesystem** with **confinement** (`memory-confinement.ts`), MemFS sync over websocket, local store = `messages.jsonl` + `agents/<id>.json` | commit-pinned src; durability contract itself **unknown** |
| **claude-mem** | SQLite schema + **restore-swap** backup/restore path | commit-pinned src |
| **Graphiti** | Temporal graph; **LLM-driven contradiction classification**, `invalidated_edges` returned, soft-delete on persist | src for prompt + return shape; **inferred** for persistence step |
| **Agent Zero** | Memory helpers + explicit **consolidation** pass | commit-pinned src |
| **Agent Squad** | Pluggable chat storage incl. SQL | commit-pinned src |
| **TaskWeaver** | Memory + experience modules | **archived** — historical only |

### Adopted into the design

1. **WAL + lock guard for session state.** Hermes's separation of write-ahead log from a lock guard is the right shape for crash-safe, concurrent session writes; it directly addresses the uncertain-effect problem.
2. **Separate the three concerns** that these products separate: `state durability` (WAL) ≠ `memory curation` (manager) ≠ `context projection` (compressor). Our design already separates the third; this confirms the first two must also stay distinct.
3. **Memory confinement as a scope primitive.** Letta's explicit confinement layer supports our rule that memory writes must be scoped (session / project / user / global) and authorized, not free-form.
4. **FTS over memory/history** for retrieval without embeddings — cheaper and deterministic for a local-first product; complements (not replaces) canonical paged history reads.
5. **Non-destructive invalidation** (Graphiti soft-delete rather than delete) matches Pi's non-destructive compaction principle and our "never destroy canonical history" rule.

### Rejected

- **Vector-store-first memory** (Mem0/Chroma/RAGFlow style) as the default session store. It adds an embedding dependency, non-determinism, staleness, and deletion/retention obligations that are disproportionate for a single-user coding session — and it cannot answer "what exactly did the agent do".
- **LLM-judged memory mutation** as the only curation path (Graphiti contradiction prompts). Adds model calls, cost, and silent wrongness. Keep as an optional, inspectable curation step.
- **Always-on autonomous daemons** (OpenClaw/Agent Zero style) as the primary product shape. Interesting for later; a coding platform needs explicit task boundaries first.

**Blocker noted:** memory products make deletion/retention claims variably; any adoption must publish a data-type-specific retention statement (repo clones, indexes, transcripts, logs, snapshots, secrets) rather than "no training".
