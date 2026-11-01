import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildModelOrbitSlots } from '../src/shared/model-orbit';
import { LocalModelOrbit } from '../src/renderer/ModelOrbit';

describe('home model orbit slots', () => {
  it('shows no model markers when no models are installed', () => {
    expect(buildModelOrbitSlots([], {}, '')).toEqual([]);
    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models: [], labels: {}, selectedModel: '', status: 'ready' }));
    expect(markup.match(/class="model-orbit-dot/g)).toBeNull();
    expect(markup).toContain('NO LOCAL MODELS FOUND');
  });

  it('keeps inventory pending instead of displaying a false zero before synchronization', () => {
    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models: [], labels: {}, selectedModel: '', status: 'loading' }));
    expect(markup.match(/class="model-orbit-dot/g)).toBeNull();
    expect(markup).toContain('SYNCING LOCAL MODELS');
    expect(markup).not.toContain('NO LOCAL MODELS FOUND');
  });

  it('keeps last synced markers visible while a refresh is underway', () => {
    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models: ['qwen3:8b'], labels: {}, selectedModel: '', status: 'refreshing' }));
    expect(markup.match(/class="model-orbit-dot/g)).toHaveLength(1);
    expect(markup).toContain('REFRESHING MODEL INVENTORY');
    expect(markup).not.toContain('NO LOCAL MODELS FOUND');
  });

  it('creates one labeled marker per installed model and marks the selected model', () => {
    const models = ['qwen3:8b', 'hf.co/example/coder:Q4_K_M', 'llama3:8b'];
    const slots = buildModelOrbitSlots(models, { 'qwen3:8b': 'Qwen 3 8B' }, 'llama3:8b');

    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.label)).toEqual(['coder:Q4_K_M', 'llama3:8b', 'Qwen 3 8B']);
    expect(slots.filter((slot) => slot.selected).map((slot) => slot.id)).toEqual(['llama3:8b']);
    expect(new Set(slots.map((slot) => `${slot.ring},${slot.left},${slot.top}`)).size).toBe(3);
    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models, labels: {}, selectedModel: 'llama3:8b', status: 'ready' }));
    expect(markup.match(/class="visual-orbit orbit-[abc]" data-model-count="\d+"/g)).toHaveLength(3);
    expect(markup.match(/class="model-orbit-dot/g)).toHaveLength(3);
    expect(markup.match(/aria-haspopup="dialog"/g)).toHaveLength(3);
    expect(markup.match(/<button/g)).toHaveLength(4);
    expect(slots.find((slot) => slot.selected)?.id).toBe('llama3:8b');
    expect(markup).toContain('SLOW ORBIT');
  });

  it('places a larger catalog across all rings with stable identity-based positions', () => {
    const models = Array.from({ length: 27 }, (_, index) => `model-${index}`);
    const slots = buildModelOrbitSlots(models, {}, 'model-26');

    expect(slots).toHaveLength(27);
    expect(new Set(slots.map((slot) => slot.ring))).toEqual(new Set([0, 1, 2]));
    expect(slots.every((slot) => {
      const x = (Number.parseFloat(slot.left) - 50) / 50;
      const y = (Number.parseFloat(slot.top) - 50) / 50;
      return Number.isFinite(x) && Number.isFinite(y) && Math.abs(Math.hypot(x, y) - 1) < 1e-12;
    })).toBe(true);
    expect(slots.find((slot) => slot.selected)?.id).toBe('model-26');

    const markup = renderToStaticMarkup(createElement(LocalModelOrbit, { models, labels: {}, selectedModel: 'model-26', status: 'ready' }));
    for (const [ringIndex, ring] of ['a', 'b', 'c'].entries()) {
      const ringCount = slots.filter((slot) => slot.ring === ringIndex).length;
      const ringMarkup = markup.match(new RegExp(`<div class="visual-orbit orbit-${ring}" data-model-count="${ringCount}">([\\s\\S]*?)<\\/div>`))?.[1] ?? '';
      expect(ringMarkup.match(/class="model-orbit-dot/g)).toHaveLength(ringCount);

      expect(slots.filter((slot) => slot.ring === ringIndex).every((slot) => {
        const x = (Number.parseFloat(slot.left) - 50) / 50;
        const y = (Number.parseFloat(slot.top) - 50) / 50;
        return Math.abs(Math.hypot(x, y) - 1) < 1e-12;
      })).toBe(true);
    }

    const before = new Map(slots.filter((slot) => slot.id !== 'model-27').map((slot) => [slot.id, `${slot.ring},${slot.left},${slot.top}`]));
    const after = buildModelOrbitSlots([...models, 'model-27'], {}, '');
    for (const slot of after.filter((entry) => before.has(entry.id))) {
      expect(`${slot.ring},${slot.left},${slot.top}`).toBe(before.get(slot.id));
    }
  });
});
