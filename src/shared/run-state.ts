import type { WorkerEvent } from './protocol';

export function restoredRunPhase(status: unknown): string {
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
  if (phaseKey.includes('generat')) return 2;
  if (phaseKey.includes('finish')) return 3;
  return running ? 1 : 0;
}

export function nextRunPhase(previous: string, event: WorkerEvent): string {
  if (event.type === 'phase') {
    const phase = String(event.phase || 'working');
    if (phase === 'waiting') return 'Waiting for first token';
    if (phase === 'generating') return 'Generating';
    return phase.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  if (event.type === 'generation_complete') return 'Finishing turn';
  if (event.type === 'complete') return 'Turn complete';
  if (event.type === 'cancelled') return 'Cancelled';
  if (event.type === 'error') return 'Run failed';
  if (event.type === 'run_idle' && previous === 'Finishing turn') return 'Turn complete';
  return previous;
}
