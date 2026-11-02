import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url)), 'utf8');
const readmeSource = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
const historicalHero = fileURLToPath(new URL('../docs/screenshots/history/home-orbit-concept-2026-10-31.png', import.meta.url));

describe('home hero location privacy', () => {
  it('does not embed geographic coordinates or access device geolocation', () => {
    expect(appSource).not.toMatch(/\b\d{1,3}\s*°\s*\d{1,2}\s*[′']\s*\d{1,2}\s*[″"]\s*[NS]\b/i);
    expect(appSource).not.toMatch(/navigator\s*\.\s*geolocation|GeolocationPosition/i);
  });

  it('does not publish the coordinate-bearing historical hero screenshot', () => {
    expect(existsSync(historicalHero)).toBe(false);
    expect(readmeSource).not.toContain('home-orbit-concept-2026-10-31.png');
  });
});
