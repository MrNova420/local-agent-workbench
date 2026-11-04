import { describe, expect, it } from 'vitest';
import { buildSafeContinuationPrompt, canContinueFromOutcome, terminalWorkflowSummary } from '../src/shared/workflow-outcome';

describe('terminal workflow summaries', () => {
  it('explains a missing model final without claiming project work completed', () => {
    expect(terminalWorkflowSummary('response_missing')).toContain('did not produce a final reply');
    expect(terminalWorkflowSummary('response_missing')).toContain('not replayed automatically');
  });

  it('explains a response repeatedly truncated by the selected output limit', () => {
    expect(terminalWorkflowSummary('response_truncated')).toContain('selected output-token limit');
    expect(terminalWorkflowSummary('response_truncated')).toContain('saved');
    expect(canContinueFromOutcome('response_truncated')).toBe(true);
  });

  it('explains an incomplete implementation using saved checkpoint state', () => {
    expect(terminalWorkflowSummary('implementation_incomplete')).toContain('same response repeated');
    expect(terminalWorkflowSummary('implementation_incomplete')).toContain('new observable project progress');
    expect(terminalWorkflowSummary('implementation_incomplete')).toContain('checkpoint are saved');
  });

  it('offers recovery when context pressure checkpointing is missed', () => {
    expect(terminalWorkflowSummary('checkpoint_missing')).toContain('continuity checkpoint');
    expect(terminalWorkflowSummary('checkpoint_missing')).toContain('completed operations are preserved');
    expect(canContinueFromOutcome('checkpoint_missing')).toBe(true);
  });

  it('explains blocked runs and preserves the access or denial boundary', () => {
    expect(terminalWorkflowSummary('blocked')).toContain('denied');
    expect(terminalWorkflowSummary('blocked')).toContain('uncertain result');
    expect(terminalWorkflowSummary('blocked')).toContain('before retrying');
    expect(terminalWorkflowSummary('blocked')).toContain('did not replay it automatically');
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
