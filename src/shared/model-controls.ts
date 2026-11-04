export type ReasoningChoice = boolean | string | null;
export const MAX_REASONING_BUDGET_TOKENS = 2_147_483_647;

export function isReasoningBudgetValid(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0 && value <= MAX_REASONING_BUDGET_TOKENS);
}

export function readReasoningBudgetPreference(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const parsed = Number(raw);
  return isReasoningBudgetValid(parsed) ? parsed : null;
}

export type ReasoningCapability = {
  support: 'toggle' | 'levels' | 'unknown' | 'none';
  default: boolean | string | null;
  values: Array<boolean | string>;
};

export type TokenPreset = { value: number; label: string; disabled: boolean };

export type TokenPresetSet = {
  context: TokenPreset[];
  output: TokenPreset[];
  contextLimitKnown: boolean;
  outputLimitKnown: boolean;
};

export type RunTokenPreferences = { context: number; maxTokens: number };
export const DEFAULT_RUN_TOKEN_PREFERENCES: RunTokenPreferences = { context: 65_536, maxTokens: 8_192 };

export function readRunTokenPreferences(raw: string | null): RunTokenPreferences {
  if (!raw) return { ...DEFAULT_RUN_TOKEN_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<RunTokenPreferences>;
    return {
      context: Number.isSafeInteger(parsed.context) && Number(parsed.context) >= 1 ? Number(parsed.context) : DEFAULT_RUN_TOKEN_PREFERENCES.context,
      maxTokens: Number.isSafeInteger(parsed.maxTokens) && Number(parsed.maxTokens) >= 1 ? Number(parsed.maxTokens) : DEFAULT_RUN_TOKEN_PREFERENCES.maxTokens,
    };
  } catch {
    return { ...DEFAULT_RUN_TOKEN_PREFERENCES };
  }
}

export const DEFAULT_OLLAMA_MODEL = 'hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M';

export function chooseDefaultModel(modelIds: string[], current = ''): string {
  if (current && modelIds.includes(current)) return current;
  return modelIds.includes(DEFAULT_OLLAMA_MODEL) ? DEFAULT_OLLAMA_MODEL : modelIds[0] || '';
}

export function buildModelLabels(modelIds: string[], overrides: Record<string, string> = {}): Record<string, string> {
  const rows = modelIds.map((id) => {
    const normalized = id.startsWith('gguf::') ? id.slice('gguf::'.length) : id;
    const pathParts = normalized.replaceAll('\\', '/').split('/').filter(Boolean);
    const base = overrides[id] || pathParts.at(-1) || id || 'No model selected';
    const origin = pathParts.length > 1 ? pathParts.slice(0, -1).slice(-2).join('/') : id;
    return { id, base, origin };
  });
  const baseCounts = new Map<string, number>();
  const originCounts = new Map<string, number>();
  for (const row of rows) {
    baseCounts.set(row.base, (baseCounts.get(row.base) ?? 0) + 1);
    const key = `${row.base}\0${row.origin}`;
    originCounts.set(key, (originCounts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(rows.map(({ id, base, origin }) => {
    if ((baseCounts.get(base) ?? 0) < 2) return [id, base];
    const suffix = (originCounts.get(`${base}\0${origin}`) ?? 0) > 1 ? id : origin;
    return [id, `${base} · ${suffix}`];
  }));
}

const BASE_TIERS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 1536, 2048, 3072, 4096, 8192, 16384, 32768, 65536, 100000, 131072, 200000, 262144, 300000, 500000, 750000, 1000000, 1500000, 2000000, 3000000, 5000000, 10000000];

function buildTiers(): number[] {
  const values = new Set(BASE_TIERS);
  for (let value = 1; value <= 16_777_216; value *= 2) values.add(value);
  return [...values].sort((a, b) => a - b);
}

function presetRows(limit: number | null, kind: 'context' | 'output'): TokenPreset[] {
  const tiers = new Set(buildTiers());
  if (limit !== null) tiers.add(limit);
  return [...tiers].sort((a, b) => a - b).map((value) => ({
    value,
    label: value === limit ? `${value.toLocaleString()} · advertised ${kind} maximum`
      : limit !== null && value > limit ? `${value.toLocaleString()} · above advertised ${kind} maximum (${limit.toLocaleString()})`
      : value.toLocaleString(),
    disabled: false,
  }));
}

export function buildTokenPresets({ contextLimit, contextLimitKnown, outputLimit }: { contextLimit: number | null; contextLimitKnown?: boolean; outputLimit: number | null }): TokenPresetSet {
  const safeContext = contextLimit !== null && Number.isSafeInteger(contextLimit) && contextLimit >= 1 ? contextLimit : null;
  const contextKnown = safeContext !== null && contextLimitKnown !== false;
  const safeOutput = outputLimit !== null && Number.isSafeInteger(outputLimit) && outputLimit >= 1 ? outputLimit : null;
  return {
    context: presetRows(contextKnown ? safeContext : null, 'context'),
    output: presetRows(safeOutput, 'output'),
    contextLimitKnown: contextKnown,
    outputLimitKnown: safeOutput !== null,
  };
}

export function normalizeReasoningChoice(choice: unknown, capability: ReasoningCapability | null): ReasoningChoice {
  if (choice === null || choice === undefined || choice === 'default') return null;
  if (!capability || capability.support === 'unknown' || capability.support === 'none') return null;
  return capability.values.some((value) => value === choice) ? choice as ReasoningChoice : null;
}
