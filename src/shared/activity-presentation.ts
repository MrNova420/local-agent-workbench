const ACTIVITY_OPEN_KEY = 'agent-workbench:expanded-activity:';
const ACTIVITY_OUTPUT_KEY = 'agent-workbench:visible-activity-output:';
type ActivityPresentationStorage = Pick<Storage, 'getItem' | 'setItem'>;

function activityKey(sessionId: string, activityId: string): string {
  return `${ACTIVITY_OPEN_KEY}${sessionId}:${activityId}`;
}

/** Return null when the user has not chosen a disclosure state for this activity. */
export function readActivityDisclosure(storage: ActivityPresentationStorage, sessionId: string, activityId: string): boolean | null {
  if (!sessionId || !activityId) return null;
  try {
    const value = storage.getItem(activityKey(sessionId, activityId));
    return value === 'open' ? true : value === 'closed' ? false : null;
  } catch {
    return null;
  }
}

export function writeActivityDisclosure(storage: ActivityPresentationStorage, sessionId: string, activityId: string, open: boolean): void {
  if (!sessionId || !activityId) return;
  try {
    storage.setItem(activityKey(sessionId, activityId), open ? 'open' : 'closed');
  } catch {
    // The activity result is still preserved in the session if UI preferences cannot be saved.
  }
}

function activityOutputKey(sessionId: string, activityId: string, field: string): string {
  return `${ACTIVITY_OUTPUT_KEY}${sessionId}:${activityId}:${field}`;
}

export function readActivityOutputVisibleCharacters(
  storage: ActivityPresentationStorage, sessionId: string, activityId: string, field: string, fallback: number,
): number {
  if (!sessionId || !activityId || !field) return fallback;
  try {
    const value = Number(storage.getItem(activityOutputKey(sessionId, activityId, field)));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeActivityOutputVisibleCharacters(
  storage: ActivityPresentationStorage, sessionId: string, activityId: string, field: string, visibleCharacters: number,
): void {
  if (!sessionId || !activityId || !field || !Number.isSafeInteger(visibleCharacters) || visibleCharacters < 1) return;
  try {
    storage.setItem(activityOutputKey(sessionId, activityId, field), String(visibleCharacters));
  } catch {
    // The full operation output is independent of this local progressive-view position.
  }
}
