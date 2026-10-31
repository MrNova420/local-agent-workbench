# Product Backlog

This is the queue for accepted follow-up work that is not part of the current reliability and packaged-app acceptance gate. Existing runtime and model-support requirements remain in [MODEL_RUNTIME_EXPANSION.md](MODEL_RUNTIME_EXPANSION.md).

## Queued for review and implementation

### B-001: Compare context presets and output-token performance

**Status:** Selected 65,536 context / 8,192 output has passed a visible packaged run and runtime-context verification. The 262,144 same-prompt comparison remains.

- In the visible app, set context to 65,536 and output cap to 8,192 for the exact local Ornith 1.5 9B Q4_K_M tag.
- Keep reasoning at the model default and retain the existing 262,144-token model maximum setting as the comparison baseline; do not silently clamp or rewrite either selected value.
- Confirm the selected values appear in the run configuration, captured session, exact Ollama request (`num_ctx`, `num_predict`), runtime-reported effective context, and resumed session.
- Use the same short, fixed prompt for each setting. Record first-token time, output tokens, eval duration/tokens per second, total wait, CPU, RAM, GPU utilization, and VRAM during active inference. Label snapshots and continuous samples distinctly.
- Preserve the model/runtime state that existed before the check. Do not change OpenCode configuration or reasoning settings.

The selected-value run is documented in [ACCEPTANCE_LOG.md](ACCEPTANCE_LOG.md). Its session file independently persisted the exact model, project, `context: 65536`, `max_tokens: 8192`, and default reasoning; Ollama `/api/ps` and runner logs confirmed an effective 65,536 context. The runtime adapter maps the stored output cap to `num_predict` and now has an explicit payload assertion. Ollama request-body logging was disabled, so the historical wire body was not captured. Next, compare the same prompt and 8,192 output cap at the 262,144 context only when enough system memory is available; capture request/runner evidence and resource samples, and preserve the loaded model if the run is not started by this check.

### B-002: Local usage analytics across turns, sessions, and models

**Priority:** High; design before implementation.

- Keep analytics local and organize them by turn, resumable session, model/provider, and lifetime totals, with filters and comparisons.
- Track prompt/input and output token counts when the provider supplies them; otherwise identify estimates as estimates. Include first-token delay, prompt processing time if available, generation duration, output tokens/second, total wait, cancellation/failure, requested/effective context, output cap, reasoning selection, runtime/provider version, and selected run settings.
- Record timestamped resource samples during inference: CPU, system RAM, GPU utilization, VRAM used/total, and GPU power where the hardware exposes them. Mark unavailable readings instead of inventing values.
- Make model speed ranking opt-in and evidence-based. Separate throughput from quality/task success and show sample count, prompt/test conditions, model quantization, context, output cap, reasoning mode, runtime version, and hardware state beside every comparison.
- Include clear local retention, export, and delete controls before the analytics store is implemented.

### B-003: More useful Live Work Sheet resource and generation telemetry

**Priority:** High; the live worksheet and resource layout are implemented and visually verified in the current packaged build. Change review now opens immediately with loading/error feedback, and its project-boundary fix is committed; both changes still need a package rebuild and visible check.

- Present live input/output tokens and tokens/second alongside elapsed time and waiting/generating phase.
- Add CPU percentage, system RAM used/total, GPU percentage, VRAM used/total, and GPU power when available; show unavailable status cleanly for unsupported hardware.
- Keep the most actionable status readable at small window sizes, move `Inspect changes` near the top, and prevent overlap with message text or controls.
- Base live throughput on streamed output and clearly replace estimates with provider-exact final usage.

**Implemented and visibly verified in the packaged app:** The bottom ribbon and Live Work Sheet expose CPU, system RAM, GPU utilization, VRAM used/total, GPU power, and agent-service CPU/RAM. Unsupported readings render as unavailable. Python telemetry parses structured `nvidia-smi` values; unit tests cover available and empty probe responses. The work sheet uses compact responsive tiles, retains live token/s output, and keeps `Inspect changes` in the sheet header. The rebuilt `out-acceptance-2026-10-31-trace-fix` package was visibly checked at 1920x1080: the activity trace stays in its scroll region and does not overlap the resource panel. Change review opens immediately and presents visible loading/error states; project-root isolation (`f35ee11`) and review feedback (`ecc0ea9`) were rebuilt and visibly verified in `out-acceptance-2026-10-31-review-fix`. Active inference sampling remains in B-004.

