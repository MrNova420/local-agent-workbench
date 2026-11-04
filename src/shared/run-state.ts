import type { ActivityRecord, WorkerEvent } from './protocol';

export type ToolCallProgress = { requestIndex: number; callIndex: number; provider: string; toolName: string; argumentCharacters: number };

export function isLiveActivity(record: ActivityRecord): boolean {
  if (record.kind === 'operation') return record.status === 'running';
  if (record.kind === 'tool_preparation') return record.status === 'preparing';
  if (record.kind === 'approval') return record.approvalStatus === 'waiting' || record.status === 'waiting';
  if (record.kind === 'question') return record.status === 'awaiting_user';
  return false;
}

export function latestActiveActivityForTurn(activities: ActivityRecord[], turnId: string | undefined): ActivityRecord | undefined {
  if (!turnId) return undefined;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity.turnId === turnId && isLiveActivity(activity)) return activity;
  }
  return undefined;
}

export function shouldQueuePromptOnEnter(key: string, shiftKey: boolean, isComposing: boolean): boolean {
  return key === 'Enter' && !shiftKey && !isComposing;
}

export function canSubmitActiveRunUpdate(running: boolean, starting: boolean): boolean {
  return running && !starting;
}

export function shouldApplySessionEvent(eventSessionId: unknown, activeSessionId: string): boolean {
  return typeof eventSessionId !== 'string' || eventSessionId.length === 0 || eventSessionId === activeSessionId;
}

export function isGlobalRunLifecycleEvent(event: { type: string; sessionId?: unknown }): boolean {
  return event.type === 'run_started' || event.type === 'run_idle';
}

export function applyToolCallProgress(current: ToolCallProgress[], event: WorkerEvent): ToolCallProgress[] {
  if (event.type !== 'tool_call_progress') return current;
  const requestIndex = Number(event.request_index ?? 0);
  const callIndex = Number(event.call_index ?? 0);
  const argumentCharacters = Number(event.argument_characters) || 0;
  const preview: ToolCallProgress = {
    requestIndex: Number.isFinite(requestIndex) ? requestIndex : 0,
    callIndex: Number.isFinite(callIndex) ? callIndex : 0,
    provider: String(event.provider || 'local runtime'), toolName: String(event.tool_name || ''),
    argumentCharacters: Number.isFinite(argumentCharacters) ? Math.max(0, argumentCharacters) : 0,
  };
  const index = current.findIndex((item) => item.requestIndex === preview.requestIndex && item.callIndex === preview.callIndex);
  if (index < 0) return [...current, preview];
  const next = current.slice();
  next[index] = preview;
  return next;
}

export function restoredRunPhase(status: unknown, phase?: unknown): string {
  if (status === 'running') {
    const livePhases: Record<string, string> = {
      waiting_response_headers: 'Waiting for response headers',
      waiting: 'Waiting for first token',
      reasoning: 'Reasoning',
      generating: 'Generating',
      processing_response: 'Processing response',
      steering_interrupted: 'Applying your update',
      applying_steering: 'Applying your update',
      continuing: 'Continuing task',
      finishing: 'Finishing turn',
    };
    if (typeof phase === 'string' && livePhases[phase]) return livePhases[phase];
    if (typeof phase === 'string' && phase.trim()) {
      return phase.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
    return 'Working';
  }
  switch (status) {
    case 'completed': return 'Turn complete';
    case 'failed': return 'Run failed';
    case 'cancelled': return 'Cancelled';
    case 'stopped': return 'Stopped after active operation';
    case 'interrupted': return 'Interrupted · recovery required';
    default: return 'Ready';
  }
}

export function runStepProgress(phase: string, running: boolean): number {
  const phaseKey = phase.toLowerCase();
  if (phaseKey.includes('complete')) return 4;
  if (phaseKey.includes('failed') || phaseKey.includes('cancelled') || phaseKey.includes('stopped')) return 3;
  if (phaseKey.includes('waiting')) return 1;
  if (phaseKey.includes('processing response')) return 2;
  if (phaseKey.includes('reason') || phaseKey.includes('generat')) return 2;
  if (phaseKey.includes('finish')) return 3;
  return running ? 1 : 0;
}

export function nextRunPhase(previous: string, event: WorkerEvent): string {
  if (event.type === 'service_exit') {
    return /^(connecting|recovering|waiting|reasoning|generating|finishing)/i.test(previous)
      ? 'Interrupted · recovery required'
      : previous;
  }
  if (event.type === 'phase') {
    const phase = String(event.phase || 'working');
    if (phase === 'waiting') return 'Waiting for first token';
    if (phase === 'reasoning') return 'Reasoning';
    if (phase === 'generating') return 'Generating';
    return phase.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  if (event.type === 'request_dispatched') return 'Waiting for response headers';
  if (event.type === 'request_headers') return 'Waiting for first token';
  if (event.type === 'request_complete') return 'Processing response';
  if (event.type === 'request_error') return event.interrupted_by_steering ? 'Applying your update' : event.cancelled ? 'Cancelling request' : 'Request failed';
  if (event.type === 'generation_complete') return 'Finishing turn';
  if (event.type === 'complete') return 'Turn complete';
  if (event.type === 'cancelled') return 'Cancelled';
  if (event.type === 'error') return 'Run failed';
  if (event.type === 'run_idle' && previous === 'Finishing turn') return 'Turn complete';
  return previous;
}
