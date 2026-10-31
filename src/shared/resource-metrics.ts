export type GpuStats = {
  name: string;
  utilizationPercent: number | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
  powerWatts: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeGpuStats(value: unknown): GpuStats | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string' || !row.name.trim()) return null;
  return {
    name: row.name.trim(),
    utilizationPercent: finiteNumber(row.utilization_percent),
    memoryUsedMiB: finiteNumber(row.memory_used_mib),
    memoryTotalMiB: finiteNumber(row.memory_total_mib),
    powerWatts: finiteNumber(row.power_w),
  };
}
