import { describe, expect, it } from 'vitest';
import { buildSafeContinuationPrompt, canContinueFromOutcome, terminalWorkflowSummary } from '../src/shared/workflow-outcome';

describe('terminal workflow summaries', () => {
  it('explains a missing model final without claiming project work completed', () => {
    expect(terminalWorkflowSummary('response_missing')).toContain('did not produce a final reply');
    expect(terminalWorkflowSummary('response_missing')).toContain('not replayed automatically');
  });

  it('explains an incomplete implementation using saved checkpoint state', () => {
    expect(terminalWorkflowSummary('implementation_incomplete')).toContain('without new observable project progress');
    expect(terminalWorkflowSummary('implementation_incomplete')).toContain('checkpoint are saved');
  });

  it('explains blocked runs and preserves the access or denial boundary', () => {
    expect(terminalWorkflowSummary('blocked')).toContain('denied');
    expect(terminalWorkflowSummary('blocked')).toContain('read-only');
    expect(terminalWorkflowSummary('blocked')).toContain('did not bypass');
  });

  it('offers checkpoint continuation for blocked runs without replaying them', () => {
    expect(canContinueFromOutcome('blocked')).toBe(true);
    expect(canContinueFromOutcome('discussion')).toBe(false);
  });

  it('does not create a host summary for ordinary successful conversational outcomes', () => {
    expect(terminalWorkflowSummary('discussion')).toBeNull();
    expect(terminalWorkflowSummary('inspected')).toBeNull();
    expect(terminalWorkflowSummary(null)).toBeNull();
  });

  it('builds a same-chat recovery prompt that inspects effects before retrying', () => {
    const prompt = buildSafeContinuationPrompt('Add a settings page');
    expect(prompt).toContain('Add a settings page');
    expect(prompt).toContain('First inspect the saved checkpoint and current workspace');
    expect(prompt).toContain('Do not repeat completed operations');
    expect(prompt).toContain('uncertain side effects until their current effect is inspected');
  });
});
