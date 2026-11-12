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

## 7.2 Execution, sandbox, browser and computer-use

**Verified products:** E2B, Daytona, Modal, Docker Sandboxes, Browser Use (Cloud + OSS), Stagehand, Skyvern, Playwright, Puppeteer, WebArena, Crush, Plandex, Mentat, Open Interpreter (current Rust vs legacy Python).

### The decisive finding: cleanup is the real containment risk

Every product's documented failure mode is *not* escape — it is **orphaned state and orphaned cost**.

| Product | Expiry behaviour | Leak surface (documented) |
|---|---|---|
| E2B | 5 min default; `onTimeout:'kill'` destroys state, `'pause'` retains memory | **Paused sandboxes have no TTL — "kept indefinitely"**. Leak is billing, not processes |
| Daytona | auto-stop **15 min idle**, triggers even with processes running | `stop ≠ delete`; stopped sandboxes persist without an explicit delete policy |
| Modal | 5 min (max 24 h), plus `idle_timeout` | **Documented leak:** a readiness-probe `TimeoutError` *"does not automatically terminate the Sandbox"* — uncaught failure leaks a VM |
| Docker Sandboxes | persists until `sbx rm` | **No auto-reap documented** → highest laptop-side leak risk of the set |
| `docker run` | `--rm` or nothing | Needs `--init`/SIGCHLD reaper or grandchildren become zombies |
| Browser Use Cloud | `keepAlive` 120–14400 s; 4 h hard cap | *"Closing CDP does not stop a browser"* — nor its billing; a client timeout does **not** cancel the server-side run |
| Stagehand | explicit close | Persistent profile is **single-instance**; concurrent clients conflict |
| Skyvern | 240 min session cap (extendable to 360) | state in SQLite/Postgres |
| WebArena | per-run **reset to initial state** | the deterministic property worth copying |

### State persistence across runs

| Product | What survives |
|---|---|
| E2B | Filesystem **and memory** (running processes, loaded vars) via pause→diff→object storage; **volumes outlive sandboxes**; fork up to 100 |
| Daytona | Container: stopped/archived fs. VM: pause/resume **with memory**, fork, hot snapshot on S3 |
| Modal | fs 30 d, directory 30 d, **memory 7 d (not extendable)** |
| Docker Sandboxes | Everything in the VM across stop/restart; clone mode leaves a `sandbox-<name>` git remote |
| Stagehand | User data dir / `storageState` + **action cache** that replays deterministically with self-healing **off**, exposing `HIT`/`MISS`/`DISABLED` |
| Playwright | `storageState` JSON — cookies/localStorage but **not** sessionStorage |
| Crush | Per-project SQLite session history; `--yolo` is **first-wins per `--cwd`** across attached clients |

### Requirements this forces on our design

