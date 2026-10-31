# Product Backlog

This is the queue for accepted follow-up work that is not part of the current reliability and packaged-app acceptance gate. Existing runtime and model-support requirements remain in [MODEL_RUNTIME_EXPANSION.md](MODEL_RUNTIME_EXPANSION.md).

## Queued for review and implementation

### B-001: Verify context and output controls in the packaged app

**Priority:** High; do after the packaged command path is reliable.

- In the visible app, set context to 65,536 and output cap to 8,192 for the exact local Ornith 1.5 9B Q4_K_M tag.
- Keep reasoning at the model default and retain the existing 262,144-token model maximum setting as the comparison baseline; do not silently clamp or rewrite either selected value.
- Confirm the selected values appear in the run configuration, captured session, exact Ollama request (`num_ctx`, `num_predict`), runtime-reported effective context, and resumed session.
- Use the same short, fixed prompt for each setting. Record first-token time, output tokens, eval duration/tokens per second, total wait, CPU, RAM, GPU utilization, and VRAM during active inference. Label snapshots and continuous samples distinctly.
- Preserve the model/runtime state that existed before the check. Do not change OpenCode configuration or reasoning settings.

### B-002: Local usage analytics across turns, sessions, and models

**Priority:** High; design before implementation.

- Keep analytics local and organize them by turn, resumable session, model/provider, and lifetime totals, with filters and comparisons.
- Track prompt/input and output token counts when the provider supplies them; otherwise identify estimates as estimates. Include first-token delay, prompt processing time if available, generation duration, output tokens/second, total wait, cancellation/failure, requested/effective context, output cap, reasoning selection, runtime/provider version, and selected run settings.
- Record timestamped resource samples during inference: CPU, system RAM, GPU utilization, VRAM used/total, and GPU power where the hardware exposes them. Mark unavailable readings instead of inventing values.
- Make model speed ranking opt-in and evidence-based. Separate throughput from quality/task success and show sample count, prompt/test conditions, model quantization, context, output cap, reasoning mode, runtime version, and hardware state beside every comparison.
- Include clear local retention, export, and delete controls before the analytics store is implemented.

### B-003: More useful Live Work Sheet resource and generation telemetry

**Priority:** High; implementation is in the current build. Packaged visual verification remains pending.

- Present live input/output tokens and tokens/second alongside elapsed time and waiting/generating phase.
- Add CPU percentage, system RAM used/total, GPU percentage, VRAM used/total, and GPU power when available; show unavailable status cleanly for unsupported hardware.
- Keep the most actionable status readable at small window sizes, move `Inspect changes` near the top, and prevent overlap with message text or controls.
- Base live throughput on streamed output and clearly replace estimates with provider-exact final usage.

**Implemented and visibly verified in the packaged app:** The bottom ribbon and Live Work Sheet expose CPU, system RAM, GPU utilization, VRAM used/total, GPU power, and agent-service CPU/RAM. Unsupported readings render as unavailable. Python telemetry parses structured `nvidia-smi` values; unit tests cover available and empty probe responses. The work sheet uses compact responsive tiles, retains live token/s output, and keeps `Inspect changes` in the sheet header. The packaged UI displayed all six resource readings without overlap. Active inference sampling remains in B-004.

### B-004: Measure partial GPU offload during active inference

**Priority:** Immediate investigation before performance conclusions.

- **Root cause confirmed:** at 262,144 context the Ollama runner offloaded 0/33 layers; at ~64K it offloaded 6/34. Correlate `nvidia-smi` samples and per-process GPU data with a real inference timeline; do not infer active GPU work from reserved VRAM or a one-time utilization sample.
- Capture Ollama `/api/ps` allocation, model runner, model size, requested/effective context, and system resource readings throughout the same run.
- The Q4 model file is 5.23 GiB; Ollama's 16.8 GB `size` at 262,144 context is the loaded runtime footprint, not the GGUF file size. The 4 GB GTX 1650 SUPER had 3.28 GiB free at model fit. Ollama's log projected 13.4 GiB GPU need (4.81 GiB model + 8.24 GiB context + compute), then selected zero GPU layers. It logged `offloaded 0/33 layers to GPU` and an 8 GiB CPU KV cache. At the earlier 64,096 request / 64,256 effective load, Ollama fit 6/34 layers on GPU, with about 1.34 GiB of model buffers and 251 MiB of KV cache on GPU. This confirms the context increase is why text-layer GPU offload fell to zero. The user also observed a sustained 2–5 minute CPU-only interval. Record active-inference telemetry during the visible 64K/8K comparison; do not change runtime settings before that user-selected test.
- Do not change context, reasoning, OpenCode settings, Ollama environment/configuration, or model files as part of this investigation without separate approval.

## Active acceptance blockers

- The corrected packaged-sidecar coding run created `calculator.py` and `test_calculator.py` after per-action approvals. Its approved `python -m unittest -v` command timed out in the prior app run after 120 seconds, while the same fixture's direct invocation passed all five tests. Follow-up source-worker and correctly frozen-worker probes both ran the exact command successfully in 0.25 seconds. The discrepancy is not reproduced outside the actual Electron acceptance flow; verify it in the single-instance visible workflow before calling the command gate passed.
- One manually written test driver also stopped an in-progress run at a 20-minute cap. That cap was not a product limit; it was an agent test-wrapper mistake and must not be reused. Model-generation observation must remain open-ended as approved.
- The new package still needs visible, one-instance acceptance in a disposable project, including hello, coding task, approval modal, test output, cancel, save, resume, project-boundary checks, and visible verification of the selected token controls. Close/avoid the older package before launching the latest build to prevent duplicate windows.
- The visible packaged run exposed a default-selection bug: a fresh run selected the first Ollama catalog entry (`hf.co/ressl/...`) even though the accepted exact default is `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`. Source now prefers that exact tag when it is installed and preserves a valid user selection. Regression coverage passes; a rebuilt package must still verify the default on a fresh profile.
- During the mistaken-source greeting check, Ollama switched from the previously loaded mradermacher model to the ressl tag. The request was cancelled visibly; the current runner remained loaded. No more inference should run until the corrected package selects the approved exact model and the memory state is reviewed.