### B-004: Measure partial GPU offload during active inference

**Priority:** Immediate investigation before performance conclusions.

- **Root cause confirmed:** at 262,144 context the Ollama runner offloaded 0/33 layers; at ~64K it offloaded 6/34. Correlate `nvidia-smi` samples and per-process GPU data with a real inference timeline; do not infer active GPU work from reserved VRAM or a one-time utilization sample.
- Capture Ollama `/api/ps` allocation, model runner, model size, requested/effective context, and system resource readings throughout the same run.
- The Q4 model file is 5.23 GiB; Ollama's 16.8 GB `size` at 262,144 context is the loaded runtime footprint, not the GGUF file size. The 4 GB GTX 1650 SUPER had 3.28 GiB free at model fit. Ollama's log projected 13.4 GiB GPU need (4.81 GiB model + 8.24 GiB context + compute), then selected zero GPU layers. It logged `offloaded 0/33 layers to GPU` and an 8 GiB CPU KV cache. At the earlier 64,096 request / 64,256 effective load, Ollama fit 6/34 layers on GPU, with about 1.34 GiB of model buffers and 251 MiB of KV cache on GPU. This confirms the context increase is why text-layer GPU offload fell to zero. The user also observed a sustained 2–5 minute CPU-only interval. Record active-inference telemetry during the visible 64K/8K comparison; do not change runtime settings before that user-selected test.
- Do not change context, reasoning, OpenCode settings, Ollama environment/configuration, or model files as part of this investigation without separate approval.

## Active acceptance blockers

- A previous wrapper imposed an accidental 20-minute observation cap; that was a test-driver mistake, not an app limit. Do not use a fixed observation deadline for long model generation. The first numbered-list cancellation attempt ended before the user-requested forced stop and is inconclusive. The user's retry had reached 13 items after about 120 seconds; no cancellation was sent. The app was later observed minimized, so the retry's eventual completion/cancellation state remains unknown.
- The single packaged instance visibly completed hello, coding task, per-action approval, and the approved `python -m unittest -v` command; all five tests passed. A modal check confirmed backdrop click and Escape did not dismiss the approval decision. Session resume and project switching/boundary isolation were visibly verified. The 65,536/8,192 session now has independent persisted-session and Ollama runtime-context evidence.
- `Inspect changes` initially did not expose the selected fixture's files because Git walked up to the parent repository and `.gitignore` hid `work/`. The committed fix `f35ee11` confines Git diff review to a repository rooted at the selected project and shows a bounded file snapshot for non-Git projects. The rebuilt `review-fix` package visibly shows the selected fixture files in both Project Home and the Live Work Sheet review dialog.
- The visible packaged run exposed a default-selection bug: a fresh run selected the first Ollama catalog entry (`hf.co/ressl/...`) even though the accepted exact default is `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`. Source now prefers that exact tag when it is installed and preserves a valid user selection. The rebuilt package visibly selected the accepted exact tag.
- The earlier chat-only permission question is resolved in the visible package: the exact command produced a blocking approval dialog and the approved command returned five passing tests.
- CSS containment fix `8f08a74` is confirmed in the rebuilt package visually; the activity trace no longer overlaps the resource/system area.
- Earlier runs briefly selected the wrong ressl source. The latest visible session showed the accepted mradermacher tag, and read-only `/api/ps` plus the runner log confirmed the 65,536 context selected for the token-control run. The model remains loaded; do not unload it.
- The review-fix package was rebuilt and visibly confirmed the selected project's `Inspect changes` output and project/session separation. The 65,536 / 8,192 session settings and effective Ollama context were also verified. Remaining acceptance includes the matching 262,144-context comparison and long-running generation/cancel acceptance (previous evidence is inconclusive). The complete app suite and typecheck passed after adding the `num_predict` payload assertion.
