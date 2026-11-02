export function terminalWorkflowSummary(outcome: unknown): string | null {
  switch (outcome) {
    case 'response_missing':
      return 'The model did not produce a final reply after the Workbench requested one. Review the saved plan and activity to see what completed; operations are not replayed automatically.';
    case 'implementation_incomplete':
      return 'The run ended without new observable project progress after a continuation request. Its plan and checkpoint are saved so you can review them and continue safely.';
    case 'blocked':
      return 'The run stopped because a project action was denied or the selected access policy is read-only. The Workbench preserved that boundary and did not bypass it; review the saved plan and choose an allowed next step.';
    case 'interrupted':
      return 'The run was interrupted. Its checkpoint and recorded operation results are saved; review any operation that may have been in flight before continuing.';
    case 'cancelled':
      return 'You canceled this run. Received output and completed operation results remain saved; review any interrupted operation before continuing.';
    case 'stopped':
      return 'The run stopped after the active operation. Its result is saved, and no further model request was sent.';
    case 'failed':
      return 'The run failed. Review the displayed error and saved activity; completed operations are not automatically replayed.';
    default:
      return null;
  }
}

export function canContinueFromOutcome(outcome: unknown): boolean {
  return typeof outcome === 'string'
    && ['blocked', 'response_missing', 'implementation_incomplete', 'failed', 'interrupted', 'cancelled', 'stopped'].includes(outcome);
}

export function buildSafeContinuationPrompt(goal?: string): string {
  const original = typeof goal === 'string' && goal.trim() ? `Original request:\n${goal.trim()}\n\n` : '';
  return `${original}Continue the prior task in this same chat from its saved checkpoint, plan, decisions, and operation history. First inspect the saved checkpoint and current workspace; confirm which completed operations and changes are already present. Do not repeat completed operations. Do not retry uncertain side effects until their current effect is inspected and any required approval is obtained. Continue the unfinished work, update the plan as evidence warrants, and verify the final result under the current access and approval settings.`;
}
