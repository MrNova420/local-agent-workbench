import { describe, expect, it } from 'vitest';
import { nextHarnessProfile } from '../src/shared/harness-profile';

describe('chat harness workflow toggle', () => {
  it('toggles between standard and small-model guidance without touching run limits', () => {
    expect(nextHarnessProfile('standard')).toBe('small-model');
    expect(nextHarnessProfile('small-model')).toBe('standard');
  });
});
