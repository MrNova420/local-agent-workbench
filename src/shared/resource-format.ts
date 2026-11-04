/** Convert psutil's per-process CPU percentage (100% per fully busy core) to core equivalents. */
export function runtimeWorkerCpuCoreEquivalents(cpuPercent: number | null): string | null {
  if (cpuPercent === null || !Number.isFinite(cpuPercent) || cpuPercent < 0) return null;
  return (cpuPercent / 100).toFixed(1);
}
