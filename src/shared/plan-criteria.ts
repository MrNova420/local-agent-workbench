import type { ActivityRecord } from './protocol';

/** Restore the newest explicit criteria snapshot from durable plan activity. */
export function readPlanAcceptanceCriteria(events: unknown): string[] {
  if (!Array.isArray(events)) return [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && typeof event === 'object' && (event as ActivityRecord).kind === 'plan' && Array.isArray((event as ActivityRecord).acceptanceCriteria)) {
      return (event as ActivityRecord).acceptanceCriteria!.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
}
