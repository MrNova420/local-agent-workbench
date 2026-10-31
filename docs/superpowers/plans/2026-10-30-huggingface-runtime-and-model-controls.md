# Hugging Face Runtime and Model Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-aware model discovery, Hugging Face GGUF and Ollama Safetensors workflows, and per-model reasoning/context controls without regressing the current Ollama agent.

**Architecture:** Preserve the Electron UI and JSONL sidecar boundary. Replace the worker's Ollama-only assumptions with a typed provider registry; keep the current shared Python agent engine and adapt its runtime seam. Model capabilities flow from each provider to the renderer, and sessions persist the provider/model identity and effective generation settings. Add llama.cpp as an optional explicitly configured GGUF runtime; do not implement a native Transformers runtime in this phase.

**Tech Stack:** Electron, React, TypeScript, Python sidecar, existing Python agent engine, Ollama API, optional llama.cpp server API, Hugging Face Hub references.

**Status:** Queued plan only. Do not implement until the user explicitly asks to start execution.

**Spec:** `docs/MODEL_RUNTIME_EXPANSION.md`

## Global Constraints

- Preserve all existing Ollama functionality and existing session readability.
- Do not load a model on app launch.
- Do not stop or unload a model/runtime not started by the app.
- Cancel only the active request; do not kill Ollama or an unrelated runtime.
- Preserve requested context and output-token settings; surface effective allocation and errors.
- Treat context as total prompt-plus-generation capacity; expose it separately from maximum response tokens.
- Build context and output presets dynamically from model/runtime limits, including every supported standard tier, exact maximum, and custom values.
- Use model default reasoning unless the user selects an advertised supported value.
- Do not execute remote repository model code.
- Keep project/session capture and workspace isolation intact.
- Do not change OpenCode configuration.
- A pending approval requires an explicit approve, deny, or run-cancel decision; backdrop click, Escape, and close controls cannot dismiss it.
- Auto-approve is opt-in per run and off by default; it approves only otherwise-approvable actions within the captured workspace/access policy.
- Keep `Inspect changes` near the top of the Live Work Sheet, with no overlap at supported window sizes.

## Review Focus

- Unknown/missing reasoning metadata must leave default behavior intact, never infer that reasoning should be off.
- A model switch or resumed session must not carry settings that the new provider does not support.
- Context larger than runtime capacity must produce an explicit effective-limit/error state, not a hidden clamp.
- A context/output preset must produce the same values in the saved session and provider request; no preset may silently substitute a different limit.
- Cancellation during Hub download, model load, generation, and app shutdown must not kill unrelated processes or leave a falsely-ready provider.
- A Hugging Face model/filename or provider error must not leak credentials or make the source project available to the runtime.

---

### Task 1: Define the provider-neutral model contract

**Files:**
- Modify: `src/shared/protocol.ts`
- Create: `sidecar/providers/contracts.py`
- Create: `sidecar/providers/registry.py`
- Modify: `sidecar/worker.py`
- Test: `tests/test_worker.py`
- Test: `tests/test_provider_contract.py`

**Interfaces:**
- `ModelDescriptor`: stable `provider`, `model_id`, `display_name`, `source`, `format`, advertised `context`, `reasoning` capability, `tools` capability, and `runtime_state`.
- `ReasoningCapability`: `support` (`levels`, `toggle`, `unknown`, or `none`), `default`, and exact `values`.
- Provider adapter methods: `list_models()`, `model_info(model_id)`, `stream(state, messages, cancel, emit)`, and ownership-aware runtime status/cancel hooks.
- Session fields: `provider_id`, `model_id`, `reasoning`, `context`, `max_tokens`, and provider-scoped runtime settings; old sessions without `provider_id` migrate to Ollama.

- [ ] Write tests for descriptor serialization, stable identities across identical display names, and legacy-session migration to Ollama.
- [ ] Run the provider contract tests and confirm failures are limited to missing contract/adapter behavior.
- [ ] Implement shared contracts and registry; route current Ollama calls through the registry while retaining a compatibility path for existing `model` session fields.
- [ ] Run the provider contract tests and worker session tests.
- [ ] Commit `refactor: add provider-neutral model contracts` in the app repository.

