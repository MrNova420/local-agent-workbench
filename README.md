# Local Agent Workbench

![Status: unstable beta](https://img.shields.io/badge/status-unstable%20beta-orange)
![Platform: Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![Electron](https://img.shields.io/badge/desktop-Electron-47848F)
![Python sidecar](https://img.shields.io/badge/agent%20engine-Python-3776AB)

**A local-first coding-agent workbench for building real projects with the models and runtimes on your own machine.** Electron + React provides the desktop app; a supervised Python sidecar runs the agent loop, project tools, inference adapters, and MCP integrations.

> **Unstable beta:** this is active development software. Back up your project, review every proposed change, and keep per-action approvals enabled. The current command runner executes with your Windows account permissions; project scoping and approval dialogs are not an operating-system sandbox.

## What it does

- Connects to installed Ollama models and optional Hugging Face GGUF models through a user-selected llama.cpp server. Model availability is discovered dynamically.
- Streams reasoning/text, tool activity, command output, usage, and resource readings into a reviewable project workflow.
- Provides project-scoped search, file reads and edits, patches, Git review, plans, checks, and optional discoverable skills.
- Supports per-action, per-task, and explicit auto-approval modes; risky actions remain reviewable, and host-command boundaries are disclosed.
- Stores resumable sessions in the app library and mirrors them into project workspaces, with recovery and activity history.
- Accepts local stdio and remote HTTPS Streamable HTTP MCP integrations with environment-backed credentials.
- Keeps the selected model's context, output cap, and reasoning settings distinct. Values are passed through without silent lowering; runtime-effective values are shown where available.
- Remembers the selected context/output values across fresh windows (defaults: 65,536 / 8,192). Choosing another Ollama model starts a background preload at the selected context; the PRELOAD control repeats it for the current choice. Preload does not send a prompt or reasoning/output override, and safely skips if another model is already loaded or Keep Alive is set to immediate unload.

## Product direction

The target is broad Codex/OpenCode-style coding-agent workflow parity with local implementations where hosted services are unavailable. The parity register and evidence tiers are maintained in [`docs/CORE_HARNESS_READINESS.md`](docs/CORE_HARNESS_READINESS.md). The app is **not yet release-ready or at full parity**: visible package acceptance and several core safety/integration items remain open. Read [`docs/ACCEPTANCE_LOG.md`](docs/ACCEPTANCE_LOG.md) for dated evidence and [`docs/PRODUCT_BACKLOG.md`](docs/PRODUCT_BACKLOG.md) for priorities.

## Build from source

Requirements: Windows 10/11 x64, Node.js 24, Python 3.12, and the paired [`local-agent-workbench-core`](https://github.com/MrNova420/local-agent-workbench-core) repository checked out next to this repository as `local-9b-dev-app`.

```powershell
npm ci
$env:LOCAL_AGENT_CORE_PATH = "..\local-9b-dev-app"
npm run typecheck
npm test
npm run make
```

`npm run make` builds the Python sidecar and creates the Windows Squirrel installer and ZIP under `out/make/`. Installed builds bundle the sidecar and do not read the sibling source checkout. Ollama is optional for app launch and is not started, stopped, or unloaded by the app as a side effect of launch or cancellation. llama.cpp is an optional user-selected runtime.

## Safety and privacy

- The app does not load a model when it opens. An explicit model selection or PRELOAD click may warm the selected Ollama model; inference runs only after the user starts a turn. Existing loaded models are left alone when preloading would replace or resize them.
- Built-in project file tools are scoped to the captured workspace. Commands and MCP servers run with the signed-in Windows account's OS permissions and may access other paths or network resources.
- Keep credentials in environment variables and reference them from MCP configuration. Do not commit `.env`, model files, session data, or user project content.
- Review the complete diff and run project-specific checks before applying changes to important work.

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and [`CONTRIBUTING.md`](CONTRIBUTING.md) for development guidance.

## Repository layout

- `src/` — Electron main/preload, React renderer, and shared typed protocol.
- `sidecar/` — JSON Lines worker, packaging requirements, and provider integration.
- `tests/` — renderer, protocol, and sidecar regression tests.
- `docs/` — architecture, decisions, acceptance evidence, parity audit, runtime plan, and backlog.
- `local-agent-workbench-core` — separately versioned Python engine; see `core-revision.txt` for the source revision paired with this checkout.

## Current verification snapshot

On 2026-10-31, app typecheck passed; 43 Vitest, 38 sidecar pytest, and 132 engine pytest tests passed. A Windows x64 Squirrel installer and ZIP built, and the bundled worker passed startup, ping, and shutdown. The packaged Home and a canceled saved session were visually inspected. Full visible coding/approval/cancellation acceptance and live-model benchmarks remain open. No inference was started for these checks.

## License

Licensed under the MIT License; see [`LICENSE`](LICENSE).
