export const RUN_SHEET_PANELS = ['signals', 'plan', 'activity', 'resources'] as const;
export type RunSheetPanel = typeof RUN_SHEET_PANELS[number];
export type RunSheetLayout = { order: RunSheetPanel[]; heights: Record<RunSheetPanel, number> };

export const DEFAULT_RUN_SHEET_LAYOUT: RunSheetLayout = {
  order: [...RUN_SHEET_PANELS],
  heights: { signals: 420, plan: 138, activity: 280, resources: 190 },
};

export function normalizeRunSheetLayout(value: unknown): RunSheetLayout {
  const source = value && typeof value === 'object' ? value as Partial<RunSheetLayout> : {};
  const requested = Array.isArray(source.order) ? source.order : [];
  const order = [...new Set(requested.filter((id): id is RunSheetPanel => RUN_SHEET_PANELS.includes(id as RunSheetPanel)))];
  for (const id of RUN_SHEET_PANELS) if (!order.includes(id)) order.push(id);
  const rawHeights: Partial<Record<RunSheetPanel, unknown>> = source.heights && typeof source.heights === 'object'
    ? source.heights as Partial<Record<RunSheetPanel, unknown>>
    : {};
  const heights = { ...DEFAULT_RUN_SHEET_LAYOUT.heights };
  for (const id of RUN_SHEET_PANELS) {
    const size = rawHeights[id];
    if (typeof size === 'number' && Number.isFinite(size)) heights[id] = Math.max(90, Math.min(520, Math.round(size)));
  }
  return { order, heights };
}

export function moveRunSheetPanel(layout: RunSheetLayout, panel: RunSheetPanel, direction: -1 | 1): RunSheetLayout {
  const index = layout.order.indexOf(panel);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...layout, order };
}

export function resizeRunSheetPanel(layout: RunSheetLayout, panel: RunSheetPanel, delta: -1 | 1): RunSheetLayout {
  const current = layout.heights[panel];
  const next = Math.max(90, Math.min(520, current + delta * 40));
  return next === current ? layout : { ...layout, heights: { ...layout.heights, [panel]: next } };
}
