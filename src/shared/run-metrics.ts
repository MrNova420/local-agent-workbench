export type RunMetrics = {
  firstTokenMs: number | null;
  outputTokens: number;
  decodeNanoseconds: number;
};

export function emptyRunMetrics(): RunMetrics {
  return { firstTokenMs: null, outputTokens: 0, decodeNanoseconds: 0 };
}

export function recordFirstToken(metrics: RunMetrics, elapsedSeconds: unknown): RunMetrics {
  if (metrics.firstTokenMs !== null || typeof elapsedSeconds !== 'number' || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return metrics;
  return { ...metrics, firstTokenMs: elapsedSeconds * 1000 };
}

export function addGenerationUsage(metrics: RunMetrics, usage: unknown): RunMetrics {
  if (!usage || typeof usage !== 'object') return metrics;
  const row = usage as Record<string, unknown>;
  const tokens = typeof row.eval_count === 'number' && Number.isFinite(row.eval_count) ? Math.max(0, Math.floor(row.eval_count)) : 0;
  const duration = typeof row.eval_duration === 'number' && Number.isFinite(row.eval_duration) ? Math.max(0, row.eval_duration) : 0;
  if (!tokens && !duration) return metrics;
  return { ...metrics, outputTokens: metrics.outputTokens + tokens, decodeNanoseconds: metrics.decodeNanoseconds + duration };
}

export function outputTokensPerSecond(metrics: RunMetrics): number | null {
  if (!metrics.outputTokens || !metrics.decodeNanoseconds) return null;
  return metrics.outputTokens / (metrics.decodeNanoseconds / 1e9);
}
