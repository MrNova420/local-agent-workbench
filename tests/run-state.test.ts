import { describe, expect, it } from 'vitest';
import { nextRunPhase, restoredRunPhase, runStepProgress } from '../src/shared/run-state';

describe('run status transitions', () => {
  it.each([
    ['Ready', false, 0],
    ['Waiting for first token', true, 1],
    ['Reasoning', true, 2],
    ['Generating', true, 2],
    ['Finishing turn', true, 3],
    ['Turn complete', false, 4],
    ['Run failed', false, 3],
    ['Cancelled', false, 3],
  ])('maps %s to phase rail progress %i', (phase, running, expected) => {
    expect(runStepProgress(phase, running)).toBe(expected);
  });

  it.each([
    ['completed', 'Turn complete'],
    ['failed', 'Run failed'],
    ['cancelled', 'Cancelled'],
    ['stopped', 'Stopped after active operation'],
    ['interrupted', 'Interrupted · recovery required'],
    ['unknown', 'Ready'],
  ])('restores a saved %s outcome as %s', (status, expected) => {
    expect(restoredRunPhase(status)).toBe(expected);
  });

  it('shows first-token wait and generation as separate phases', () => {
    expect(nextRunPhase('Ready', { type: 'phase', phase: 'waiting' })).toBe('Waiting for first token');
    expect(nextRunPhase('Waiting for first token', { type: 'phase', phase: 'reasoning' })).toBe('Reasoning');
    expect(nextRunPhase('Waiting for first token', { type: 'phase', phase: 'generating' })).toBe('Generating');
    expect(nextRunPhase('Reasoning', { type: 'phase', phase: 'generating' })).toBe('Generating');
  });

  it('holds completion until the turn has been saved and the worker goes idle', () => {
    expect(nextRunPhase('Generating', { type: 'generation_complete' })).toBe('Finishing turn');
    expect(nextRunPhase('Finishing turn', { type: 'run_idle' })).toBe('Turn complete');
  });

  it('preserves cancelled and failed end states on the subsequent idle event', () => {
    expect(nextRunPhase('Generating', { type: 'cancelled' })).toBe('Cancelled');
    expect(nextRunPhase('Cancelled', { type: 'run_idle' })).toBe('Cancelled');
    expect(nextRunPhase('Waiting', { type: 'error' })).toBe('Run failed');
  });

  it('marks a lost sidecar during generation as interrupted and requiring recovery', () => {
    expect(nextRunPhase('Generating', { type: 'service_exit' })).toBe('Interrupted · recovery required');
    expect(nextRunPhase('Reasoning', { type: 'service_exit' })).toBe('Interrupted · recovery required');
    expect(nextRunPhase('Ready', { type: 'service_exit' })).toBe('Ready');
  });
});
