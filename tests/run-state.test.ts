import { describe, expect, it } from 'vitest';
import { applyToolCallProgress, canSubmitActiveRunUpdate, clearSubmittedPrompt, isGlobalRunLifecycleEvent, latestActiveActivityForTurn, nextRunPhase, reconcileQueuedPromptSnapshot, restoredRunPhase, runStepProgress, shouldApplySessionEvent, shouldQueuePromptOnEnter } from '../src/shared/run-state';
import type { ActivityRecord, QueuedPrompt } from '../src/shared/protocol';

describe('session event isolation', () => {
  it('rejects events from a previous or unselected session while allowing unscoped service events', () => {
    expect(shouldApplySessionEvent('session-a', 'session-a')).toBe(true);
    expect(shouldApplySessionEvent('session-a', 'session-b')).toBe(false);
    expect(shouldApplySessionEvent('session-a', '')).toBe(false);
    expect(shouldApplySessionEvent(undefined, 'session-b')).toBe(true);
  });

  it('keeps app-wide run lifecycle updates separate from session transcript events', () => {
    expect(isGlobalRunLifecycleEvent({ type: 'run_started', sessionId: 'session-a' })).toBe(true);
    expect(isGlobalRunLifecycleEvent({ type: 'run_idle', sessionId: 'session-a' })).toBe(true);
    expect(isGlobalRunLifecycleEvent({ type: 'activity_event', sessionId: 'session-a' })).toBe(false);
  });
});

describe('active-run composer actions', () => {
  it('accepts steering and queue actions only after the sidecar accepts the run', () => {
    expect(canSubmitActiveRunUpdate(false, false)).toBe(false);
    expect(canSubmitActiveRunUpdate(true, true)).toBe(false);
    expect(canSubmitActiveRunUpdate(true, false)).toBe(true);
  });

  it('clears only the draft that was submitted, preserving newer text typed while the request was pending', () => {
    expect(clearSubmittedPrompt('the submitted update', 'the submitted update')).toBe('');
    expect(clearSubmittedPrompt('a newer follow-up', 'the submitted update')).toBe('a newer follow-up');
  });
});

describe('queued follow-up recovery', () => {
  const queued = (id: string): QueuedPrompt => ({ id, prompt: `Prompt ${id}`, queued_at: 1 });

  it('replaces a failed start session queue from the same captured session and ignores late updates for another session', () => {
    const current = { session_id: 'session-a', queued_prompts: [queued('stale')] };
    expect(reconcileQueuedPromptSnapshot(current, 'session-a', [])).toEqual({ session_id: 'session-a', queued_prompts: [] });
    expect(reconcileQueuedPromptSnapshot(current, 'session-b', [queued('other')])).toBe(current);
    expect(reconcileQueuedPromptSnapshot(null, 'session-a', [])).toBeNull();
  });
});

describe('live activity selection', () => {
  const activity = (overrides: Partial<ActivityRecord>): ActivityRecord => ({
    id: 'activity', turnId: 'turn-1', sessionId: 'session-1', kind: 'operation', name: 'write_file',
    status: 'completed', ...overrides,
  });

  it('does not let completed activity mask the current inference phase', () => {
    expect(latestActiveActivityForTurn([activity({ status: 'completed' })], 'turn-1')).toBeUndefined();
    expect(latestActiveActivityForTurn([
      activity({ status: 'running', name: 'read_file' }),
      activity({ id: 'done', status: 'completed', name: 'write_file' }),
    ], 'turn-1')?.name).toBe('read_file');
  });

  it('keeps only pending tool preparation, approval, and user questions active', () => {
    expect(latestActiveActivityForTurn([activity({ kind: 'tool_preparation', status: 'assembled' })], 'turn-1')).toBeUndefined();
    expect(latestActiveActivityForTurn([activity({ kind: 'tool_preparation', status: 'preparing' })], 'turn-1')?.kind).toBe('tool_preparation');
    expect(latestActiveActivityForTurn([activity({ kind: 'approval', status: 'waiting', approvalStatus: 'waiting' })], 'turn-1')?.approvalStatus).toBe('waiting');
    expect(latestActiveActivityForTurn([activity({ kind: 'question', status: 'awaiting_user' })], 'turn-1')?.kind).toBe('question');
  });
});

