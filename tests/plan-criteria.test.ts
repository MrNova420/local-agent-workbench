import { describe, expect, it } from 'vitest';
import { readPlanAcceptanceCriteria } from '../src/shared/plan-criteria';

describe('plan acceptance criteria restoration', () => {
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
