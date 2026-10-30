import { describe, expect, it } from 'vitest';
import { addGenerationUsage, emptyRunMetrics, outputTokensPerSecond, recordFirstToken } from '../src/shared/run-metrics';

describe('per-run Ollama measurements', () => {
  it('keeps the first model-token delay for the whole task', () => {
    const first = recordFirstToken(emptyRunMetrics(), 38.5);
    const later = recordFirstToken(first, 12);

    expect(first.firstTokenMs).toBe(38_500);
    expect(later.firstTokenMs).toBe(38_500);
  });

  it('combines decode tokens and nanoseconds across tool-loop responses', () => {
    const first = addGenerationUsage(emptyRunMetrics(), { eval_count: 20, eval_duration: 10_000_000_000 });
    const combined = addGenerationUsage(first, { eval_count: 30, eval_duration: 20_000_000_000 });

    expect(combined.outputTokens).toBe(50);
    expect(combined.decodeNanoseconds).toBe(30_000_000_000);
    expect(outputTokensPerSecond(combined)).toBeCloseTo(1.67, 2);
  });

  it('does not report a rate without measured decode time', () => {
    expect(outputTokensPerSecond(emptyRunMetrics())).toBeNull();
    expect(outputTokensPerSecond(addGenerationUsage(emptyRunMetrics(), { eval_count: 5, eval_duration: 0 }))).toBeNull();
  });
});
