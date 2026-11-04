const ACTIVITY_OPEN_KEY = 'agent-workbench:expanded-activity:';
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
