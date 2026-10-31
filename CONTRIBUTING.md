# Contributing

Thanks for helping improve Local Agent Workbench. The project is an unstable beta; small, reviewable contributions are easiest to assess.

## Before opening a change

1. Read `docs/CORE_HARNESS_READINESS.md` and `docs/PRODUCT_BACKLOG.md` so work aligns with the full parity target and current priority order.
2. Open a focused issue for substantial behavior or security changes. Preserve the existing workflow and the user's exact model/context/output/reasoning selections.
3. Do not claim a feature is verified based on a mock alone. Record source, package, visible UI, runtime, and live-model evidence separately.

## Local development

Use the paired core checkout described in `README.md`, then run:

```powershell
npm ci
$env:LOCAL_AGENT_CORE_PATH = "..\local-9b-dev-app"
npm run typecheck
npm test
```

For engine changes, run `python -m pytest -q` from the core checkout. Package changes should also run `npm run make` on Windows and record the generated artifact and bundled-worker smoke result.

## Pull requests

- Keep changes scoped and explain the user-visible behavior, design decision, and affected boundaries.
- Add regression coverage for defects and update the authoritative docs/backlog when behavior or evidence changes.
- Include screenshots for UI changes when a real packaged build is available; do not use mockups as runtime evidence.
- Call out limitations, migrations, and security implications. Never represent an approval dialog or working directory as OS-level containment.
- Never include model weights, credentials, user projects, private session history, or generated build outputs.