describe('streamed tool-call preview', () => {
  it('updates one request preview by index without exposing partial arguments', () => {
    const first = applyToolCallProgress([], { type: 'tool_call_progress', provider: 'ollama', request_index: 2,
      call_index: 0, tool_name: 'write_file', argument_characters: 320 });
    const next = applyToolCallProgress(first, { type: 'tool_call_progress', provider: 'ollama', request_index: 2,
      call_index: 0, tool_name: 'write_file', argument_characters: 640, arguments_preview: 'secret or partial file data' });

    expect(next).toHaveLength(1);
    expect(next[0].argumentCharacters).toBe(640);
    expect(next[0]).not.toHaveProperty('arguments_preview');
    expect(applyToolCallProgress(next, { type: 'tool_call_progress', provider: 'ollama', request_index: 2,
      call_index: 1, tool_name: 'read_file', argument_characters: 15 })).toHaveLength(2);
    expect(applyToolCallProgress(next, { type: 'text', text: 'no change' })).toEqual(next);
  });
});

describe('run status transitions', () => {
  it('queues follow-ups on Enter without swallowing newlines or IME composition', () => {
    expect(shouldQueuePromptOnEnter('Enter', false, false)).toBe(true);
    expect(shouldQueuePromptOnEnter('Enter', true, false)).toBe(false);
    expect(shouldQueuePromptOnEnter('Enter', false, true)).toBe(false);
    expect(shouldQueuePromptOnEnter('Escape', false, false)).toBe(false);
  });
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

  it('restores the live inference phase when reattaching to a running session', () => {
    expect(restoredRunPhase('running', 'waiting_response_headers')).toBe('Waiting for response headers');
    expect(restoredRunPhase('running', 'waiting')).toBe('Waiting for first token');
    expect(restoredRunPhase('running', 'reasoning')).toBe('Reasoning');
    expect(restoredRunPhase('running', 'generating')).toBe('Generating');
    expect(restoredRunPhase('running', 'processing_response')).toBe('Processing response');
    expect(restoredRunPhase('running', 'applying_steering')).toBe('Applying your update');
    expect(restoredRunPhase('running', 'continuing')).toBe('Continuing task');
    expect(restoredRunPhase('running', 'steering_interrupted')).toBe('Applying your update');
  });

  it('shows first-token wait and generation as separate phases', () => {
    expect(nextRunPhase('Ready', { type: 'phase', phase: 'waiting' })).toBe('Waiting for first token');
    expect(nextRunPhase('Waiting for first token', { type: 'phase', phase: 'reasoning' })).toBe('Reasoning');
    expect(nextRunPhase('Waiting for first token', { type: 'phase', phase: 'generating' })).toBe('Generating');
    expect(nextRunPhase('Reasoning', { type: 'phase', phase: 'generating' })).toBe('Generating');
  });

  it('shows transport header wait separately from model prefill and generation', () => {
    expect(nextRunPhase('Ready', { type: 'request_dispatched' })).toBe('Waiting for response headers');
    expect(nextRunPhase('Waiting for response headers', { type: 'request_headers' })).toBe('Waiting for first token');
    expect(nextRunPhase('Generating', { type: 'request_complete' })).toBe('Processing response');
    expect(nextRunPhase('Waiting for response headers', { type: 'request_error', cancelled: true })).toBe('Cancelling request');
    expect(nextRunPhase('Reasoning', { type: 'request_error', cancelled: true, interrupted_by_steering: true })).toBe('Applying your update');
    expect(runStepProgress('Processing response', true)).toBe(2);
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
