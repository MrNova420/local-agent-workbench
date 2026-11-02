import { describe, expect, it } from 'vitest';
import { requestContextStats } from '../src/shared/request-context';

describe('request context stats', () => {
  it('prefers provider-reported prompt tokens and compares them with the manifest budget', () => {
    expect(requestContextStats({
      promptManifest: { estimated_request_input_tokens: 3900, input_budget: 6000, configured_context: 8192 },
      providerUsage: { prompt_eval_count: 4200 },
    })).toEqual({ usedTokens: 4200, source: 'provider', inputBudget: 6000, configuredContext: 8192, remainingTokens: 1800, utilization: 0.7 });
  });

  it('labels the manifest count as an estimate until the provider reports usage', () => {
    expect(requestContextStats({
      promptManifest: { estimated_request_input_tokens: 3900, input_budget: 6000, configured_context: 8192 },
    })).toEqual({ usedTokens: 3900, source: 'estimate', inputBudget: 6000, configuredContext: 8192, remainingTokens: 2100, utilization: 0.65 });
  });

  it('does not invent zero-token usage when no count is available', () => {
    expect(requestContextStats({ promptManifest: { input_budget: 6000, configured_context: 8192 } })).toEqual({
      usedTokens: null, source: 'unknown', inputBudget: 6000, configuredContext: 8192, remainingTokens: null, utilization: null,
    });
  });
});
