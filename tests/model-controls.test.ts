import { describe, expect, it } from 'vitest';
import { buildTokenPresets, normalizeReasoningChoice, type ReasoningCapability } from '../src/shared/model-controls';

describe('model capability controls', () => {
  it('builds context tiers beyond one million and includes the exact nonstandard maximum', () => {
    const presets = buildTokenPresets({ contextLimit: 2_500_000, outputLimit: 1_500_000 });

    expect(presets.context.find((item) => item.value === 2_500_000)?.label).toContain('context maximum');
    expect(presets.context.some((item) => item.value === 1_000_000)).toBe(true);
    expect(presets.context.some((item) => item.value === 2_000_000)).toBe(true);
    expect(presets.context.find((item) => item.value === 3_000_000)?.disabled).toBe(true);
  });

  it('builds output tiers independently from context and marks unknown limits', () => {
    const known = buildTokenPresets({ contextLimit: 2_000_000, outputLimit: 1_500_000 });
    const unknown = buildTokenPresets({ contextLimit: 32_768, outputLimit: null });

    expect(known.output.find((item) => item.value === 1_500_000)?.label).toContain('output maximum');
    expect(known.output.find((item) => item.value === 2_000_000)?.disabled).toBe(true);
    expect(unknown.outputLimitKnown).toBe(false);
    expect(unknown.output.some((item) => item.value === 32_768)).toBe(true);
  });

  it('keeps reasoning default when metadata is absent and accepts only advertised choices', () => {
    const capability: ReasoningCapability = { support: 'levels', default: 'medium', values: ['low', 'medium', 'high'] };

    expect(normalizeReasoningChoice(undefined, null)).toBe(null);
    expect(normalizeReasoningChoice('off', capability)).toBe(null);
    expect(normalizeReasoningChoice('high', capability)).toBe('high');
    expect(normalizeReasoningChoice(false, { support: 'toggle', default: true, values: [false, true] })).toBe(false);
  });
});
