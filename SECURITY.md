# Security policy

Local Agent Workbench is an unstable beta. Please do not use it with sensitive or production workspaces until the relevant containment and recovery gates are complete.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** action on this repository's Security tab so the report is private. Do not open a public issue for exploitable vulnerabilities. Include the affected version/commit, impact, reproduction steps, and any safe proof of concept. Do not attach credentials, private projects, or unrelated personal data.

## Important boundaries

The Electron renderer is sandboxed and uses a narrow preload bridge. Built-in file tools are workspace-scoped, but approved commands and MCP servers execute with the Windows user's OS privileges. They may access files outside the selected project or use the network. Approval is consent, not containment. See `docs/CORE_HARNESS_READINESS.md` for the current security work and evidence tiers.
