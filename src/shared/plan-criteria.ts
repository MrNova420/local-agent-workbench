import type { ActivityRecord } from './protocol';

/** Prefer an explicit snapshot, including an intentional empty plan. Older sessions can recover from their latest turn's journal event. */
export function restorePlanItems(snapshot: unknown, events: unknown, latestTurnId?: string): Array<{ title?: string; text?: string; status?: string; source?: 'workbench' | 'agent' }> {
  if (Array.isArray(snapshot)) return snapshot;
  if (!Array.isArray(events)) return [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || typeof event !== 'object') continue;
    const activity = event as ActivityRecord;
    if (activity.kind !== 'plan' || !Array.isArray(activity.items)) continue;
    if (latestTurnId && activity.turnId !== latestTurnId) continue;
    return activity.items;
  }
  return [];
}

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