1. **A supervisor with two independent mechanisms:** a *timeout* and a *sweep*. Every reviewed product that only had one leaked something.
2. **Never assume handle-release works.** Modal and Browser Use each document a cleanup gesture that does not clean up. Our teardown must verify the resource is gone, then record the result.
3. **Distinguish state orphans from cost orphans**, and surface both to the user ("3 sandboxes still billed", "1 container from 2 days ago").
4. **Deterministic reset for verification environments** (WebArena's property): every verification run starts from a known state, or its evidence is not comparable.
5. **Publish TTLs explicitly**, per resource type — the products that leaked were the ones whose TTL was implicit or absent.
6. **Browser/computer-use evidence is not proof.** Screenshots and CDP liveness show appearance; only assertions, console/runtime errors, and repeatable interaction tests count as verification evidence.
7. **Windows reality:** none of the cloud sandbox providers solve local Windows containment. Our containment claim must come from an OS-boundary we implement and test, or be stated as unavailable.

### Adopted / rejected

- **Adopt:** explicit TTL + sweep supervisor; verified teardown; state-vs-cost orphan reporting; deterministic verification reset; `storageState`-style cookie/session capture (never sessionStorage); action-cache concept for repeatable browser steps.
- **Reject:** treating CDP/browser close as job completion; relying on a vendor's implicit reap; presenting a container as "sandboxed" when its network is open; counting screenshots as functional evidence.

## 7.3 Extensions, skills, tool discovery and evaluation

**Verified:** Anthropic Agent Skills (+ open `agentskills.io` spec), Everything Claude Code, Superpowers (+ quorum evals), GStack, Oh My Pi (two unrelated projects), AutoHarness (paper), RepoMaster (paper), Claw Code Agent (no canonical upstream), MCP-Zero (paper), ToolRAG (two unrelated projects), n8n, Langflow, LiteLLM, Langfuse, Arize Phoenix, Braintrust, Inspect AI, SWE-bench.

### ⚠️ Independent confirmation of this project's cache bug

This research pass measured and sourced exactly the failure mode fixed in the Workbench harness, without knowing about it:

> **KV/prompt reuse requires a byte-identical prefix.** Mutating the `tools` array mid-conversation invalidates that prefix and collapses cache reuse to zero — you save static tokens and pay a full re-prefill on every subsequent turn.

Sources: llama.cpp `timings.cache_n` = "number of prompt tokens reused from cache", total = `prompt_n + cache_n + predicted_n`; Ollama `prompt_eval_cached_count` = "number of prompt tokens read from the cache".

**Workbench already fixed this** (sticky per-task tool-schema selection, engine `1a4f939`). This is the first external corroboration that the diagnosis was correct.

**Design rule adopted:** append discovered tool schemas as a **message payload appended at the tail**, never by editing the `tools` array or the system prompt. Resolve tool packs *before* the first request so the prefix never shifts mid-session.

### Measured token economics (o200k_base proxy; ±10–15% vs Qwen/Llama tokenizers)

| Artifact | Tokens |
|---|---|
| One core tool schema (`edit_file`, 3 params) | **108** |
| One lean MCP tool | **125** |
| One skill catalog line | **30** |
| Cross-check: MCP-Zero's 2,797 tools | 248,100 total = **88.7/tool** |

| Resident catalog | Tokens | % of 65,536 window |
|---|---|---|
| 8 core tools | 864 | 1.3% |
| 12 core tools | 1,296 | 2.0% |
| 31 tools | 3,348 | 5.1% |
| 50 tools | 5,400 | 8.2% |
| 100 tools | 10,800 | 16.5% |
| 300 tools | 32,400 | 49.4% |
| 2,797 tools | 248,100 | **3.8 windows** |

A `find_tools` activation costs ≈ 150 (search tool) + 3–5 × 108 ≈ **500–700 tokens**.
**Break-even:** 12-tool core → never worth deferring; 50 tools → pays when ≥13% of turns don't need the full set; 300 tools → **~46× cheaper per activation**.

Anthropic's published guidance corroborates the shape: 5 MCP servers can consume ~55k definition tokens; tool search typically cuts >85%; **selection accuracy degrades past 30–50 tools**.

### Adopted extension/tooling model

| Layer | Decision | Why |
|---|---|---|
| Format | **Adopt Agent Skills verbatim** (`SKILL.md`, `name`/`description`/`allowed-tools`, `scripts|references|assets`) | Open spec; portable across Claude Code, Codex, Pi, Cursor |
| Versioning | `metadata.semver` + **sha256 content digest** + per-project `skills.lock.json`; updates are explicit, diffed | No filesystem skill format has versions today |
| Trust | Tiers `bundled → verified → community → local-draft`; **project skills gated on workspace trust**; unverified packs **hidden**, not listed-then-blocked | Official `agentskills` client guidance |
| Capability | `exec: none|script` declared; `allowed-tools` flows through normal permission — never auto-granted | Claude Code semantics; **hooks bypass permission systems** in at least one shipped pack |
| Context | Level-1 catalog only; per-pack token budget with a meter; **skill bodies exempt from compaction pruning** | 314-skill pack ≈ 15.7k–31.4k always-on tokens (24–48% of a 65k window) |
| Tool tiers | Tier 0 (8–14 core, byte-stable) · Tier 1 (declared packs, resolved at session start) · Tier 2 (`find_tools`, hybrid regex/BM25-first + vector fallback, server→tool prefilter) | Measured break-even math above; Anthropic ships regex **and** BM25, not embeddings-only |

### Adopted evaluation model

Four layers: **L0** deterministic (no model, CI-safe) → **L1** seeded tasks with executable criteria → **L2** behavioral (recovery, permissions, steering, skill triggering) → **L3** external benchmarks (never a KPI).

**Six metrics that matter, with exact source fields:**

| Metric | Definition |
|---|---|
| `task_success_rate` | Deterministic gate **first**; rubric grader only if it passed. Report `deterministic_pass` and `grader_pass` separately, never merged |
| `requests_per_task` | Model calls per task; median + p90 — the interactive-cost metric tokens/sec hides |
| `cached_token_ratio` | Ollama `prompt_eval_cached_count / prompt_eval_count`; llama.cpp `cache_n / (prompt_n + cache_n)`. **Assert it does not drop after a tool-discovery event** — turns the cache trap into a regression test |
| `recovery_correctness` | Fault-inject at every effect boundary (before approval, after approval before effect, after effect before log commit, mid-stream, mid-compaction). Assert no lost request, no double effect, no silent replay |
| `permission_violations` | Must be **0**; three counters: executed-without-approval, policy-bypassed (incl. hooks), denied-then-retried-via-alias |
| `false_verification_rate` | Agent claimed success while the deterministic gate failed |

Harness mechanics to copy: append-only JSONL event log + raw transcripts (never summarized for grading); limits distinguishing `time_limit` from `working_limit`; **private criteria and private post-checks** so the agent under test cannot read the answer; graders as code wherever possible.

### Rejected, with reasons

- **Full skill-body injection at startup** — linear, uncacheable context cost.
- **300+ skills enabled by default** — 24–48% of a 65k window before the user types.
- **Embeddings-only tool retrieval** — exact tool names beat semantics; Anthropic ships regex + BM25; the headline accuracy figure rests on n=56.
- **Langfuse / Phoenix / Braintrust as embedded dependencies** — 4-service stack / ELv2 hosting restriction / control plane always vendor-side. Emit OTLP optionally; keep the canonical record local.
- **n8n as automation/eval layer** — license forbids distribution and third-party hosting.
- **SWE-bench as a product KPI** — see below.
- **Auto-update to main / install-time code execution** — documented supply-chain incidents in this ecosystem.

### Why SWE-bench is a lab test, not a KPI

| Finding | Number | Source |
|---|---|---|
| Successful patches involving direct solution leakage | **32.67%** | SWE-MERA (arXiv 2507.11059) |
| Passes due to inadequate tests | **31.08%** | same |
| Buggy-file-path identification from issue text alone | up to **76%** | The SWE-Bench Illusion (arXiv 2506.12286) |
| Experienced devs using AI on their own repos: forecast / believed / actual | −24% / −20% / **+19% slower** | METR RCT, 246 tasks (arXiv 2507.09089) |

It measures one-shot autonomous patching against a known oracle on saturated public issues. It does not measure steering, interruption, approval friction, cache behavior, recovery, or human time-to-reviewable-result.

## 7.4 Multi-agent platforms and general frameworks

**Method:** live GitHub API status, PyPI/npm release cadence, unpacked wheels read at source (CrewAI 1.15.39, ADK 2.14.0, Haystack 3.5.0, AG2 1.3.1, AgentScope 2.0.11, smolagents 1.26.0, llama-index-workflows 2.26.1, burr 0.42.0) plus raw LangGraph checkpointer source.

### Status corrections — six of these are dead, dying, or renamed

| Product | Reality |
|---|---|
| **Microsoft AutoGen** | **ARCHIVED.** README: *"no longer actively maintained… Microsoft is not providing bug fixes, security fixes… we continue to advise against production use."* Superseded by Microsoft Agent Framework |
| **Semantic Kernel** | **Superseded.** README banner: *"now Microsoft Agent Framework"* |
| **Flowise** | **SHUT DOWN** — repo archived 2026-08-13; maintainers: *"we've decided to wind down our operations… fork the repo"* |
| **SuperAGI** | **Abandoned** — no push since 2025-01-22 (~22 months) |
| **AgentVerse** | **Dead** — PyPI 0.1.8.1 (2023-10-27), no push since 2024-09-09 |
| **MetaGPT** | **Stale OSS** (release 2025-03-09); company pivoted to closed SaaS **MGX** |
| **Llama Stack** | **Renamed to OGX** — *"The name changed, and so did the mission"* |
| **Burr** | Moved to **Apache incubating**; `burr` is now a shim for `apache-burr` |
| **ChatDev** | v2.0 "DevAll" is a **different product**; 1.0 on a maintenance branch |
| **AutoGPT** | Now a **hosted multi-tenant SaaS**; the classic loop is gone |

**Stars are not evidence:** Flowise had 55.6k★ and shut down. MetaGPT has 71.2k★ and is stale. AutoGen had 61.8k★ and was archived.

### The finding that matters most: CrewAI has no security model

`crewai/security/security_config.py` ships with literal source comments where auth and scoping should be:

```
"Authentication credentials *TODO*"
"Scoping rules *TODO*"
"Impersonation/delegation tokens *TODO*"
```

The implemented "security" is a `Fingerprint` (uuid5) used for tracking/auditing. **CrewAI has no tool-permission or sandbox model in the library** — approval is prompt/HITL-shaped, not enforced. Despite marketing language and 60.8k★.

### Durability models, ranked by actual guarantee

| Product | Guarantee | Honest limitation |
|---|---|---|
| **LangGraph** | `sync` / `async`(default) / `exit` modes; checkpoint = versioned channels, `versions_seen`, `source ∈ {input,loop,update,fork}` | **`async` can lose the last superstep on hard crash**; `exit` can lose the run. "Resumes exactly where it left off" is only true under `sync` |
| **Google ADK** | Append-only events; `app:`/`user:`/`temp:` scoped state; SQLite backend with `StaleSessionError` | Documented: *"ADK resumes the invocation in a best-effort manner: tool call to resume needs to be idempotent because we only guarantee an at-least-once behavior… temporary/in-memory state will be lost"* |
| **CrewAI 1.x** | Flow per-method persistence + Crew checkpoint DAG with `fork()`/`prune(max_keep, branch)` | **The interrupted unit re-runs** (their code comment admits it) |
| **LlamaIndex Workflows** | `StateCheckpoint` + JSON-patch `diff()` | Own docstring: *"Mutating a value from `store.get` changes every checkpoint sharing that value. The diff cannot detect those edits."* |
| **Haystack** | Pipeline `PipelineSnapshot` at breakpoints | File saving **off by default**; no agent-level crash contract |
| **Vercel AI SDK v7** | `WorkflowAgent` + `'use step'` durable tools; **signed approvals** via `experimental_toolApprovalSecret` | Requires **Workflow DevKit runtime** — durability is a runtime you adopt, not a library property |
| **smolagents / AG2 / CAMEL / OWL / MetaGPT / ChatDev / SuperAGI / BabyAGI** | **No checkpoint/resume contract** | Crash = restart the run |

### Security honesty, per product

| Product | Enforced boundary |
|---|---|
| **smolagents** | Own README: `LocalPythonExecutor` *"is not a security sandbox… can be bypassed and must not be used as a security boundary"* — delegates to E2B/Modal/Docker |
| **AI SDK** | `needsApproval` predicate + **cryptographically signed** approvals (only product treating "client rewrites history before replay" as a threat) |
| **AgentScope** | Per-backend sandbox (Docker/bubblewrap/E2B/K8s) — breadth ≠ strength |
| LangGraph / ADK / Haystack / LangChain / SK / CrewAI / Burr / LlamaIndex | **None built in** |

### Reusable concepts adopted

1. **Checkpoint schema discipline** (LangGraph): format `v`, monotonic `id`, `source` enum, parent ids. Our snapshots lack a format version and a fork concept — both cheap.
2. **`sync` durability for tool-calling steps.** Local runs are slow and user-visible; losing a step is unacceptable and our one-run-at-a-time model makes the throughput cost ~zero.
3. **Scoped state keys** (ADK `app:`/`user:`/`temp:`) so the task checkpoint doesn't become a junk drawer.
4. **Compaction with overlap + retention count** (ADK `EventsCompactionConfig`) — overlap is what stops a summary losing the turn boundary that just happened.
5. **AG2's replay-invariant table** as a test suite: never emit a tool result without its call; never emit tool calls without the provider turn item. These are exactly the orphan-tool-result bugs that make local models hallucinate.
6. **CrewAI's `fork()`/`prune()`** — make "retry with duplicate-action warning" create an inspectable branch instead of mutating the only timeline.
7. **LlamaIndex's warning as a rule:** never hand out mutable references to committed state.
8. **AI SDK's `needsApproval` predicate shape** — per-tool rules rather than one global mode.
9. **Explicit at-least-once disclosure** in user docs — our "uncertain operation" model is a superset; say it in the same words.

### Rejected

- **LangChain / LangGraph as a runtime dependency** — we'd get the schema ideas for free in a day; the cost is a large dependency graph, `async`-by-default durability, and a SaaS observability story. Our engine is already checkpointed behind JSONL; adopting a graph runtime means rewriting `TurnContext`, approvals, and the two-store journal.
- **CrewAI runtime** — its security module is `*TODO*`; role-teams add handoffs without containment.
- **AutoGen, Semantic Kernel, Flowise, SuperAGI, AgentVerse, BabyAGI, MetaGPT repo** — unmaintained or superseded, no security-fix commitment.
- **Dify / Agno AgentOS / AgentScope service tier / AutoGPT platform** — multi-tenant control planes (RBAC, tenancy, scheduling, marketplaces): pure overhead for one user and each is a surface to defend.
- **Role-team / SOP / society abstractions** — token multiplier, handoff failure modes, and it destroys the linear recoverable transcript our architecture depends on.
- **`LocalPythonExecutor` as containment.**

### Subagent verdict: almost never for open-ended coding

Multi-agent multiplies tokens by agent count and failure probability by handoff count — paid in the currency local models have least of (context window, tool-call reliability). Every serious durability contract surveyed exists to make a **single linear run** recoverable; none makes a *team* recoverable trustworthily.

Worth it, in order, and all three are really *tools* not agents:
1. **Read-only fan-out with a hard output token budget** — N searches → one merged summary.
2. **A differently-prompted verifier pass** — a second call, not a subagent.
3. **Context isolation for an oversized artifact** — "return <N tokens of facts".

**Architectural precondition:** a subagent must be a **child session with its own journal, own approval scope, and token budget**; the parent records only the handoff. An in-process nested agent inherits none of our recovery contract and would silently break "never replay a tool automatically". If that is too expensive to build, the honest answer is **no subagents**.

---

# 7.5 Second-pass depth dossiers (2026-11-11)

A second round of full-depth dossiers was commissioned in 4 batches of 10. One batch failed on a provider rate limit; two batches (memory/state, frameworks) were found to substantially duplicate §7.1 and §7.4 already on record. This section records the batch that added new ground: **execution / browser / evaluation**.

Products: Playwright, Puppeteer, WebArena, Browser Use, Stagehand, Skyvern, Inspect AI, SWE-bench, LiteLLM, n8n. All versions verified live against GitHub API, npm and PyPI on 2026-11-11. Labels: `[doc]` docs, `[src]` source, `[paper]` preprint, `[measured]` verified in-session, `[marketing]` vendor claim, `[unknown]` not established.

## 7.5.1 Status and licence reality (the decisive table)

| Product | Version / date | Licence | Verdict |
|---|---|---|---|
| Playwright (Microsoft) | 1.65.0, 2026-11-05 | Apache-2.0 | Active; 99.9k★, only 32 open issues |
| Puppeteer (Google) | 25.17.0, browsers pkg 2026-11-10 | Apache-2.0 | Active; 95.8k★ |
| WebArena (CMU et al.) | v0.2.0, **2023-10-21** | Apache-2.0 | **Frozen / superseded** by AgentLab + WebArena-Infinity |
| Browser Use | 1.0.2, **same day as research** | MIT | Extremely active; rewritten architecture in v1.0 |
| Stagehand (Browserbase) | TS 4.4.0 / Py 0.3.11 | MIT | Active; **Python lags a major version** |
| Skyvern | 1.0.57, 2026-11-06 | **AGPL-3.0** | Active; **licence blocks proprietary embedding** |
| Inspect AI (UK AISI) | 0.3.289, 2026-11-10 | MIT | Very active; 200+ shipped evals |
| SWE-bench (Princeton) | PyPI 5.0.2 | MIT | Active; **no GitHub release tags** |
| LiteLLM (BerriAI) | 1.109.0, 2026-11-11 | MIT + paid `enterprise/` | Active; **5,132 open issues**; LICENSE references a non-existent `enterprise/LICENSE` (actual file is `LICENSE.md`) |
| n8n | 2.47.4, 2026-11-11 | **SUL** + Enterprise for `.ee.` | Active; 210k★; **SUL forbids the exact use case of an agent platform** |

**Measured licence/footprint facts:**
- LiteLLM ships a **native `win_amd64` abi3 wheel, no compiler needed**, with **0 `enterprise/` files** — the PyPI distribution is MIT-clean. Unpacked size **131.6 MB** (proxy is 1,811 of 4,075 files). `litellm-core` exists as a smaller alternative but was not measured.
- n8n's own License FAQ forbids *"external end users … build or configure their own workflows through your product, whether via a custom UI, our API, MCP, **or an AI agent acting on the user's behalf**"* and states *"The SUL test is not about UI visibility — it is about who controls the workflow logic."* A desktop agent platform is the forbidden case; embedding requires a commercial agreement.
- Skyvern's AGPL-3.0 has no dual-licence carve-out in the repo.

## 7.5.2 What each actually enforces vs. advertises

| Product | Boundary reality |
|---|---|
| Playwright | **Storage isolation only** (`BrowserContext` = incognito-equivalent). No OS boundary. `storageState` is a bearer credential — Playwright's own docs warn against committing it. Driving the user's real Chrome via `userDataDir`/`connectOverCDP` inherits **every logged-in session**. |
| Puppeteer | Same, and weaker: no worker-per-test discard, no fixture lifecycle, isolation entirely opt-in. Manual cookie handling. |
| WebArena | Real Docker sites, but **no enforced reset between runs**; mints **auto-login cookies for every site** — the agent is a pre-authenticated superuser by design. |
| Browser Use | Its own README: *"a guard for an aligned model, **not a sandbox**"*; *"The REPL worker runs model-written Python as your user"*; the 0.x file allowlist was **removed** in v1.0; local modes open an **unauthenticated CDP port on 127.0.0.1**. Env allowlist matching `KEY\|TOKEN\|SECRET\|PASSW` — *"That is all the allowlist does."* |
| Stagehand | Local mode = your Chrome + deliberately persistent cookies. Cloud cache/replay/proxies are Browserbase-gated: *"with a local browser … the `cache` option has no effect and every call runs inference."* |
| Skyvern | Component-separated services; **credential indirection is genuinely good** (model calls `login(credential_type, credential_id)` — value never enters model context). But `BROWSER_TYPE=cdp-connect` + `browser serve --tunnel` let Skyvern Cloud drive your local Chrome — account takeover as a feature. |
| Inspect AI | **Sandbox is opt-in per call** — its own docs: *"Provisioning a sandbox does not automatically run tools… in the container. … only work that it requests through the `sandbox()` interface runs in the container."* Separates **Approvers** (pre-execution) from **Tool Result Review** (post-execution, before model sees it) — two distinct policy hooks. |
| SWE-bench | Strong per-instance Docker. But the harness will *force* patches to apply (`--3way`, `--reject`, `patch --fuzz=5`), and its result cache is keyed only on `run_id`+`instance_id` — re-running with different predictions **silently reuses the first run's results**. |
| LiteLLM | Gateway credential boundary (virtual keys, budgets). Not a filesystem/process boundary. |
| n8n | **Unsafe by default**: *"Task runners are the only isolation layer between user-provided code… Without them, or with internal mode, anyone who can edit a workflow could potentially read your database, encryption key, stored credentials, and environment variables."* Hardening list: distroless image, `nobody:65532`, read-only rootfs, AppArmor `audit deny @{PROC}/[0-9]*/{environ,mounts} rwl,`. |

## 7.5.3 Verification: who produces evidence vs. appearance

| Product | What "success" means |
|---|---|
| **Playwright** | **Evidence** — web-first auto-retrying assertions on the live DOM. Caveats: proves the client-observable surface only; assertion quality *is* evidence quality; `toHaveScreenshot()` is the weakest form (pixel diffs, OS/font/AA variance). Ships **planner → generator → healer** agents via `npx playwright init-agents`. |
| **Puppeteer** | **Appearance** — waits not assertions, no DOM trace, **no HAR** (measured absent from `docs/guides/`). You build everything. |
| **WebArena** | **Contaminated** — ABC paper: *"WebArena overestimates performance of agents by 5.2% due to various issues in its string matching"*; for "N/A" tasks **the LLM judge accepts an empty reply as correct** — a do-nothing agent passes. |
| **Browser Use** | **Self-report** — `result.is_successful()` is the model's own `finish(success)` verdict; docs: *"verify important external actions independently."* |
| **Stagehand** | **Evidence-capable** — `observe()` returns **real Playwright selectors**, so an AI decision becomes a durable program fragment you can hand to `expect()`. But `act()` **self-heals**, trading flakiness for silent semantic drift. |
| **Skyvern** | **LLM opinion** — `page.validate()` returns an uncalibrated `bool`; `page.extract()` is schema-typed (checkable). Rich artifacts (recording + HAR + per-action screenshot/reasoning) but nothing deterministic. |
| **Inspect AI** | **Strongest** — immutable transcript as evidence; **deferred, re-runnable, editable scoring** (`--no-score` then `inspect score` over history). Judge-validity is unsolved but it integrates CJE calibration. |
| **SWE-bench** | **Best mechanism, worst measurement** — two-sided FAIL_TO_PASS + PASS_TO_PASS contract, but: 7.7% Lite / 5.2% Verified pass **without correct patches**; **76%** buggy-file-path accuracy from issue text alone (memorization, dropping to ~53% on unseen repos); insufficient test cases; Pro-level gold leakage. |
| **LiteLLM** | **None** — transport. Contributes cost/provenance evidence (which model/deployment actually answered when fallbacks fire). |
| **n8n** | **None** — proves a workflow *ran*, not that the world changed. Per-node I/O JSON is the useful artifact. |

## 7.5.4 Mechanisms worth stealing (ranked)

1. **Playwright's trace format** — before/action/after DOM snapshot triples + screencast + network slice + console, indexed by one action timeline, replayable offline from a single zip. The correct target format for "prove the agent's UI change worked."
2. **Inspe

---

# 7.5 Second-pass depth dossiers (2026-11-11)

A second round of full-depth dossiers was commissioned in 4 batches of 10. One batch failed on a provider rate limit; two batches (memory/state, frameworks) substantially duplicate sections 7.1 and 7.4 already on record. This section records the batch that added new ground: **execution / browser / evaluation**.

Products: Playwright, Puppeteer, WebArena, Browser Use, Stagehand, Skyvern, Inspect AI, SWE-bench, LiteLLM, n8n. Versions verified live against GitHub API, npm and PyPI on 2026-11-11. Labels: `[doc]` docs, `[src]` source, `[paper]` preprint, `[measured]` verified in-session, `[marketing]` vendor claim, `[unknown]` not established.

## 7.5.1 Status and licence reality

| Product | Version / date | Licence | Verdict |
|---|---|---|---|
| Playwright (Microsoft) | 1.65.0, 2026-11-05 | Apache-2.0 | Active; 99.9k stars, only 32 open issues |
| Puppeteer (Google) | 25.17.0, 2026-11-10 | Apache-2.0 | Active; 95.8k stars |
| WebArena (CMU et al.) | v0.2.0, **2023-10-21** | Apache-2.0 | **Frozen / superseded** by AgentLab + WebArena-Infinity |
| Browser Use | 1.0.2, same day as research | MIT | Extremely active; v1.0 is a rewritten architecture |
| Stagehand (Browserbase) | TS 4.4.0 / Py 0.3.11 | MIT | Active; **Python lags a major version** |
| Skyvern | 1.0.57, 2026-11-06 | **AGPL-3.0** | Active; **licence blocks proprietary embedding** |
| Inspect AI (UK AISI) | 0.3.289, 2026-11-10 | MIT | Very active; 200+ shipped evals |
| SWE-bench (Princeton) | PyPI 5.0.2 | MIT | Active; no GitHub release tags |
| LiteLLM (BerriAI) | 1.109.0, 2026-11-11 | MIT + paid enterprise/ | Active; 5,132 open issues; LICENSE references a non-existent `enterprise/LICENSE` (actual file is `LICENSE.md`) |
| n8n | 2.47.4, 2026-11-11 | **SUL** + Enterprise for `.ee.` | Active; 210k stars; **SUL forbids the exact use case of an agent platform** |

**Measured licence/footprint facts:**
- LiteLLM ships a **native win_amd64 abi3 wheel, no compiler needed**, with **0 enterprise/ files** — the PyPI distribution is MIT-clean. Unpacked size **131.6 MB** (proxy is 1,811 of 4,075 files).
- n8n's own License FAQ forbids *"external end users ... build or configure their own workflows through your product, whether via a custom UI, our API, MCP, **or an AI agent acting on the user's behalf**"* and states *"The SUL test is not about UI visibility — it is about who controls the workflow logic."* A desktop agent platform is the forbidden case; embedding requires a commercial agreement.
- Skyvern's AGPL-3.0 has no dual-licence carve-out in the repo.

## 7.5.2 What each actually enforces vs. advertises

| Product | Boundary reality |
|---|---|
| Playwright | **Storage isolation only** (BrowserContext = incognito-equivalent). No OS boundary. `storageState` is a bearer credential — Playwright's own docs warn against committing it. Driving the user's real Chrome inherits **every logged-in session**. |
| Puppeteer | Same, and weaker: no worker-per-test discard, no fixture lifecycle, isolation entirely opt-in. |
| WebArena | Real Docker sites, but **no enforced reset between runs**; mints **auto-login cookies for every site** — the agent is a pre-authenticated superuser by design. |
| Browser Use | Its own README: *"a guard for an aligned model, **not a sandbox**"*; *"The REPL worker runs model-written Python as your user"*; the 0.x file allowlist was **removed** in v1.0; local modes open an **unauthenticated CDP port on 127.0.0.1**. Env allowlist matching KEY/TOKEN/SECRET/PASSW — *"That is all the allowlist does."* |
| Stagehand | Local mode = your Chrome + deliberately persistent cookies. Cloud cache/replay/proxies are Browserbase-gated: with a local browser the cache option has no effect and every call runs inference. |
| Skyvern | Component-separated services; **credential indirection is genuinely good** (model calls `login(credential_type, credential_id)` — value never enters model context). But `BROWSER_TYPE=cdp-connect` + `browser serve --tunnel` let Skyvern Cloud drive your local Chrome — account takeover as a feature. |
| Inspect AI | **Sandbox is opt-in per call** — its own docs: *"Provisioning a sandbox does not automatically run tools... in the container."* Separates **Approvers** (pre-execution) from **Tool Result Review** (post-execution, before model sees it) — two distinct policy hooks. |
| SWE-bench | Strong per-instance Docker. But the harness will *force* patches to apply (--3way, --reject, patch --fuzz=5), and its result cache is keyed only on run_id+instance_id — re-running with different predictions **silently reuses the first run's results**. |
| LiteLLM | Gateway credential boundary (virtual keys, budgets). Not a filesystem/process boundary. |
| n8n | **Unsafe by default**: *"Task runners are the only isolation layer between user-provided code... Without them, or with internal mode, anyone who can edit a workflow could potentially read your database, encryption key, stored credentials, and environment variables."* Hardening list: distroless image, nobody:65532, read-only rootfs, AppArmor deny on /proc/*/environ. |

## 7.5.3 Verification: who produces evidence vs. appearance

| Product | What "success" means |
|---|---|
| **Playwright** | **Evidence** — web-first auto-retrying assertions on the live DOM. Caveats: proves the client-observable surface only; `toHaveScreenshot()` is the weakest form. Ships **planner → generator → healer** agents via `npx playwright init-agents`. |
| **Puppeteer** | **Appearance** — waits not assertions, no DOM trace, **no HAR** (measured absent from docs/guides/). You build everything. |
| **WebArena** | **Contaminated** — ABC paper: WebArena overestimates agents by **5.2%** due to string-matching issues; for "N/A" tasks **the LLM judge accepts an empty reply as correct** — a do-nothing agent passes. |
| **Browser Use** | **Self-report** — `result.is_successful()` is the model's own verdict; docs: *"verify important external actions independently."* |
| **Stagehand** | **Evidence-capable** — `observe()` returns **real Playwright selectors**, so an AI decision becomes a durable program fragment you can hand to `expect()`. But `act()` **self-heals**, trading flakiness for silent semantic drift. |
| **Skyvern** | **LLM opinion** — `page.validate()` returns an uncalibrated bool; `page.extract()` is schema-typed. Rich artifacts but nothing deterministic. |
| **Inspect AI** | **Strongest** — immutable transcript as evidence; **deferred, re-runnable, editable scoring** over history. Judge-validity is unsolved but CJE calibration is integrated. |
| **SWE-bench** | **Best mechanism, worst measurement** — two-sided FAIL_TO_PASS + PASS_TO_PASS, but: **7.7%** Lite / **5.2%** Verified pass **without correct patches**; **76%** buggy-file-path accuracy from issue text alone (memorization, dropping to ~53% on unseen repos); insufficient tests; Pro-level gold leakage. |
| **LiteLLM** | **None** — transport. Contributes cost/provenance evidence (which model actually answered when fallbacks fire). |
| **n8n** | **None** — proves a workflow *ran*, not that the world changed. |

## 7.5.4 Mechanisms worth stealing (ranked)

1. **Playwright's trace format** — before/action/after DOM snapshot triples + screencast + network slice + console, indexed by one action timeline, replayable offline from a single zip.
2. **Inspect's evidence/verdict split** — immutable transcript; scoring recomputable, editable, re-runnable over history. Plus **two distinct policy hooks**: pre-execution approval vs post-execution result review. Plus the **control channel**: detach long runs, supervise from another process (cancel/requeue/pause/interim-score).
3. **SWE-bench's two-sided test contract** — new assertion flips to passing AND existing suite stays green. Plus `report <run_id>` = re-grade without re-running.
4. **Stagehand's observe() → selector handoff** — every AI action emits a durable deterministic artifact; verification re-runs the artifact, not the LLM.
5. **Skyvern's credential indirection** — credential_id, secret value never in model context. Strongest of the four secret patterns in this set.
6. **Browser Use's REPL collapse** — one tool as a language instead of 40 tools, *only if* run inside an OS sandbox you own.
7. **LiteLLM's normalised error taxonomy + per-call cost** — one retry/fallback policy instead of N; cost is part of the evidence.
8. **n8n's two-plane split** — control plane never executes user code; execution plane independently hardened. Plus execution-data redaction as a first-class feature.
9. **WebArena's id-based accessibility-tree action space** — stable ints over CSS selectors; deterministic, resolution-independent.

## 7.5.5 Licence floor for vendoring

- **MIT/Apache OK:** Playwright, Puppeteer, Browser Use, Stagehand, Inspect AI, SWE-bench, LiteLLM SDK.
- **Blocked:** Skyvern (AGPL-3.0), n8n (SUL forbids the agent-platform use case). Both are excellent *idea* sources and unusable *dependency* sources for a proprietary desktop product.

## 7.5.6 The design axis this batch names

> **Did the model's claim get converted into something re-executable?**

The best mechanisms in this set all convert LLM judgement into a deterministic artifact (Stagehand's selector, Skyvern's "replay agents as cached code", Inspect's transcript+rescoring, SWE-bench's FAIL_TO_PASS). The worst outcomes all come from trusting a self-report (Browser Use's `is_successful()`, Skyvern's `validate() -> bool`, WebArena's permissive matchers at -5.2%, SWE-bench's insufficient tests at 7.7%/5.2% false passes). This single axis determines whether the platform produces **evidence or appearance** — and it is now the platform's central design criterion.

## 7.6 Remaining uncovered leads (2026-11-11)

The failed batches were mostly redundant with §7.1/§7.4. These four items were genuinely uncovered; verified directly against GitHub/official sources.

### Crush (Charmbracelet)

| Field | Value |
|---|---|
| Repo | `charmbracelet/crush` — 29,052★, 2,365 forks, 535 open issues, licence "Other" |
| Status | **Active and fast-moving** — v0.48.0 (2026-03-12), v0.50.0 following; latest releases 2026 |
| Surfaces | Terminal TUI (macOS, Linux, **Windows PowerShell/WSL**, Android, FreeBSD/OpenBSD/NetBSD) + headless `crush run` |

**Distinctive mechanisms:**
1. **Subagents with live supervision** — background subagent teams visible in transcript/sidebar/header, with per-subagent names, mid-run follow-ups, stop, and **reassignment to a different model**. The most concrete subagent UX found in the catalog.
2. **Hooks across the whole run lifecycle**, not just tools: sessions, turns, and tool calls.
3. **Session management as a first-class CLI** — `crush session list`, `crush session {id}`, rename/delete, `--json` structured output, `--continue`/`--session` for headless session pickup. Sessions are browseable by both humans and agents.
4. **LSP-enhanced context** — uses the language server for additional context (rare among this set).
5. **Model switching mid-session while preserving context** — an explicit product feature.
6. MCP over http, stdio and sse.

**Disqualifiers:** licence is "Other" (not MIT/Apache — verify before vendoring); no published containment model; 535 open issues suggests high churn; no documented checkpoint/undo semantics in what was retrieved.

**ADOPT:** the session-listing/headless-session contract (`--json`, `--continue`, `--session`) as the CLI/automation surface; live subagent supervision UX as the reference for a later subagent design; whole-run hooks as an extension lifecycle.
**VERIFY:** licence terms; checkpoint/recovery semantics.

### Plandex

| Field | Value |
|---|---|
| Repo | `plandex-ai/plandex` — 15,908★, 1,190 forks, 71 open issues, **MIT** |
| Status | **Open source active; Plandex Cloud wound down 2025-11-07.** New trials/subs/credits disabled; OSS remains on GitHub |

**Distinctive mechanisms:**
1. **Cumulative diff review sandbox** — AI changes stay separate from project files until the developer applies them; command execution is controlled for rollback/debug. The strongest "changes are staged, not applied" model found.
2. **2M-token effective context** with default model pack (~100k/file); loads only what each step needs; **tree-sitter project maps** for indexing 20M+ token directories.
3. **chat / tell mode** — chat for fleshing out ideas, tell mode for detailed plans and code, with an explicit prompt to switch.

**Disqualifiers:** its Cloud business failed — a cautionary data point for hosted-agent economics; no published sandbox/containment model; single-vendor OSS.

**ADOPT:** the cumulative diff-review sandbox as the default apply flow (changes staged → review → apply); tree-sitter structural maps as the large-repo context path.
**REJECT:** chat/tell mode split as a UX — mode confusion is a known cost; prefer explicit intent (already in Workbench).

### Mentat (AbanteAI)

| Field | Value |
|---|---|
| Repo | `AbanteAI/archive-old-cli-mentat` — 2,539★, **ARCHIVED** |
| Status | **Dead — twice.** CLI archived (README: "⚠ ARCHIVED PROJECT ⚠, no longer maintained"), renamed to an AI GitHub bot; that successor is also gone (mentat.ai DNS fails as of Aug 2026, repo 404s) |

**Historical value only:** one of the first open-source terminal coding assistants (Python, 2023); auto git-context sync (detected repo/branch) and multi-file edits from natural language.

**ADOPT:** nothing operational. **Record as lineage evidence:** the terminal-coding-assistant category has high mortality — a product in this space must plan for migration/export of sessions, rules and checkpoints. Reinforces the platform's portability requirement.
**REJECT:** any dependency or design that assumes a single vendor's continuity.

### Langflow

| Field | Value |
|---|---|
| Repo | `langflow-ai/langflow` — **156,535★**, 10,387 forks, 1,307 open issues, **MIT** |
| Status | **Active, very fast** — v1.13.2 released 2026-11-10; v1.12 added OpenTelemetry (2026-09-01) |

**Distinctive mechanisms:**
1. **Visual builder + API + MCP server from one flow** — every workflow becomes an MCP tool; Python source access for any component.
2. **Extension bundles transition** (v1.12): default install is a curated provider set; opt-in providers installed separately (`langflow[bundles]` for all) — reduces default footprint and decouples release cadences.
3. **Plain OTLP** OpenTelemetry for service health and flow runs — any OTel backend works, no vendor lock.

**Disqualifiers:** 1,307 open issues; visual-graph-of-coding-loop is a negative pattern for a coding agent (from §7.4); multi-tenant/enterprise platform shape is overhead for a single-user local product.

**ADOPT:** the **extension-bundle model** (curated defaults + opt-in extras) as the packaging pattern for provider/tool packs in our platform; plain-OTLP as the optional observability export.
**REJECT:** visual workflow canvas as the primary coding-agent interface; Langflow as a runtime dependency.

### Consolidated verdict

The catalog's genuinely uncovered leads are now covered. Two dead products (Mentat, Plandex Cloud), one licence-unverified but feature-rich product (Crush), one enterprise platform (Langflow). The high-value adoptions are all **patterns, not dependencies**: staged diff review, tree-sitter repo maps, headless session contracts, subagent supervision UX, extension bundles, and OTLP export.
