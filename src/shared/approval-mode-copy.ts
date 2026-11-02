import type { AccessMode, ApprovalMode } from './protocol';

export function approvalModeDescription(mode: ApprovalMode, access: AccessMode): string {
  const rules = 'Persistent deny rules block matching actions; persistent ask rules still require a host decision; persistent allow rules apply only to matching actions.';
  const accessNote = access === 'ask'
    ? 'Ask before writes requests a decision under this approval mode; auto-approve overrides that ordinary prompt for eligible actions.'
    : 'Workspace access remains a separate boundary from approval mode.';
  const modeDescription = {
    auto: 'Auto-approve runs eligible actions without ordinary prompts for this run.',
    'per-action': 'Each eligible action gets its own host decision.',
    'per-task': 'The first eligible action requires approval; later actions in this task are covered only after approval is granted.',
    'per-session': 'The first eligible action requires approval; later actions in this saved chat session are covered only after approval is granted.',
  }[mode];
  return `${modeDescription} ${accessNote} ${rules} Commands and MCP tools use your Windows account permissions and are not sandboxed to the selected project.`;
}
