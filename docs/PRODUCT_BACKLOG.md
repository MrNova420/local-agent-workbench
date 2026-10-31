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

**Priority:** High; coordinate with the Live Work Sheet layout already queued in `MODEL_RUNTIME_EXPANSION.md`.

- Present live input/output tokens and tokens/second alongside elapsed time and waiting/generating phase.
- Add CPU percentage, system RAM used/total, GPU percentage, VRAM used/total, and GPU power when available; show unavailable status cleanly for unsupported hardware.
- Keep the most actionable status readable at small window sizes, move `Inspect changes` near the top, and prevent overlap with message text or controls.
- Base live throughput on streamed output and clearly replace estimates with provider-exact final usage.

### B-004: Investigate partial GPU offload and active-inference telemetry

**Priority:** Immediate investigation before performance conclusions.

- Correlate `nvidia-smi` samples and per-process GPU data with a real inference timeline; do not infer active GPU work from reserved VRAM or a one-time utilization sample.
- Capture Ollama `/api/ps` allocation, model runner, model size, requested/effective context, and system resource readings throughout the same run.
- The 16.8 GB model is running on a 4 GB GTX 1650 SUPER. Existing `/api/ps` readings reported 2.21 GB allocated in VRAM; snapshots around 4:01–4:06 local showed 6–7% GPU utilization and about 3.6 GB total VRAM in use. The user reports a sustained 2–5 minute CPU-only interval. These observations do not yet explain whether Ollama kept using a small offload or stopped doing useful GPU work; obtain continuous, process-correlated evidence before changing runtime settings.
- Do not change context, reasoning, OpenCode settings, Ollama environment/configuration, or model files as part of this investigation without separate approval.

## Active acceptance blockers

- The corrected packaged-sidecar coding run created `calculator.py` and `test_calculator.py` after per-action approvals. Its approved `python -m unittest -v` command timed out in the app after 120 seconds, while the same fixture's direct invocation passed all five tests in 0.001 seconds. Root cause is unresolved; fix and retest this command boundary before visible acceptance.
- One manually written test driver also stopped an in-progress run at a 20-minute cap. That cap was not a product limit; it was an agent test-wrapper mistake and must not be reused. Model-generation observation must remain open-ended as approved.
- The new package still needs visible, one-launch acceptance in a disposable project, including hello, coding task, approval modal, test output, cancel, save, resume, project-boundary checks, and visible verification of the selected token controls.
