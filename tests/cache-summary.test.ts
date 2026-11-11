import { describe, expect, it } from 'vitest';
import { promptRequestSummary } from '../src/renderer/ActivityFeed';
import type { ActivityRecord } from '../src/shared/protocol';

function summary(providerUsage?: Record<string, unknown>, providerRequest?: Record<string, unknown>): string[] {
  return promptRequestSummary({
    id: 'request-1', kind: 'prompt', status: 'completed',
    providerUsage, providerRequest,
  } as ActivityRecord);
}

describe('prompt request activity summary', () => {
  it('shows cache percentage from exact provider counts', () => {
    const result = summary({ prompt_eval_count: 20_000, prompt_eval_cached_count: 17_000 });
    expect(result).toContain('17,000/20,000 prompt tokens cached');
    expect(result).toContain('85% cached');
  });

  it('shows a total cache miss as 0%', () => {
    const result = summary({ prompt_eval_count: 20_000, prompt_eval_cached_count: 0 });
    expect(result).toContain('0/20,000 prompt tokens cached');
    expect(result).toContain('0% cached');
  });

  it('does not invent a cache percentage when either exact count is absent', () => {
    expect(summary({ prompt_eval_count: 20_000 })).not.toContain('% cached');
    expect(summary({ prompt_eval_cached_count: 0 })).not.toContain('% cached');
    expect(summary()).not.toContain('% cached');
  });

  it('surfaces header-wait latency in the compact row', () => {
    expect(summary(undefined, { request_index: 7, header_wait_seconds: 92.345 }))
      .toContain('headers in 92.3 s');
  });
});
