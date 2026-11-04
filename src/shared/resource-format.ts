/** Convert psutil's per-process CPU percentage (100% per fully busy core) to core equivalents. */
export function processCpuCoreEquivalents(cpuPercent: number | null): string | null {
  if (cpuPercent === null || !Number.isFinite(cpuPercent) || cpuPercent < 0) return null;
  return (cpuPercent / 100).toFixed(1);
}

/** Backwards-compatible name retained for the inference-worker display. */
export const runtimeWorkerCpuCoreEquivalents = processCpuCoreEquivalents;
