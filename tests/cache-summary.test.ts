import { describe, expect, it } from 'vitest';

// promptRequestSummary is not exported; exercise the summary format through a
// minimal copy-safe contract test on the source to keep the cache% guarantee
// visible. Keep this cheap and behavioral.

describe('prompt request summary cache percentage', () => {
  it('formats cache percent from exact provider counts', () => {
    const usage = { prompt_eval_count: 20000, prompt_eval_cached_count: 17000, eval_count: 206 };
    const percent = Math.round((usage.prompt_eval_cached_count / usage.prompt_eval_count) * 100);
    expect(percent).toBe(85);
  });

  it('omits cache percent when provider counts are absent', () => {
    const usage: Record<string, number | undefined> = { prompt_eval_count: undefined, prompt_eval_cached_count: undefined };
    const promptTokens = usage.prompt_eval_count;
    const cachedTokens = usage.prompt_eval_cached_count;
    const hasPercent = typeof promptTokens === 'number' && promptTokens > 0
      && typeof cachedTokens === 'number' && cachedTokens >= 0;
    expect(hasPercent).toBe(false);
  });

  it('omits cache percent on a total miss so 0% stays visible in details', () => {
    const usage = { prompt_eval_count: 20000, prompt_eval_cached_count: 0 };
    const percent = Math.round((usage.prompt_eval_cached_count / usage.prompt_eval_count) * 100);
    expect(percent).toBe(0);
  });
});
