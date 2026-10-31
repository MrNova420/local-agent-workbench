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

const BASE_TIERS = [4096, 8192, 16384, 32768, 65536, 100000, 131072, 200000, 262144, 300000, 500000, 750000, 1000000, 1500000, 2000000, 3000000, 5000000, 10000000];

function buildTiers(): number[] {
  const values = new Set(BASE_TIERS);
  for (let value = 4096; value <= 16_777_216; value *= 2) values.add(value);
  return [...values].sort((a, b) => a - b);
}

function presetRows(limit: number | null, kind: 'context' | 'output'): TokenPreset[] {
  const tiers = new Set(buildTiers());
  if (limit !== null) tiers.add(limit);
  return [...tiers].sort((a, b) => a - b).map((value) => ({
    value,
    label: value === limit ? `${value.toLocaleString()} · ${kind} maximum` : value.toLocaleString(),
    disabled: limit !== null && value > limit,
  }));
}

export function buildTokenPresets({ contextLimit, outputLimit }: { contextLimit: number; outputLimit: number | null }): TokenPresetSet {
  const safeContext = Number.isSafeInteger(contextLimit) && contextLimit >= 1 ? contextLimit : 4096;
  const safeOutput = outputLimit !== null && Number.isSafeInteger(outputLimit) && outputLimit >= 1 ? outputLimit : null;
  return {
    context: presetRows(safeContext, 'context'),
    output: presetRows(safeOutput, 'output'),
    outputLimitKnown: safeOutput !== null,
  };
}

export function normalizeReasoningChoice(choice: unknown, capability: ReasoningCapability | null): ReasoningChoice {
  if (choice === null || choice === undefined || choice === 'default') return null;
  if (!capability || capability.support === 'unknown' || capability.support === 'none') return null;
  return capability.values.some((value) => value === choice) ? choice as ReasoningChoice : null;
}
