import { describe, expect, it } from 'vitest';
import { readPlanAcceptanceCriteria, restorePlanItems } from '../src/shared/plan-criteria';

describe('plan acceptance criteria restoration', () => {
  it('restores a missing plan snapshot from the latest turn and never resurrects a prior task plan', () => {
    const events = [
      { kind: 'plan', turnId: 'old-turn', items: [{ title: 'Old task plan' }] },
      { kind: 'plan', turnId: 'current-turn', items: [{ title: 'Current task plan' }] },
    ];
    expect(restorePlanItems(undefined, events, 'current-turn')).toEqual([{ title: 'Current task plan' }]);
    expect(restorePlanItems(undefined, events, 'missing-turn')).toEqual([]);
  });

  it('keeps an explicitly empty plan snapshot instead of restoring prior journal data', () => {
    expect(restorePlanItems([], [{ kind: 'plan', turnId: 'old', items: [{ title: 'Old plan' }] }], 'old')).toEqual([]);
  });

  it('restores criteria from the newest durable plan update', () => {
    expect(readPlanAcceptanceCriteria([
      { kind: 'plan', acceptanceCriteria: ['Old criterion'] },
      { kind: 'operation', acceptanceCriteria: ['not a plan'] },
      { kind: 'plan', acceptanceCriteria: ['Current criterion', 42, 'Another current criterion'] },
    ])).toEqual(['Current criterion', 'Another current criterion']);
  });

  it('honors an explicit empty starter snapshot so criteria do not leak from an older task', () => {
    expect(readPlanAcceptanceCriteria([
      { kind: 'plan', acceptanceCriteria: ['Prior task criterion'] },
      { kind: 'plan', source: 'workbench', acceptanceCriteria: [] },
    ])).toEqual([]);
  });

  it('does not invent criteria for older sessions', () => {
    expect(readPlanAcceptanceCriteria([{ kind: 'plan', items: [{ title: 'Build' }] }])).toEqual([]);
    expect(readPlanAcceptanceCriteria(null)).toEqual([]);
  });
});