### Task 2: Add capability-aware Ollama controls

**Files:**
- Modify: `../local-9b-dev-app/desktop_engine.py` (the current shared engine source used by `scripts/build-sidecar.ps1`)
- Modify: `sidecar/worker.py`
- Modify: `src/shared/protocol.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/test_engine_adapter.py`
- Test: `tests/test_worker.py`
- Test: `tests/model-controls.test.ts`

**Interfaces:**
- Ollama `model_info()` maps `/api/show` model context and `thinking.default` / `thinking.values` to `ModelDescriptor`.
- `RunOptions.reasoning` is `null` for model default, `boolean` for supported toggle, or the exact supported string level.
- Stream events distinguish `thinking` text from final `text`; the agent history retains provider-appropriate message fields.

- [ ] Test model-default requests omit `think`; test `false`, `true`, and exact string settings are passed only when supported.
- [ ] Test missing/unsupported metadata exposes no invented effort choices and sends no reasoning override.
- [ ] Test thinking stream chunks remain separate from answer text and session serialization can resume them without confusing tool-call messages.
- [ ] Test dynamic context presets include each supported standard tier and the exact model maximum, omit unsupported tiers, and retain a custom value.
- [ ] Test output-token presets respect known provider/model ceilings, stay distinct from context size, and pass the exact selected value to generation.
- [ ] Test that the computed prompt/input budget subtracts output reservation and system overhead without mutating the selected context window.
- [ ] Implement the Ollama capability mapping and add settings UI options `Model default`, `Off`, and exact advertised values. Add a separate show/hide control for returned reasoning text.
- [ ] Implement dynamic context and output preset selectors plus custom values; label total context, response-token cap, input budget, requested context, and effective allocation distinctly.
- [ ] Run adapter, worker, renderer, and typecheck checks.
- [ ] Commit this task in both the shared-engine repository and app repository.

### Task 3: Add optional llama.cpp GGUF provider and Hugging Face source flow

**Files:**
- Create: `sidecar/providers/llama_cpp.py`
- Modify: `sidecar/providers/registry.py`
- Modify: `sidecar/worker.py`
- Modify: `sidecar/requirements.txt`
- Modify: `src/shared/protocol.ts`
- Modify: `src/preload.ts` and `src/main.ts` only if process ownership events need IPC changes
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `scripts/build-sidecar.ps1` and `forge.config.ts` if runtime setup/package metadata requires it
- Create/modify: `tests/test_llama_cpp_provider.py`, `tests/test_worker.py`, and renderer tests

**Interfaces:**
- `llama.cpp` provider accepts a configured local `llama-server.exe` plus either a local GGUF path or a Hugging Face `owner/repository[:quant]` reference.
- Hub operations resolve a pinned repository revision and an explicit GGUF file selection; `huggingface_hub` uses its existing local authentication/cache. Model download data lives in the app's model cache, not in a project workspace.
- Runtime events include provider state, source download/load progress, actual model/context metadata, and ownership token for processes the app starts.
- New UI commands perform explicit runtime setup, add/download, load, and unload actions; app startup only discovers state and does not execute those actions.

- [ ] Test capability discovery, exact context passing, streaming/tool-call mapping, and usage accounting against a mocked llama.cpp OpenAI-compatible server.
- [ ] Test Hugging Face search/file resolution at a pinned revision, download cancellation, local path validation, load failure, user-owned process safety, and shutdown cleanup of app-owned children only.
- [ ] Implement explicit Hugging Face search/inspect/download actions and optional provider detection/configuration; load downloaded GGUF by local path. Preserve app-managed single-model policy and report actual context allocation.
- [ ] Add safeguards and progress/readouts for expected download size, available disk space, runtime version, and GPU backend status before loading.
- [ ] Run provider, worker, integration, packaging/typecheck tests.
- [ ] Commit `feat: run Hugging Face GGUF models with llama.cpp`.

### Task 4: Add Ollama Safetensors import and unified model library

