import { describe, expect, it } from 'vitest';
import { normalizeGpuStats } from '../src/shared/resource-metrics';

describe('normalizeGpuStats', () => {
  it('keeps utilization, VRAM, and power as separate live readings', () => {
    expect(normalizeGpuStats({
      name: 'NVIDIA GeForce GTX 1650 SUPER',
      utilization_percent: 7,
      memory_used_mib: 3656,
      memory_total_mib: 4096,
      power_w: 7.2,
    })).toEqual({
      name: 'NVIDIA GeForce GTX 1650 SUPER',
      utilizationPercent: 7,
      memoryUsedMiB: 3656,
      memoryTotalMiB: 4096,
      powerWatts: 7.2,
    });
  });

  it('keeps unsupported readings unavailable instead of fabricating values', () => {
    expect(normalizeGpuStats({ name: 'GPU', utilization_percent: null, memory_used_mib: 0 })).toEqual({
      name: 'GPU',
      utilizationPercent: null,
      memoryUsedMiB: 0,
      memoryTotalMiB: null,
      powerWatts: null,
    });
    expect(normalizeGpuStats(undefined)).toBeNull();
  });
});
