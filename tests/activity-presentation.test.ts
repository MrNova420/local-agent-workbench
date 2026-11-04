import { describe, expect, it } from 'vitest';
import { readActivityDisclosure, readActivityOutputVisibleCharacters, writeActivityDisclosure, writeActivityOutputVisibleCharacters } from '../src/shared/activity-presentation';

describe('saved activity disclosure presentation', () => {
  it('persists a user's open state by session and operation identity', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    expect(readActivityDisclosure(storage, 'session-a', 'operation-1')).toBeNull();
    writeActivityDisclosure(storage, 'session-a', 'operation-1', true);
    writeActivityDisclosure(storage, 'session-a', 'operation-2', false);

    expect(readActivityDisclosure(storage, 'session-a', 'operation-1')).toBe(true);
    expect(readActivityDisclosure(storage, 'session-a', 'operation-2')).toBe(false);
    expect(readActivityDisclosure(storage, 'session-b', 'operation-1')).toBeNull();
  });

  it('treats invalid or unavailable UI preference storage as unset', () => {
    expect(readActivityDisclosure({ getItem: () => 'broken', setItem: () => undefined }, 'session', 'operation')).toBeNull();
    expect(readActivityDisclosure({ getItem: () => { throw new Error('disabled'); }, setItem: () => undefined }, 'session', 'operation')).toBeNull();
  });

  it('restores the progressive output position independently for each result stream', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    writeActivityOutputVisibleCharacters(storage, 'session-a', 'operation-1', 'result', 64_000);
    writeActivityOutputVisibleCharacters(storage, 'session-a', 'operation-1', 'output:stdout', 32_000);

    expect(readActivityOutputVisibleCharacters(storage, 'session-a', 'operation-1', 'result', 16_000)).toBe(64_000);
    expect(readActivityOutputVisibleCharacters(storage, 'session-a', 'operation-1', 'output:stderr', 16_000)).toBe(16_000);
    expect(readActivityOutputVisibleCharacters(storage, 'session-b', 'operation-1', 'result', 16_000)).toBe(16_000);
  });
});
