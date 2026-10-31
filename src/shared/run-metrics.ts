export type RunMetrics = {
  firstTokenMs: number | null;
  outputTokens: number;
  promptTokens: number;
  cachedPromptTokens: number;
  promptEvalNanoseconds: number;
  modelLoadNanoseconds: number;
  decodeNanoseconds: number;
  pendingCharacters: number;
  estimatedDecodeNanoseconds: number;
  generationStartedAtMs: number | null;
  isGenerating: boolean;
};

export function emptyRunMetrics(): RunMetrics {
  return {
    firstTokenMs: null,
    outputTokens: 0,
    promptTokens: 0,
    cachedPromptTokens: 0,
    promptEvalNanoseconds: 0,
    modelLoadNanoseconds: 0,
    decodeNanoseconds: 0,
    pendingCharacters: 0,
    estimatedDecodeNanoseconds: 0,
    generationStartedAtMs: null,
    isGenerating: false,
  };
}

export function recordFirstToken(metrics: RunMetrics, elapsedSeconds: unknown): RunMetrics {
  if (metrics.firstTokenMs !== null || typeof elapsedSeconds !== 'number' || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return metrics;
  return { ...metrics, firstTokenMs: elapsedSeconds * 1000 };
}

export function beginGeneration(metrics: RunMetrics, nowMs = Date.now()): RunMetrics {
  return { ...metrics, generationStartedAtMs: nowMs, isGenerating: true };
}

export function recordStreamedText(metrics: RunMetrics, text: string): RunMetrics {
  if (!text) return metrics;
  return { ...metrics, pendingCharacters: metrics.pendingCharacters + text.length };
}

export function endGeneration(metrics: RunMetrics, nowMs = Date.now()): RunMetrics {
  if (!metrics.isGenerating || metrics.generationStartedAtMs === null) return { ...metrics, isGenerating: false, generationStartedAtMs: null };
  const elapsed = Math.max(0, nowMs - metrics.generationStartedAtMs) * 1e6;
  return {
    ...metrics,
    estimatedDecodeNanoseconds: metrics.estimatedDecodeNanoseconds + elapsed,
    generationStartedAtMs: null,
    isGenerating: false,
  };
}

export function addGenerationUsage(metrics: RunMetrics, usage: unknown): RunMetrics {
  if (!usage || typeof usage !== 'object') return endGeneration(metrics);
  const row = usage as Record<string, unknown>;
  const promptTokens = typeof row.prompt_eval_count === 'number' && Number.isFinite(row.prompt_eval_count) ? Math.max(0, Math.floor(row.prompt_eval_count)) : 0;
  const cachedPromptTokens = typeof row.prompt_eval_cached_count === 'number' && Number.isFinite(row.prompt_eval_cached_count) ? Math.max(0, Math.min(promptTokens || Infinity, Math.floor(row.prompt_eval_cached_count))) : 0;
  const promptEvalNanoseconds = typeof row.prompt_eval_duration === 'number' && Number.isFinite(row.prompt_eval_duration) ? Math.max(0, row.prompt_eval_duration) : 0;
  const modelLoadNanoseconds = typeof row.load_duration === 'number' && Number.isFinite(row.load_duration) ? Math.max(0, row.load_duration) : 0;
  const hasCount = typeof row.eval_count === 'number' && Number.isFinite(row.eval_count);
  const hasDuration = typeof row.eval_duration === 'number' && Number.isFinite(row.eval_duration);
  if (!hasCount || !hasDuration) return { ...endGeneration(metrics), promptTokens: metrics.promptTokens + promptTokens, cachedPromptTokens: metrics.cachedPromptTokens + cachedPromptTokens, promptEvalNanoseconds: metrics.promptEvalNanoseconds + promptEvalNanoseconds, modelLoadNanoseconds: metrics.modelLoadNanoseconds + modelLoadNanoseconds };

  const tokens = Math.max(0, Math.floor(row.eval_count as number));
  const duration = Math.max(0, row.eval_duration as number);
  return {
    ...metrics,
    outputTokens: metrics.outputTokens + tokens,
    promptTokens: metrics.promptTokens + promptTokens,
    cachedPromptTokens: metrics.cachedPromptTokens + cachedPromptTokens,
    promptEvalNanoseconds: metrics.promptEvalNanoseconds + promptEvalNanoseconds,
    modelLoadNanoseconds: metrics.modelLoadNanoseconds + modelLoadNanoseconds,
    decodeNanoseconds: metrics.decodeNanoseconds + duration,
    pendingCharacters: 0,
    generationStartedAtMs: null,
    isGenerating: false,
  };
}

export function estimateOutputTokens(metrics: RunMetrics): number {
  return metrics.outputTokens + (metrics.pendingCharacters ? Math.ceil(metrics.pendingCharacters / 4) : 0);
}

export function outputTokensAreEstimated(metrics: RunMetrics): boolean {
  return metrics.isGenerating || metrics.pendingCharacters > 0 || metrics.estimatedDecodeNanoseconds > 0;
}

export function outputTokensPerSecond(metrics: RunMetrics): number | null {
  if (!metrics.outputTokens || !metrics.decodeNanoseconds) return null;
  return metrics.outputTokens / (metrics.decodeNanoseconds / 1e9);
}

export function liveOutputTokensPerSecond(metrics: RunMetrics, nowMs = Date.now()): number | null {
  const tokens = estimateOutputTokens(metrics);
  const activeDuration = metrics.isGenerating && metrics.generationStartedAtMs !== null
    ? Math.max(0, nowMs - metrics.generationStartedAtMs) * 1e6
    : 0;
  const duration = metrics.decodeNanoseconds + metrics.estimatedDecodeNanoseconds + activeDuration;
  if (!tokens || !duration) return null;
  return tokens / (duration / 1e9);
}