**Files:**
- Modify: `sidecar/providers/ollama.py` (extract the Ollama implementation from the shared engine runtime seam)
- Modify: `sidecar/worker.py`
- Modify: `src/shared/protocol.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/test_ollama_import.py`, `tests/test_worker.py`, and renderer tests

- [ ] Test creating/importing a local Safetensors directory as an Ollama model through mocked CLI calls, error handling, cancellation, and destination/model identity.
- [ ] Implement a unified library filter for provider, format, source, installed/available state, and tool/reasoning capabilities.
- [ ] Implement explicit local Safetensors import into Ollama, documenting that runtime architecture support governs compatibility.
- [ ] Run mocked import tests, renderer tests, typecheck, and package build.
- [ ] Commit `feat: import compatible Safetensors models into Ollama`.

### Task 5: Make approvals decision-required and add per-run auto-approve

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `sidecar/worker.py`
- Modify: `../local-9b-dev-app/desktop_engine.py`
- Test: `tests/test_worker.py`, `tests/approval-ui.test.ts`, and provider/engine approval tests

**Interfaces:**
- `ApprovalMode` becomes `per-action | per-task | auto`.
- `auto` is an explicit run-scoped choice, defaults to per-action, and is frozen into `TurnContext` and session state for the active run.
- Pending approval UI has no backdrop, Escape, or close-to-dismiss behavior; only explicit Deny/Approve choices or the separate Cancel request action resolve the wait.

- [ ] Test that backdrop click, Escape, and close controls do not resolve or dismiss a pending approval; Deny and Approve do resolve it with the selected result.
- [ ] Test that `auto` approves ordinary otherwise-approvable calls for this task without calling the approval callback, while preserving access-mode checks and captured-workspace validation.
- [ ] Test that auto-approve is off for new and migrated sessions unless explicitly selected for that run.
- [ ] Implement the approval mode and the non-dismissible decision dialog with accessible focus handling and explicit deny/approve actions.
- [ ] Run worker/engine and renderer tests and confirm normal per-action/per-task flows are unchanged.
- [ ] Commit `feat: add explicit run-scoped auto approval`.

### Task 6: Reorganize the Live Work Sheet changes control

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/live-work-sheet.test.ts` and packaged visual acceptance

- [ ] Test that the Inspect Changes action renders in the Live Work Sheet header/action row, not underneath the resource readouts.
- [ ] Move and style the action near the top of the sheet without changing its existing review/apply behavior.
- [ ] Verify the layout at the default window size and a narrower supported size; confirm it does not overlap panel text or resource values.
- [ ] Commit `fix: keep inspect changes clear of live resource status`.

### Task 7: Lock settings to sessions and validate end-to-end behavior

**Files:**
- Modify: `../local-9b-dev-app/sessions.py`
- Modify: `sidecar/worker.py`
- Modify: `src/renderer/App.tsx`
- Modify: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ACCEPTANCE_LOG.md`, and `README.md`
- Test: session migration, run capture, workspace isolation, cancellation, provider lifecycle, and full existing suites

- [ ] Test that resumed legacy and new sessions restore provider/model/reasoning/context/output settings and that a running task remains pinned to its captured settings after UI navigation.
- [ ] Test unrelated Ollama-loaded models and user-owned llama.cpp processes are unchanged by app load, cancel, and shutdown.
- [ ] Run the complete mocked suite, typecheck, and Windows installer build.
- [ ] After those gates, visibly test the current Ollama model plus one compatible HF GGUF in the disposable acceptance project; test reasoning levels only when the model advertises them and record requested/effective context.
- [ ] Update architecture, decisions, acceptance evidence, and README. Keep native Transformers compatibility explicitly in the deferred backlog.
- [ ] Commit `test: validate multi-runtime model workflows`.

## Handoff

This plan has not been executed. Queue order is Tasks 1–4 for runtime/model support, Tasks 5–6 for approval and Live Work Sheet UX, then Task 7 for integration and acceptance. Native Transformers support remains a later, separately scoped backlog item. Wait for an explicit implementation go-ahead before starting any task.
