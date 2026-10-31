# Local Agent Workbench

A Windows desktop workbench for a project-scoped coding agent. The original interface is an Electron/React application with a Python engine bundled as a supervised JSON Lines sidecar. The app currently supports models installed in Ollama, Hugging Face GGUF files through an explicitly selected llama.cpp server, and compatible Hugging Face Safetensors imports through Ollama.

## Current state

The Ollama workflow has prior visible disposable-project evidence recorded in [the acceptance log](docs/ACCEPTANCE_LOG.md). The current provider expansion, model-library UI, broad context/output controls, per-run auto-approval, and decision-required approval dialog pass automated checks; the expanded packaged UI flow and live GGUF path still need acceptance. Mocked MCP coverage exists, but a real stdio server has not been exercised in the packaged app. Do not treat these verification tiers as interchangeable.

## Requirements for development

- Windows 10/11 x64
- Node.js 24 and npm
- Python 3.12 with PyInstaller 6, pytest, and the packages in `sidecar/requirements.txt`
- The existing Python engine source directory for sidecar builds. By default the build script resolves the sibling `local-9b-dev-app` directory; set `LOCAL_AGENT_CORE_PATH` to override it.
- Ollama for installed Ollama models and imports
- A compatible llama.cpp Windows server executable chosen by the user to run GGUF models

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

- Installed Ollama models are listed dynamically. There is no fixed default model; the app selects an installed model and exposes controls based on provider metadata.
- The Model Library can search Hugging Face, pin a repository revision, select files, download GGUF, register local GGUF, choose a llama.cpp server executable, and explicitly load/stop the app-owned runtime. It can also import local or downloaded Safetensors directories into Ollama where that Ollama build supports their architecture.
- The app does not load a model on launch. It never stops an externally owned llama.cpp process and does not unload Ollama models as part of request cancellation or app shutdown.
- Reasoning defaults are preserved unless the selected model/runtime offers controls and the user chooses an override. Returned reasoning text can be inspected separately from the reasoning generation setting.
- Context and maximum output token caps are independent. Presets cover common binary and decimal sizes through 16,777,216 tokens plus exact model maxima when known; custom values are preserved exactly. Unknown model limits remain explicitly unknown. The selected values pass to inference unchanged, with requested and effective context reported separately.
- Model generation has no application-level response deadline. Cancel interrupts the active request without stopping Ollama or killing a runtime the app did not start.
- Saved sessions live under `%LOCALAPPDATA%\\LocalAgentWorkbench\\sessions`; local MCP configuration and model downloads live in the same app-data directory. Disposable workspace copies are stored under `workspaces` there.
- Each run captures its selected project and session. The sidecar validates the session against that project.
- File access defaults to ask-before-write. Shell commands and MCP actions require approval. Use copy mode to review a disposable workspace before applying changes to the source project. Auto-approve is an explicit per-run setting and off by default.

## Security boundaries

Electron uses context isolation, renderer sandboxing, disabled Node integration, a narrow preload bridge, sender validation for IPC, and a same-origin custom application protocol. The agent's built-in filesystem tools are scoped to the selected project and reject symbolic links and paths outside it. Shell commands use argv arrays and require approval. Local stdio MCP commands are user-configured processes; connect only servers you trust, since their tools may access resources outside the selected project. Hugging Face credentials are read from the user's existing local login/environment and are not written into URLs or progress events.

## Decisions and deferred work

- Electron + React + TypeScript is the desktop framework; the Python engine remains the V1 inference/tool implementation behind the JSONL service boundary.
- Ollama remains supported alongside opt-in llama.cpp GGUF runtime and Ollama Safetensors import. Arbitrary native Transformers checkpoints, cloud providers, a TypeScript engine rewrite, and subagents are deferred.
- KV-cache or quantization tuning is not enabled automatically; evaluate it only with controlled quality/performance measurements.
- The app does not modify OpenCode configuration.

## Remaining acceptance work

- Build the packaged Windows app and exercise the complete visible workflow in a fresh disposable project.
- Exercise Hugging Face search/download and one GGUF coding task through a user-selected compatible llama.cpp binary. No binary or model should be downloaded or loaded without an explicit UI action.
- Exercise a compatible Safetensors import and a real local stdio MCP server.
- Capture peak CPU, RAM, and VRAM during a coding turn with a time-series sampler; prior log values are observations, not measured peaks.
- Continue compatibility and recovery checks on a clean Windows install.
