import { describe, expect, it } from 'vitest';
import { terminalWorkflowSummary } from '../src/shared/workflow-outcome';

describe('terminal workflow summaries', () => {
  it('explains a missing model final without claiming project work completed', () => {
    expect(terminalWorkflowSummary('response_missing')).toContain('did not produce a final reply');
    expect(terminalWorkflowSummary('response_missing')).toContain('not replayed automatically');
  });

  it('explains an incomplete implementation using saved checkpoint state', () => {
    expect(terminalWorkflowSummary('implementation_incomplete')).toContain('without new observable project progress');
    expect(terminalWorkflowSummary('implementation_incomplete')).toContain('checkpoint are saved');
  });

  it('does not create a host summary for ordinary successful conversational outcomes', () => {
    expect(terminalWorkflowSummary('discussion')).toBeNull();
    expect(terminalWorkflowSummary('inspected')).toBeNull();
    expect(terminalWorkflowSummary(null)).toBeNull();
  });
});
