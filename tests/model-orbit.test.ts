import { describe, expect, it } from 'vitest';
import { buildModelOrbitSlots } from '../src/shared/model-orbit';

describe('home model orbit slots', () => {
  it('shows no model markers when no models are installed', () => {
    expect(buildModelOrbitSlots([], {}, '')).toEqual([]);
  });

  it('creates one labeled marker per installed model and marks the selected model', () => {
    const models = ['qwen3:8b', 'hf.co/example/coder:Q4_K_M', 'llama3:8b'];
    const slots = buildModelOrbitSlots(models, { 'qwen3:8b': 'Qwen 3 8B' }, 'llama3:8b');

    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.label)).toEqual(['Qwen 3 8B', 'coder:Q4_K_M', 'llama3:8b']);
    expect(slots.filter((slot) => slot.selected).map((slot) => slot.id)).toEqual(['llama3:8b']);
    expect(new Set(slots.map((slot) => `${slot.left},${slot.top}`)).size).toBe(3);
  });

  it('distributes a larger catalog across all three rings with in-bounds positions', () => {
    const models = Array.from({ length: 27 }, (_, index) => `model-${index}`);
    const slots = buildModelOrbitSlots(models, {}, 'model-26');

    expect(slots).toHaveLength(27);
    expect(slots.filter((slot) => slot.ring === 0)).toHaveLength(9);
    expect(slots.filter((slot) => slot.ring === 1)).toHaveLength(9);
    expect(slots.filter((slot) => slot.ring === 2)).toHaveLength(9);
    expect(slots.every((slot) => {
      const left = Number.parseFloat(slot.left);
      const top = Number.parseFloat(slot.top);
      return Number.isFinite(left) && Number.isFinite(top) && left >= 0 && left <= 100 && top >= 0 && top <= 100;
    })).toBe(true);
    const verticalPositions = slots.map((slot) => Number.parseFloat(slot.top));
    expect(Math.min(...verticalPositions)).toBeGreaterThan(12);
    expect(Math.max(...verticalPositions)).toBeLessThan(88);
    expect(slots.find((slot) => slot.selected)?.id).toBe('model-26');
  });
});
