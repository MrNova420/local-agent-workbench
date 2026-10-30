import { describe, expect, it } from 'vitest';
import { nextRunPhase } from '../src/shared/run-state';

describe('run status transitions', () => {
  it('shows first-token wait and generation as separate phases', () => {
    expect(nextRunPhase('Ready', { type: 'phase', phase: 'waiting' })).toBe('Waiting for first token');
    expect(nextRunPhase('Waiting for first token', { type: 'phase', phase: 'generating' })).toBe('Generating');
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
});
