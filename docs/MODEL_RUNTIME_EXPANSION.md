# Proposed Model Runtime and Hugging Face Support

**Status: Proposed for review. No implementation is authorized by this document.**

## Goal

Let the workbench use a wider set of local models and runtimes, including models sourced from Hugging Face, while exposing only the reasoning controls and context settings each selected model actually supports.

## Current boundary

The workbench is currently runtime-limited to Ollama. It already runs many model architectures installed in Ollama, including the current Hugging Face GGUF-derived Ornith model; the model selector lists installed Ollama models. Hugging Face is a model hub and can host different weight formats. GGUF can be run by llama.cpp; Ollama documents importing local GGUF and Safetensors weights. A native Transformers runtime for arbitrary Hub checkpoints would be a separate, heavier runtime and is outside this first expansion.

## Proposed V1.1 scope

1. Keep Ollama fully supported and preserve existing sessions and model behavior.
2. Add a provider-neutral runtime contract and a capability-based model catalog. A model entry identifies provider, model reference, source/format, context, reasoning controls, tool support, and runtime state. A model's display name alone is not its identity.
3. Add a Hugging Face catalog flow that can search/inspect compatible repository files, show revision, format, quantization, and download size, and let the user select exact files. Use the user's existing Hugging Face Hub login when available; never put tokens into URLs, logs, or prompts. Pin the selected revision in the model record.
4. Add an optional llama.cpp server provider for GGUF models. The user can add a Hub GGUF or select a local GGUF, then explicitly download/load it. The UI must report download/load progress, format, model context, effective allocated context, and resource use. It must not load a model when the app opens.
5. Add a Hugging Face Safetensors import flow through Ollama for architectures Ollama accepts. Show that import creates an Ollama model entry; do not claim support for every Hub checkpoint.
6. Add capability-aware reasoning controls. Choices are `Model default`, `Off`, and only the exact on/effort values advertised by the selected model/runtime. If controls are absent or unknown, keep the request at model default and say why controls are unavailable. The user setting that enables/disables thinking is separate from a display control that expands/collapses returned thinking text.
7. Keep input context and maximum output as distinct settings. Show advertised model context, requested input window, and effective runtime allocation. Pass requested values unchanged; if the runtime cannot allocate them, show the actual limit/error instead of silently lowering it.
8. Persist provider, model reference, reasoning selection, context, output limit, and runtime settings with the session. Capture those values at run start so switching projects or models cannot alter an active run.
9. Keep one app-managed model runtime active at a time. Never unload or stop a model/runtime the app did not start. Explicitly report ownership for any server process the app launches. Cancellation interrupts only the current request.

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
- Keep `default` as the initial reasoning selection. Send no provider override for that value.
- Keep reasoning generation (`default`, enabled/disabled, or supported effort) separate from reasoning visibility in the transcript.
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
- The app does not start a model on launch, unload externally loaded models, or kill a runtime process it did not create.
- Mocked coverage includes provider discovery/failure, reasoning capability mapping, context preservation, model import/download cancellation, session migration/isolation, tool/stream usage, request cancellation, and process ownership.
- Visible packaged-app acceptance exercises the existing Ollama model plus one supported Hugging Face GGUF in a disposable project. A Safetensors path is accepted only after a compatible model is available for the check.

## Research references

- [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking)
- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Ollama importing GGUF and Safetensors models](https://docs.ollama.com/import)
- [llama.cpp Hugging Face GGUF support and server reasoning controls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [Hugging Face Transformers model loading and custom-code guidance](https://huggingface.co/docs/transformers/main/models)
