# Local Agent Workbench

A Windows desktop workbench for running a project-scoped coding agent with locally installed Ollama models. The desktop UI is a new Electron/React application. It communicates with the existing Python agent engine through a supervised JSON Lines sidecar; the installed product bundles that sidecar and does not need the original Python app directory.

## Current state

This is an early development build. The renderer, secure Electron bridge, worker adapter, Ollama discovery, project/session views, approval flow, MCP configuration, and change review are implemented. The desktop product has not yet passed its visible end-to-end acceptance run or the approved live model check. Treat it as a development build until those gates are complete.

## Requirements for development

- Windows 10/11 x64
- Node.js 24 and npm
- Python 3.12 with PyInstaller 6, pytest, and the packages in `sidecar/requirements.txt`
- The existing Python engine source directory for sidecar builds. By default the build script resolves the sibling `local-9b-dev-app` directory; set `LOCAL_AGENT_CORE_PATH` to override it.
- Ollama installed and running for model discovery and inference

Install dependencies and run the desktop shell:

```powershell
npm ci
npm start
```

Run checks:

```powershell
npm run typecheck
npm test
```

Create a bundled sidecar, package the app, or make the Windows installer:

```powershell
npm run sidecar:build
npm run package
npm run make
```

The Python executable is placed under `sidecar/dist/agent-worker.exe` and packaged in Electron resources. The sidecar is built from the shared Python engine and support modules at build time. Once installed, the app does not reference that source directory.

## Runtime behavior

- The initial model choice is `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M` when that exact tag is installed. Otherwise the app selects an installed model dynamically.
- Reasoning is omitted from Ollama requests so the selected model keeps its own default behavior.
- The app does not load a model on launch. It reads the model list, model metadata, current loaded-model list, and system telemetry.
- Model context comes from Ollama model metadata and is passed as `num_ctx`. The app does not silently clamp it. The task signal panel compares Ollama's reported allocation with the requested context when the selected model is loaded.
- Model generation has no application-level response deadline. Cancel closes only the active Ollama request; it does not call Ollama's stop/unload API.
- Saved sessions live under `%LOCALAPPDATA%\LocalAgentWorkbench\sessions`; local MCP configuration lives in the same app-data directory. Disposable workspace copies are stored under `workspaces` there.
- One run captures its selected project and session. The renderer disables workspace switching during a run, and the sidecar validates the session against the captured project.
- File access defaults to ask-before-write. Shell commands and MCP actions require approval. Use copy mode to review a disposable workspace before applying changes to the source project.

## Security boundaries

Electron uses context isolation, renderer sandboxing, disabled Node integration, a narrow preload bridge, sender validation for IPC, and a same-origin custom application protocol. The agent's built-in filesystem tools are scoped to the selected project and reject symbolic links and paths outside it. Shell commands use argv arrays and require approval. Local stdio MCP commands are user-configured processes; connect only servers you trust, since their tools may access resources outside the selected project.

## Decisions and deferred work

- Electron + React + TypeScript is the desktop framework.
- The Python engine remains the V1 inference/tool implementation behind the JSONL service boundary.
- A full TypeScript engine rewrite and subagents are deferred until this single-agent app is reliable.
- KV-cache or quantization tuning is not enabled automatically; evaluate it only with controlled quality/performance measurements.
- The app does not modify OpenCode configuration.

## Acceptance still required

1. Run the mocked suites and build the Windows sidecar/package.
2. Open the packaged app visibly against a disposable empty project. Exercise hello, a coding task, change review and approval, test output, request cancellation, save, and resume while confirming the workspace path throughout.
3. After those gates pass, run the previously approved live model check and record first-token delay, generation speed, effective context, and peak memory. Preserve any Ollama model that was already loaded before the check.
