import { describe, expect, it } from 'vitest';
import { processCpuCoreEquivalents, runtimeWorkerCpuCoreEquivalents } from '../src/shared/resource-format';

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

describe('process CPU display units', () => {
  it('shows multicore process usage as core equivalents instead of a misleading system percentage', () => {
    expect(processCpuCoreEquivalents(500)).toBe('5.0');
    expect(processCpuCoreEquivalents(58)).toBe('0.6');
  });

  it('keeps unavailable process measurements unavailable', () => {
    expect(processCpuCoreEquivalents(null)).toBeNull();
    expect(processCpuCoreEquivalents(Number.NaN)).toBeNull();
  });
});
