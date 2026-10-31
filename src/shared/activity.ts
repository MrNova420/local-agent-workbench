import type { ActivityEventEnvelope, ActivityRecord } from './protocol';

export type { ActivityRecord } from './protocol';

export function applyActivityEvent(current: ActivityRecord[], event: ActivityEventEnvelope): ActivityRecord[] {
  if (event.activity) {
    const index = current.findIndex((row) => row.id === event.activity!.id);
    if (index < 0) return [...current, event.activity];
    const next = current.slice();
    const previous = next[index];
    const output = { ...previous.output };
    for (const [stream, value] of Object.entries(event.activity.output || {})) {
      if ((value || '').length >= (output[stream] || '').length) output[stream] = value || '';
    }
    next[index] = {
      ...previous,
      ...event.activity,
      output,
    };
    return next;
  }
  if (event.activityPhase !== 'progress' || !event.activityId || !event.chunk) return current;
  const index = current.findIndex((row) => row.id === event.activityId || row.operationId === event.activityId);
  if (index < 0) return current;
  const next = current.slice();
  const previous = next[index];
  const stream = event.stream || 'stdout';
  next[index] = { ...previous, output: { ...previous.output, [stream]: (previous.output?.[stream] || '') + event.chunk } };
  return next;
}
