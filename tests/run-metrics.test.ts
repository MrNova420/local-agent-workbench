import { describe, expect, it } from 'vitest';
import { addGenerationUsage, beginGeneration, emptyRunMetrics, estimateOutputTokens, liveOutputTokensPerSecond, outputTokensPerSecond, recordStreamedText, recordFirstToken, restoreRunMetrics } from '../src/shared/run-metrics';

describe('per-run Ollama measurements', () => {
  it('restores exact prompt/output/cache usage and the last request estimate from saved events', () => {
    const restored = restoreRunMetrics([
      { first_token_seconds: 12, estimated_input_tokens: 4100, usage: { prompt_eval_count: 4000, prompt_eval_cached_count: 2500, eval_count: 30, eval_duration: 10_000_000_000 } },
      { first_token_seconds: 9, estimated_input_tokens: 4300, usage: { prompt_eval_count: 4200, prompt_eval_cached_count: 3000, eval_count: 20, eval_duration: 10_000_000_000 } },
    ]);

    expect(restored.firstTokenMs).toBe(12_000);
    expect(restored.promptTokens).toBe(8200);
    expect(restored.lastRequestPromptTokens).toBe(4200);
    expect(restored.estimatedInputTokens).toBe(4300);
    expect(restored.outputTokens).toBe(50);
    expect(restored.cachedPromptTokens).toBe(5500);
  });
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

  it('reports provider-measured prompt tokens and cache hits without estimating them', () => {
    const metrics = addGenerationUsage(emptyRunMetrics(), {
      prompt_eval_count: 1000, prompt_eval_cached_count: 640,
      prompt_eval_duration: 500_000_000, load_duration: 2_000_000_000,
      eval_count: 10, eval_duration: 1_000_000_000,
    });
    expect(metrics.promptTokens).toBe(1000);
    expect(metrics.cachedPromptTokens).toBe(640);
    expect(metrics.promptEvalNanoseconds).toBe(500_000_000);
    expect(metrics.modelLoadNanoseconds).toBe(2_000_000_000);
  });

  it('does not report a rate without measured decode time', () => {
    expect(outputTokensPerSecond(emptyRunMetrics())).toBeNull();
    expect(outputTokensPerSecond(addGenerationUsage(emptyRunMetrics(), { eval_count: 5, eval_duration: 0 }))).toBeNull();
  });

  it('estimates output tokens from streamed characters while generation is active', () => {
    const started = beginGeneration(emptyRunMetrics(), 10_000);
    const streamed = recordStreamedText(started, 'abcdefgh');

    expect(estimateOutputTokens(streamed)).toBe(2);
    expect(streamed.isGenerating).toBe(true);
    expect(liveOutputTokensPerSecond(streamed, 12_000)).toBe(1);
    expect(liveOutputTokensPerSecond(streamed, 14_000)).toBeCloseTo(0.5);
  });

  it('replaces a live estimate with Ollama exact usage after each generation', () => {
    const streamed = recordStreamedText(beginGeneration(emptyRunMetrics(), 1_000), 'estimated output');
    const exact = addGenerationUsage(streamed, { eval_count: 12, eval_duration: 6_000_000_000 });

    expect(exact.outputTokens).toBe(12);
    expect(estimateOutputTokens(exact)).toBe(12);
    expect(exact.isGenerating).toBe(false);
    expect(exact.pendingCharacters).toBe(0);

    const next = recordStreamedText(beginGeneration(exact, 8_000), 'more');
    expect(estimateOutputTokens(next)).toBe(13);
    expect(liveOutputTokensPerSecond(next, 9_000)).toBeCloseTo(1.86, 2);
  });
});
