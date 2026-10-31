import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildModelOrbitSlots } from '../src/shared/model-orbit';
import { LocalModelOrbit } from '../src/renderer/ModelOrbit';

describe('home model orbit slots', () => {
  it('shows no model markers when no models are installed', () => {
    expect(buildModelOrbitSlots([], {}, '')).toEqual([]);
    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models: [], labels: {}, selectedModel: '' }));
    expect(markup.match(/class="model-orbit-dot/g)).toBeNull();
  });

  it('creates one labeled marker per installed model and marks the selected model', () => {
    const models = ['qwen3:8b', 'hf.co/example/coder:Q4_K_M', 'llama3:8b'];
    const slots = buildModelOrbitSlots(models, { 'qwen3:8b': 'Qwen 3 8B' }, 'llama3:8b');

    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.label)).toEqual(['Qwen 3 8B', 'coder:Q4_K_M', 'llama3:8b']);
    expect(slots.filter((slot) => slot.selected).map((slot) => slot.id)).toEqual(['llama3:8b']);
    expect(new Set(slots.map((slot) => `${slot.ring},${slot.left},${slot.top}`)).size).toBe(3);
    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models, labels: {}, selectedModel: 'llama3:8b' }));
    expect(markup.match(/class="visual-orbit orbit-[abc]" data-model-count="1"/g)).toHaveLength(3);
    expect(markup.match(/class="model-orbit-dot/g)).toHaveLength(3);
    expect(markup).toContain('model-orbit-dot ring-2 selected');
  });

  it('distributes a larger catalog across all three rings with in-bounds positions', () => {
    const models = Array.from({ length: 27 }, (_, index) => `model-${index}`);
    const slots = buildModelOrbitSlots(models, {}, 'model-26');

    expect(slots).toHaveLength(27);
    expect(slots.filter((slot) => slot.ring === 0)).toHaveLength(9);
    expect(slots.filter((slot) => slot.ring === 1)).toHaveLength(9);
    expect(slots.filter((slot) => slot.ring === 2)).toHaveLength(9);
    expect(slots.every((slot) => {
      const x = (Number.parseFloat(slot.left) - 50) / 50;
      const y = (Number.parseFloat(slot.top) - 50) / 50;
      return Number.isFinite(x) && Number.isFinite(y) && Math.abs(Math.hypot(x, y) - 1) < 1e-12;
    })).toBe(true);
    expect(slots.find((slot) => slot.selected)?.id).toBe('model-26');

    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models, labels: {}, selectedModel: 'model-26' }));
    const dimensions = [[114.5, 114.5], [152.5, 91.5], [91.5, 152.5]] as const;
    for (const [ringIndex, ring] of ['a', 'b', 'c'].entries()) {
      const ringMarkup = markup.match(new RegExp(`<div class="visual-orbit orbit-${ring}" data-model-count="9">([\\s\\S]*?)<\\/div>`))?.[1] ?? '';
      expect(ringMarkup.match(/class="model-orbit-dot/g)).toHaveLength(9);

      const [radiusX, radiusY] = dimensions[ringIndex];
      const ringSlots = slots.filter((slot) => slot.ring === ringIndex);
      const angles = ringSlots.map((slot) => Math.atan2(Number.parseFloat(slot.top) - 50, Number.parseFloat(slot.left) - 50));
      for (let index = 1; index < angles.length; index += 1) {
        while (angles[index] < angles[index - 1]) angles[index] += Math.PI * 2;
      }
      const distances = angles.map((angle, index) => {
        const next = angles[(index + 1) % angles.length] + (index + 1 === angles.length ? Math.PI * 2 : 0);
        const segments = 256;
        const step = (next - angle) / segments;
        let distance = 0;
        for (let segment = 0; segment < segments; segment += 1) {
          const sample = angle + (segment + 0.5) * step;
          distance += Math.hypot(radiusX * Math.sin(sample), radiusY * Math.cos(sample)) * step;
        }
        return distance;
      });
      expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.01);
    }
  });
});
