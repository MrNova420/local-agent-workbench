import { describe, expect, it } from 'vitest';
import { featuredInstalledModels } from './model-recommendations';

describe('featured local model picks', () => {
  it('uses the requested priority and exact installed tags only', () => {
    const rows = featuredInstalledModels([
      'hf.co/unsloth/flint-GGUF:UD-IQ2_XXS',
      'hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M',
      'qwen3:0.6b',
      'hf.co/PeppX/Ornith-1.0-9B-Uncensored-GGUF:Q4_K_M',
    ]);
    expect(rows.map((row) => row.label)).toEqual(['Ornith 1.0 · 9B', 'Ornith 1.5 · 9B', 'Flint · GGUF']);
    expect(rows.every((row) => row.id.startsWith('hf.co/'))).toBe(true);
  });

  it('does not show recommendations that are not installed', () => {
    expect(featuredInstalledModels(['qwen3:0.6b'])).toEqual([]);
  });
});
