import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyActivityEvent, type ActivityRecord } from '../src/shared/activity';
import { ActivityFeed } from '../src/renderer/ActivityFeed';

describe('durable live activity state', () => {
  it('merges streamed chunks and completion by operation identity without dropping output', () => {
    const started: ActivityRecord = {
      id: 'op-1', operationId: 'op-1', sessionId: 's-1', turnId: 't-1', kind: 'operation',
      name: 'run_command', status: 'running', startedAt: 1, output: { stdout: '' }, result: '', affectedFiles: [],
    };
    const initial = applyActivityEvent([], { type: 'activity_event', activity: started });
    const streamed = applyActivityEvent(initial, {
      type: 'activity_event', activity: null, activityPhase: 'progress', activityId: 'op-1',
      stream: 'stdout', chunk: '雪'.repeat(20_000),
    });
    const completed = applyActivityEvent(streamed, {
      type: 'activity_event', activity: { ...started, status: 'completed', result: 'complete'.repeat(3000), completedAt: 2 },
    });

    expect(completed).toHaveLength(1);
    expect(completed[0].output?.stdout).toHaveLength(20_000);
    expect(completed[0].result).toBe('complete'.repeat(3000));
    expect(completed[0].status).toBe('completed');
  });

  it('updates a restored activity record in place and preserves chronological order', () => {
    const older = { id: 'old', sessionId: 's', turnId: 't', kind: 'plan' as const, status: 'updated', timestamp: 1 };
    const current = { id: 'current', sessionId: 's', turnId: 't', kind: 'operation' as const, status: 'running', timestamp: 2 };
    const updated = applyActivityEvent([older, current], {
      type: 'activity_event', activity: { ...current, status: 'completed', result: 'ok' },
    });
    expect(updated.map((row) => row.id)).toEqual(['old', 'current']);
    expect(updated[1].result).toBe('ok');
  });

  it('renders compact, sidebar-only, and inline modes from the same activity records', () => {
    const record: ActivityRecord = {
      id: 'op-1', sessionId: 's-1', turnId: 't-1', kind: 'operation', name: 'run_command',
      status: 'completed', result: 'done',
    };
    const compact = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'compact', surface: 'chat' }));
    const sidebar = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'sidebar', surface: 'chat' }));
    const inline = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'inline', surface: 'chat' }));
    const trace = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'sidebar', surface: 'sidebar' }));

    expect(compact).toContain('run command');
    expect(compact).not.toMatch(/<details[^>]*open/);
    expect(sidebar).toBe('');
    expect(inline).toMatch(/<details[^>]*open/);
    expect(trace).toContain('run command');
  });

  it('progressively reveals long output without discarding the remainder', () => {
    const record: ActivityRecord = {
      id: 'op-large', sessionId: 's-1', turnId: 't-1', kind: 'operation', name: 'run_command',
      status: 'completed', result: 'x'.repeat(40_000),
    };
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'inline', surface: 'chat' }));
    expect(markup).toContain('Show next 16,000 characters');
    expect(markup).toContain('24,000 remaining');
  });
});
