import type { WorkerEvent } from './protocol';

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
