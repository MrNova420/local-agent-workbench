import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_SHEET_LAYOUT, moveRunSheetPanel, normalizeRunSheetLayout, resizeRunSheetPanel } from '../src/shared/run-sheet-layout';

describe('live worksheet layout', () => {
  it('restores a validated panel order and bounded sizes from persisted data', () => {
    expect(normalizeRunSheetLayout({ order: ['activity', 'activity', 'unknown'], heights: { activity: 900, plan: 120 } })).toEqual({
      order: ['activity', 'signals', 'plan', 'resources'],
      heights: { signals: 420, plan: 120, activity: 520, resources: 190 },
    });
  });

  it('moves panels with stable boundaries and adjusts size in usable increments', () => {
    expect(moveRunSheetPanel(DEFAULT_RUN_SHEET_LAYOUT, 'activity', -1).order).toEqual(['signals', 'activity', 'plan', 'resources']);
    expect(moveRunSheetPanel(DEFAULT_RUN_SHEET_LAYOUT, 'signals', -1)).toBe(DEFAULT_RUN_SHEET_LAYOUT);
    expect(resizeRunSheetPanel(DEFAULT_RUN_SHEET_LAYOUT, 'activity', 1).heights.activity).toBe(320);
    expect(resizeRunSheetPanel({ ...DEFAULT_RUN_SHEET_LAYOUT, heights: { ...DEFAULT_RUN_SHEET_LAYOUT.heights, activity: 90 } }, 'activity', -1).heights.activity).toBe(90);
  });
});
