# Visible Acceptance Log

Date: 2026-10-30  
Build: Windows x64 Electron Forge package and Squirrel installer  
Workspace: `work/acceptance-empty` (disposable)  
Model: `hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M`

## Workflow evidence

- The packaged app discovered 20 locally installed Ollama models and selected the exact tag above.
- The selected session showed the full 262,144-token context, with reasoning left at the model default. Ollama `/api/ps` later reported `context_length: 262144` for the loaded tag.
- The visible workspace path stayed at `work/acceptance-empty` while opening and resuming session `1a7c7cf3`.
- A short hello received a response. The coding task created `calculator.py` and `test_calculator.py` after per-action approval, then ran `python -m unittest -v` after approval; all four tests passed.
- A long generation was cancelled through the visible Cancel request control. The app returned to an idle/ready state and the existing Ollama model remained loaded.
- The same session was resumed with its transcript and workspace path intact.
- A follow-up prompt, `Reply with exactly: Ready. Do not use tools.`, was submitted from the prompt field with Enter. The visible app completed it and populated the new measurements. The rendered response also included extra project-file context, so the exact-output instruction was not fully followed.

## Live measurement

The follow-up turn displayed:

| Measurement | Observed |
| --- | ---: |
| First token | 19.4 s |
| Ollama output speed | 1.9 tokens/s |
| Ollama output tokens | 179 |
| Effective Ollama context | 262,144 tokens |
| App RAM reading during generation | about 29.9 / 32 GB |
| Idle RAM reading after completion | about 29.6 / 32 GB |
| GPU VRAM reading after completion | 3,619 / 4,096 MiB |

These are observations from the UI and Ollama's loaded-model endpoint, not a sampled peak-memory benchmark. Earlier visible work reached about 31.2 / 32 GB RAM. No peak VRAM sample was recorded. The model remained loaded; this check did not unload it.

## Verification and remaining limits

- Automated suite at this milestone: 6 Vitest tests and 15 Pytest tests passed; TypeScript typecheck passed.
- `npm run make` produced the Windows x64 package, Squirrel installer, and ZIP. The Python worker was bundled with the package.
- The visible run verified chat, approvals, file changes, test command/output, cancellation, session recovery, full context, and live generation measurements.
- MCP discovery/calls have mocked coverage only; no real stdio server was exercised in this acceptance run.
- Resource figures are point observations, not peak measurements. A longer coding benchmark with RAM/VRAM sampling is still needed before making performance or peak-memory claims.
