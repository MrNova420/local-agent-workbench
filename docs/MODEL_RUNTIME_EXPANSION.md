# Proposed Model Runtime and Hugging Face Support

**Status: Implementation authorized and underway. Capability-based reasoning mode/effort and llama.cpp per-request thinking-budget controls are implemented in source with focused tests; packaged visible acceptance and live enforcement measurement remain pending.**

## Goal

Let the workbench use a wider set of local models and runtimes, including models sourced from Hugging Face, while exposing only the reasoning controls and context settings each selected model actually supports.

## Current boundary

The workbench supports Ollama and has an optional app-managed llama.cpp path for GGUF. It already runs many model architectures installed in Ollama, including the current Hugging Face GGUF-derived Ornith model; the model selector lists installed Ollama models. Hugging Face is a model hub and can host different weight formats. GGUF can be run by llama.cpp; Ollama documents importing local GGUF and Safetensors weights. A native Transformers runtime for arbitrary Hub checkpoints would be a separate, heavier runtime and is outside this first expansion.

## Proposed V1.1 scope

1. Keep Ollama fully supported and preserve existing sessions and model behavior.
2. Add a provider-neutral runtime contract and a capability-based model catalog. A model entry identifies provider, model reference, source/format, context, reasoning controls, tool support, and runtime state. A model's display name alone is not its identity.
3. Add a Hugging Face catalog flow that can search/inspect compatible repository files, show revision, format, quantization, and download size, and let the user select exact files. Use the user's existing Hugging Face Hub login when available; never put tokens into URLs, logs, or prompts. Pin the selected revision in the model record.
4. Add an optional llama.cpp server provider for GGUF models. The user can add a Hub GGUF or select a local GGUF, then explicitly download/load it. The UI must report download/load progress, format, model context, effective allocated context, and resource use. It must not load a model when the app opens.
5. Add a Hugging Face Safetensors import flow through Ollama for architectures Ollama accepts. Show that import creates an Ollama model entry; do not claim support for every Hub checkpoint.
6. Add capability-aware reasoning controls. Choices are `Model default`, `Off`, and only the exact on/effort values advertised by the selected model/runtime. If controls are absent or unknown, keep the request at model default and say why controls are unavailable. The user setting that enables/disables thinking is separate from a display control that expands/collapses returned thinking text.
7. Make the existing context and output-token controls work end to end. Treat the context window as the runtime's total prompt-plus-generation capacity; keep the maximum response-token cap separate. Generate a broad preset ladder from 4K upward with binary tiers and useful decimal tiers (including 100K, 200K, 300K, and 500K), continuing past 1M as far as the selected provider/model reports support. Always include the exact reported maximum and an exact custom value. Derive each model's available range from provider/model metadata. Keep unsupported presets visible but disabled with the reason. Generate the output-token ladder independently up to the provider/model's reported maximum output, even when that exceeds 1M; if no separate output maximum is reported, show that as unknown rather than inventing one. Send the selected context and output cap unchanged to inference. Report requested and effective context separately and report the exact generation options sent, so a setting is never presented as applied solely because it was selected in the UI.
8. Persist provider, model reference, reasoning selection, context, output limit, and runtime settings with the session. Capture those values at run start so switching projects or models cannot alter an active run.
9. Keep one app-managed model runtime active at a time. Never unload or stop a model/runtime the app did not start. Explicitly report ownership for any server process the app launches. Cancellation interrupts only the current request.
10. Make approval requests decision-required: clicking the backdrop, pressing Escape, or using a close control must not dismiss a pending approval. The user must explicitly approve, deny, or cancel the run.
11. Add an explicit `Auto-approve actions` choice to run configuration. It is opt-in for that run, off by default, visibly summarized before starting, and captured with the task. It bypasses approval prompts for the task's otherwise-approvable project tool actions; it does not widen the captured workspace boundary or change access mode.
12. Reorganize the Live Work Sheet so `Inspect changes` is near the top of the panel and does not overlap resource/status text at common window sizes.

## Runtime coverage

| Source / format | Proposed path | Coverage boundary |
| --- | --- | --- |
| Existing Ollama models | Existing Ollama API adapter | Any model exposed by the installed Ollama runtime; capabilities are model-specific. |
| Hugging Face GGUF | Optional llama.cpp adapter; direct Hub repository/file and local GGUF | llama.cpp-supported GGUF architectures and chat templates; verify tool calling per model. |
| Hugging Face Safetensors | Download/import through Ollama | Only architectures and weight layouts supported by the installed Ollama version. |
| Other Hub formats / custom Transformers models | Future adapter decision | Not included until packaging, hardware use, security, and model coverage are evaluated. No remote model code is executed by this proposal. |

The optional llama.cpp executable should be installed or selected through an explicit setup action, not fetched or launched silently. The setup flow should identify the selected binary/version and validate its availability before presenting that provider as ready. The initial implementation should not bundle a GPU-specific binary until Windows/CUDA compatibility and distribution size are validated.

