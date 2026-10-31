export type ReasoningChoice = boolean | string | null;

export type ReasoningCapability = {
  support: 'toggle' | 'levels' | 'unknown' | 'none';
  default: boolean | string | null;
  values: Array<boolean | string>;
};

export type TokenPreset = { value: number; label: string; disabled: boolean };

export type TokenPresetSet = {
  context: TokenPreset[];
  output: TokenPreset[];
  outputLimitKnown: boolean;
};

const BASE_TIERS = [4096, 8192, 16384, 32768, 65536, 100000, 131072, 200000, 262144, 300000, 500000, 750000, 1500000, 3000000];

function buildTiers(limit: number): number[] {
  const values = new Set(BASE_TIERS);
  for (const seed of [1_000_000, 2_000_000, 5_000_000, 10_000_000]) {
    for (let value = seed; value <= Math.max(limit * 2, seed); value *= 2) values.add(value);
  }
  for (let value = 1 << 12; value <= Math.max(limit * 2, 4096); value *= 2) values.add(value);
  return [...values].sort((a, b) => a - b).filter((value) => value <= Math.max(limit * 2, 4096));
}

function presetRows(limit: number, otherLimit: number, kind: 'context' | 'output', explicitLimit: boolean): TokenPreset[] {
  const tiers = new Set([...buildTiers(Math.max(limit, otherLimit)), limit]);
  return [...tiers].sort((a, b) => a - b).map((value) => ({
    value,
    label: value === limit && explicitLimit ? `${value.toLocaleString()} · ${kind} maximum` : value.toLocaleString(),
    disabled: value > limit,
  }));
}

export function buildTokenPresets({ contextLimit, outputLimit }: { contextLimit: number; outputLimit: number | null }): TokenPresetSet {
  const safeContext = Number.isSafeInteger(contextLimit) && contextLimit >= 1 ? contextLimit : 4096;
  const safeOutput = outputLimit !== null && Number.isSafeInteger(outputLimit) && outputLimit >= 1 ? outputLimit : null;
  const outputCeiling = safeOutput ?? safeContext;
  return {
    context: presetRows(safeContext, outputCeiling, 'context', true),
    output: presetRows(outputCeiling, safeContext, 'output', safeOutput !== null),
    outputLimitKnown: safeOutput !== null,
  };
}

export function normalizeReasoningChoice(choice: unknown, capability: ReasoningCapability | null): ReasoningChoice {
  if (choice === null || choice === undefined || choice === 'default') return null;
  if (!capability || capability.support === 'unknown' || capability.support === 'none') return null;
  return capability.values.some((value) => value === choice) ? choice as ReasoningChoice : null;
}
