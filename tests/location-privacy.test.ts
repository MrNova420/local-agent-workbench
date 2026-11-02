import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url)), 'utf8');

describe('home hero location privacy', () => {
  it('does not embed geographic coordinates or access device geolocation', () => {
    expect(appSource).not.toMatch(/\b\d{1,3}\s*°\s*\d{1,2}\s*[′']\s*\d{1,2}\s*[″"]\s*[NS]\b/i);
    expect(appSource).not.toMatch(/navigator\s*\.\s*geolocation|GeolocationPosition/i);
  });
});
