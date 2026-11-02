import { describe, expect, it } from 'vitest';
import { approvalModeDescription } from '../src/shared/approval-mode-copy';

describe('approval mode descriptions', () => {
  it('explains that run auto-approval overrides ordinary ask-before-writes prompts', () => {
    const text = approvalModeDescription('auto', 'ask');
    expect(text).toContain('without ordinary prompts');
    expect(text).toContain('auto-approve overrides that ordinary prompt');
    expect(text).toContain('persistent ask rules still require a host decision');
    expect(text).toContain('not sandboxed to the selected project');
  });

  it('distinguishes per-task and per-session grants', () => {
    expect(approvalModeDescription('per-task', 'edit')).toContain('later actions in this task');
    expect(approvalModeDescription('per-session', 'edit')).toContain('later actions in this saved chat session');
  });

  it('states that per-action uses an individual decision for each eligible action', () => {
    expect(approvalModeDescription('per-action', 'copy')).toContain('Each eligible action gets its own host decision');
  });
});