## Reasoning and context rules

- Ollama `/api/show` can report the model's supported thinking values and default; the chat API accepts the model default, booleans, or an exact model-defined value. The adapter should map that metadata into the shared capability contract.
- Other providers may report different controls or none. The UI must not invent a generic `low/medium/high` set when the backend did not advertise it.
- For llama.cpp, GGUF reasoning levels stay `unknown` until the owned server's `/props.chat_template_caps.reasoning_effort_levels` reports the exact levels for the loaded chat template. Missing levels remain unknown; they are not inferred from generic CLI values. The model default is not guessed.
- Keep `default` as the initial reasoning selection. Send no provider override for that value.
- Keep reasoning generation (`default`, enabled/disabled, or supported effort) separate from reasoning visibility in the transcript.
- The model-specific `Reasoning` selector means the provider's advertised thinking mode/level; it does not promise a token or time limit. Ollama's `think` API accepts a boolean or model-defined level and does not document a separate per-request thinking-token budget. See [Ollama thinking controls](https://github.com/ollama/ollama/blob/main/docs/capabilities/thinking.mdx).
- A separate optional llama.cpp `Thinking-token budget` is saved per session and sent as `thinking_budget_tokens` on each request. Blank is unlimited by default; integer values are preserved, including zero. llama.cpp supports the per-request field when no server-level reasoning budget overrides it; applicability also depends on a usable reasoning section in the selected chat template. See [llama.cpp server controls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) and its [per-request budget discussion](https://github.com/ggml-org/llama.cpp/discussions/21445).
- The two controls are independent: reasoning mode selects whether/how the model reasons, while a supported budget limits reasoning-section tokens. The budget does not change `max_tokens`, impose a wall-clock deadline, or prove runtime enforcement. The UI labels it as requested because model/template/server behavior is not independently reported. A lower budget can reduce coding quality, so it remains unlimited unless the user chooses otherwise.
- The context control is the requested total prompt window. Maximum response tokens remain a separate cap. Validate and explain provider-specific constraints without silently rewriting either user value.

## Non-goals for this proposal

- Replacing the current Python engine with TypeScript.
- Cloud inference, remote hosted APIs, subagents, or automatic model recommendations.
- Arbitrary execution of Hugging Face repository Python code (`trust_remote_code`).
- Promising that every Hugging Face model fits or runs quickly on this PC.
- Changing OpenCode settings, existing Ollama models, or current model reasoning settings as a side effect of adding support.

## Acceptance criteria

- Existing Ollama model discovery, sessions, context, request cancellation, and default reasoning continue to work.
- Ollama reasoning controls match `/api/show` metadata: default sends no override; off/on/effort sends the exact supported value; unsupported/unknown remains default.
- A supported Hugging Face GGUF can be added from a repository/file or local path, loaded on explicit request, selected in a session, and used for a streamed coding-agent response with tools when the model template supports tools.
- A supported Safetensors directory can be imported into Ollama and then appears in the normal model catalog.
- Session resume restores provider, model, reasoning selection, context, and output-token limit.
- The UI distinguishes requested context from effective runtime context and never hides a lower allocation.
- The context preset ladder has no fixed 1M ceiling: it extends through the selected model/runtime's reported maximum, includes useful binary/decimal tiers and the exact maximum, and supports custom values. Unsupported tiers are visibly disabled with an explanation.
- The output-token ladder is independently derived from the provider/model's reported output limit, has no fixed 1M ceiling, includes the exact maximum when known, and supports custom values. It remains separate from context size.
- Automated request tests prove the selected context/output values reach each provider unchanged; visible runtime status distinguishes requested settings from the effective loaded-model allocation.
- Starting a run and resuming a session preserve and apply the selected context and output-token values; there is no separate input-budget display requirement.
- The app does not start a model on launch, unload externally loaded models, or kill a runtime process it did not create.
- A pending approval cannot disappear through backdrop click, Escape, or a close affordance; explicit approve/deny/cancel choices remain available.
- Auto-approve is an explicit per-run option, off by default, and serialized into the captured task/session state.
- `Inspect changes` is reachable near the top of the Live Work Sheet and remains legible at supported window sizes.
- Mocked coverage includes provider discovery/failure, reasoning capability mapping, context preservation, model import/download cancellation, session migration/isolation, tool/stream usage, request cancellation, and process ownership.
- Visible packaged-app acceptance exercises the existing Ollama model plus one supported Hugging Face GGUF in a disposable project. A Safetensors path is accepted only after a compatible model is available for the check.

## Research references

- [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking)
- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Ollama importing GGUF and Safetensors models](https://docs.ollama.com/import)
- [llama.cpp Hugging Face GGUF support and server reasoning controls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [Hugging Face Transformers model loading and custom-code guidance](https://huggingface.co/docs/transformers/main/models)
