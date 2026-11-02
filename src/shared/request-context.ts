export type RequestContextStats = {
  usedTokens: number | null;
  source: 'provider' | 'estimate' | 'unknown';
  inputBudget: number | null;
  configuredContext: number | null;
  remainingTokens: number | null;
  utilization: number | null;
};

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export function requestContextStats(activity: { promptManifest?: unknown; providerUsage?: unknown } | undefined): RequestContextStats {
  const manifest = activity?.promptManifest && typeof activity.promptManifest === 'object'
    ? activity.promptManifest as Record<string, unknown>
    : {};
  const usage = activity?.providerUsage && typeof activity.providerUsage === 'object'
    ? activity.providerUsage as Record<string, unknown>
    : {};
  const reported = nonNegativeInteger(usage.prompt_eval_count);
  const estimate = nonNegativeInteger(manifest.estimated_request_input_tokens);
  const usedTokens = reported ?? estimate;
  const inputBudget = nonNegativeInteger(manifest.input_budget);
  return {
    usedTokens,
    source: reported !== null ? 'provider' : estimate !== null ? 'estimate' : 'unknown',
    inputBudget,
    configuredContext: nonNegativeInteger(manifest.configured_context),
    remainingTokens: usedTokens !== null && inputBudget !== null ? inputBudget - usedTokens : null,
    utilization: usedTokens !== null && inputBudget !== null && inputBudget > 0 ? usedTokens / inputBudget : null,
  };
}
