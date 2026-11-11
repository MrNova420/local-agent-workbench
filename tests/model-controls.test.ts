import { describe, expect, it } from 'vitest';
import { buildModelLabels, buildTokenPresets, chooseDefaultModel, isReasoningBudgetValid, normalizeReasoningChoice, readReasoningBudgetPreference, readRunTokenPreferences, type ReasoningCapability } from '../src/shared/model-controls';

describe('model capability controls', () => {
  it('disambiguates installed models that share the same short display name', () => {
    const labels = buildModelLabels([
      'hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M',
      'hf.co/ressl/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M',
    ]);

    expect(labels['hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M']).toContain('hf.co/mradermacher');
    expect(labels['hf.co/ressl/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M']).toContain('hf.co/ressl');
    expect(Object.values(labels)[0]).not.toBe(Object.values(labels)[1]);
  });

  it('does not cap context presets at 65,536 when model maximum is unknown', () => {
    const presets = buildTokenPresets({ contextLimit: null, contextLimitKnown: false, outputLimit: null });
    expect(presets.contextLimitKnown).toBe(false);
    expect(presets.context.some((item) => item.value === 65_536)).toBe(true);
    expect(presets.context.some((item) => item.value === 131_072 && !item.disabled)).toBe(true);
    expect(presets.context.some((item) => item.value === 1_048_576 && !item.disabled)).toBe(true);
  });

  it('builds context tiers beyond one million and includes the exact nonstandard maximum', () => {
    const presets = buildTokenPresets({ contextLimit: 2_500_000, outputLimit: 1_500_000 });

    expect(presets.context.find((item) => item.value === 2_500_000)?.label).toContain('context maximum');
    expect(presets.context.some((item) => item.value === 1_000_000)).toBe(true);
    expect(presets.context.some((item) => item.value === 2_000_000)).toBe(true);
    expect(presets.context.find((item) => item.value === 3_000_000)?.disabled).toBe(false);
    expect(presets.context.find((item) => item.value === 3_000_000)?.label).toContain('above advertised context maximum');
    expect(presets.context.some((item) => item.value === 512)).toBe(true);
  });

  it('builds output tiers independently from context and marks unknown limits', () => {
    const known = buildTokenPresets({ contextLimit: 2_000_000, outputLimit: 1_500_000 });
    const unknown = buildTokenPresets({ contextLimit: 32_768, outputLimit: null });

    expect(known.output.find((item) => item.value === 1_500_000)?.label).toContain('output maximum');
    expect(known.output.find((item) => item.value === 2_000_000)?.disabled).toBe(false);
    expect(known.output.find((item) => item.value === 2_000_000)?.label).toContain('above advertised output maximum');
    expect(unknown.outputLimitKnown).toBe(false);
    expect(unknown.output.some((item) => item.value === 32_768)).toBe(true);
    expect(unknown.output.some((item) => item.value === 1_000_000 && !item.disabled)).toBe(true);
    expect(unknown.output.some((item) => item.value === 10_000_000 && !item.disabled)).toBe(true);
  });

  it('keeps model context tiers available when the runtime does not report a maximum', () => {
    const unknown = buildTokenPresets({ contextLimit: null, contextLimitKnown: false, outputLimit: null });
    expect(unknown.contextLimitKnown).toBe(false);
    expect(unknown.context.some((item) => item.value === 1_000_000 && !item.disabled)).toBe(true);
  });

  it('keeps reasoning default when metadata is absent and accepts only advertised choices', () => {
    const capability: ReasoningCapability = { support: 'levels', default: 'medium', values: ['low', 'medium', 'high'] };

    expect(normalizeReasoningChoice(undefined, null)).toBe(null);
    expect(normalizeReasoningChoice('off', capability)).toBe(null);
    expect(normalizeReasoningChoice('high', capability)).toBe('high');
    expect(normalizeReasoningChoice(false, { support: 'toggle', default: true, values: [false, true] })).toBe(false);
  });
  it('defaults to the approved exact mradermacher model instead of whichever Ollama lists first', () => {
    expect(chooseDefaultModel(['hf.co/ressl/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M', 'hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M'])).toBe('hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M');
    expect(chooseDefaultModel(['qwen3:0.6b'])).toBe('qwen3:0.6b');
    expect(chooseDefaultModel(['hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M'], 'qwen3:0.6b')).toBe('hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M');
  });

  it('keeps the chosen 65K context and 8K output across a fresh app window', () => {
    expect(readRunTokenPreferences(null)).toEqual({ context: 65536, maxTokens: 8192 });
    expect(readRunTokenPreferences(JSON.stringify({ context: 65536, maxTokens: 8192 })))
      .toEqual({ context: 65536, maxTokens: 8192 });
  });

  it('preserves custom token choices without silently clamping them', () => {
    expect(readRunTokenPreferences(JSON.stringify({ context: 300000, maxTokens: 12000 })))
      .toEqual({ context: 300000, maxTokens: 12000 });
  });

  it('preserves deliberately small positive context values', () => {
    expect(readRunTokenPreferences(JSON.stringify({ context: 512, maxTokens: 2048 })))
      .toEqual({ context: 512, maxTokens: 2048 });
  });

  it('preserves unlimited or exact custom thinking budgets and validates the server integer range', () => {
    expect(readReasoningBudgetPreference(null)).toBeNull();
    expect(readReasoningBudgetPreference('0')).toBe(0);
    expect(readReasoningBudgetPreference('65536')).toBe(65536);
    expect(isReasoningBudgetValid(2_147_483_647)).toBe(true);
    expect(isReasoningBudgetValid(null)).toBe(true);
    expect(isReasoningBudgetValid(-1)).toBe(false);
    expect(isReasoningBudgetValid(1.5)).toBe(false);
    expect(isReasoningBudgetValid(2_147_483_648)).toBe(false);
    expect(isReasoningBudgetValid(true)).toBe(false);
  });
});
