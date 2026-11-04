import { describe, expect, it } from 'vitest';
import { runtimeWorkerCpuCoreEquivalents } from '../src/shared/resource-format';

describe('runtime worker CPU display units', () => {
  it('converts process CPU percentages into core equivalents', () => {
    expect(runtimeWorkerCpuCoreEquivalents(582)).toBe('5.8');
    expect(runtimeWorkerCpuCoreEquivalents(99)).toBe('1.0');
  });

  it('keeps missing and invalid process measurements unavailable', () => {
    expect(runtimeWorkerCpuCoreEquivalents(null)).toBeNull();
    expect(runtimeWorkerCpuCoreEquivalents(Number.NaN)).toBeNull();
    expect(runtimeWorkerCpuCoreEquivalents(-1)).toBeNull();
  });
});
