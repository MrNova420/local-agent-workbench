import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_SHEET_LAYOUT, moveRunSheetPanel, normalizeRunSheetLayout, resizeRunSheetPanel, restoreRunSheetLayout } from '../src/shared/run-sheet-layout';

describe('live worksheet layout', () => {
  it('restores a validated panel order and bounded sizes from persisted data', () => {
    expect(normalizeRunSheetLayout({ order: ['activity', 'activity', 'unknown'], heights: { activity: 900, plan: 120 } })).toEqual({
      order: ['activity', 'plan', 'signals', 'resources'],
      heights: { signals: 260, plan: 120, activity: 520, resources: 190 },
    });
  });

  it('puts the plan and activity before secondary metrics in a new workspace', () => {
    expect(DEFAULT_RUN_SHEET_LAYOUT.order).toEqual(['plan', 'activity', 'signals', 'resources']);
    expect(DEFAULT_RUN_SHEET_LAYOUT.heights.plan).toBeGreaterThanOrEqual(180);
    expect(DEFAULT_RUN_SHEET_LAYOUT.heights.activity).toBeGreaterThanOrEqual(300);
  });

  it('moves the old built-in layout forward while preserving customized layouts', () => {
    expect(restoreRunSheetLayout({ order: ['signals', 'plan', 'activity', 'resources'],
      heights: { signals: 420, plan: 138, activity: 280, resources: 190 } })).toEqual(DEFAULT_RUN_SHEET_LAYOUT);
    const customized = { order: ['activity', 'signals', 'plan', 'resources'],
      heights: { signals: 240, plan: 150, activity: 330, resources: 190 } };
    expect(restoreRunSheetLayout(customized)).toEqual(normalizeRunSheetLayout(customized));
  });

  it('moves panels with stable boundaries and adjusts size in usable increments', () => {
    expect(moveRunSheetPanel(DEFAULT_RUN_SHEET_LAYOUT, 'activity', -1).order).toEqual(['activity', 'plan', 'signals', 'resources']);
    expect(moveRunSheetPanel(DEFAULT_RUN_SHEET_LAYOUT, 'plan', -1)).toBe(DEFAULT_RUN_SHEET_LAYOUT);
    expect(resizeRunSheetPanel(DEFAULT_RUN_SHEET_LAYOUT, 'activity', 1).heights.activity).toBe(400);
    expect(resizeRunSheetPanel({ ...DEFAULT_RUN_SHEET_LAYOUT, heights: { ...DEFAULT_RUN_SHEET_LAYOUT.heights, activity: 90 } }, 'activity', -1).heights.activity).toBe(90);
  });
});
