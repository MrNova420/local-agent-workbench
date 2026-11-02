export function terminalWorkflowSummary(outcome: unknown): string | null {
  switch (outcome) {
    case 'response_missing':
      return 'The model did not produce a final reply after the Workbench requested one. Review the saved plan and activity to see what completed; operations are not replayed automatically.';
    case 'implementation_incomplete':
      return 'The run ended without new observable project progress after a continuation request. Its plan and checkpoint are saved so you can review them and continue safely.';
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
