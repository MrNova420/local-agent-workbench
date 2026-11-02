import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyActivityEvent, mergeActivitySnapshot, shouldRefreshWorkspaceForActivity, type ActivityRecord } from '../src/shared/activity';
import { ActivityFeed } from '../src/renderer/ActivityFeed';

describe('durable live activity state', () => {
  it('reconciles a missed live-event snapshot without truncating full tool results', () => {
    const previous: ActivityRecord = { id: 'op-1', turnId: 'turn-1', sessionId: 'session-1', kind: 'operation',
      name: 'run_command', status: 'running', output: { stdout: 'partial' } };
    const completeOutput = 'full command result '.repeat(1200);
    const current = mergeActivitySnapshot([previous], [
      { ...previous, status: 'completed', result: completeOutput, output: { stdout: completeOutput } },
      { id: 'plan-1', turnId: 'turn-1', sessionId: 'session-1', kind: 'plan', status: 'updated',
        items: [{ title: 'Implement', status: 'in_progress' }] },
    ]);

    expect(current).toHaveLength(2);
    expect(current[0].status).toBe('completed');
    expect(current[0].output?.stdout).toBe(completeOutput);
    expect(current[1].kind).toBe('plan');
  });

  it('renders paused user questions and records their answer after resume', () => {
    const question = { id: 'q-1', questionId: 'q-1', turnId: 'turn-1', sessionId: 'session-1',
      kind: 'question' as const, title: 'Choose a framework', question: 'Which framework should I use?',
      options: [{ label: 'React', description: 'Use the existing ecosystem.' }], status: 'awaiting_user' };
    const waiting = renderToStaticMarkup(createElement(ActivityFeed, { entries: [question], mode: 'compact', surface: 'chat' }));
    expect(waiting).toContain('Which framework should I use?');
    expect(waiting).toContain('React');
    const answered = renderToStaticMarkup(createElement(ActivityFeed, { entries: [{ ...question, status: 'answered', answer: 'React' }], mode: 'compact', surface: 'sidebar' }));
    expect(answered).toContain('Answer:');
    expect(answered).toContain('React');
  });

  it('restores plan decisions and acceptance criteria in the activity card', () => {
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: [{
      id: 'plan-1', turnId: 'turn-1', sessionId: 'session-1', kind: 'plan', status: 'in_progress',
      items: [{ title: 'Implement the route', status: 'in_progress' }],
      decisions: ['Keep the existing router to preserve deep links.'],
      acceptanceCriteria: ['The route still works after reload.'],
    }], mode: 'compact', surface: 'sidebar' }));
    expect(markup).toContain('Recorded decisions');
    expect(markup).toContain('Keep the existing router to preserve deep links.');
    expect(markup).toContain('Acceptance criteria');
    expect(markup).toContain('The route still works after reload.');
  });

  it('shows exactly which checkpoint history categories were summarized', () => {
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: [{
      id: 'context-1', turnId: 'turn-1', sessionId: 'session-1', kind: 'context', status: 'compacted',
      checkpointIncluded: true, checkpointEstimate: 380, checkpointCompacted: true,
      checkpointOmissions: { operations: 18, user_updates: 7 },
    }], mode: 'sidebar', surface: 'sidebar' }));
    expect(markup).toContain('Checkpoint history summarized');
    expect(markup).toContain('operations 18');
    expect(markup).toContain('user updates 7');
  });
  it('renders resumable tool preparation without exposing partial arguments', () => {
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: [{
      id: 'tool-call:turn-1:0:0', turnId: 'turn-1', sessionId: 'session-1', kind: 'tool_preparation',
      name: 'write_file', status: 'preparing', provider: 'ollama', requestIndex: 0, callIndex: 0,
      argumentCharacters: 512,
    }], mode: 'compact', surface: 'chat' }));
    expect(markup).toContain('Model is preparing a structured tool call');
    expect(markup).toContain('512 argument characters');
    expect(markup).not.toContain('arguments-preview');
    const assembled = renderToStaticMarkup(createElement(ActivityFeed, { entries: [{
      id: 'tool-call:turn-1:0:0', turnId: 'turn-1', sessionId: 'session-1', kind: 'tool_preparation',
      name: 'write_file', status: 'assembled', provider: 'ollama', requestIndex: 0, callIndex: 0,
      argumentCharacters: 512,
    }], mode: 'compact', surface: 'chat' }));
    expect(assembled).toContain('Complete structured call received');
  });
  it('progressively renders long activity histories without discarding older records', () => {
    const entries: ActivityRecord[] = Array.from({ length: 245 }, (_, index) => ({
      id: `activity-${index}`, sessionId: 'session-long', turnId: 'turn-long', kind: 'operation',
      name: `operation_${index}`, status: 'completed',
    }));
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries, mode: 'compact', surface: 'sidebar' }));
    expect(markup).toContain('245 total');
    expect(markup).toContain('Load earlier activity');
    expect(markup).toContain('operation 244');
    expect(markup).not.toContain('operation 0');
    expect(entries).toHaveLength(245);
  });

  it('refreshes the project file view after completed or uncertain mutations and commands', () => {
    const base: ActivityRecord = {
      id: 'op', operationId: 'op', sessionId: 's', turnId: 't', kind: 'operation', status: 'completed',
    };
    expect(shouldRefreshWorkspaceForActivity({ ...base, name: 'write_file' })).toBe(true);
    expect(shouldRefreshWorkspaceForActivity({ ...base, name: 'run_command' })).toBe(true);
    expect(shouldRefreshWorkspaceForActivity({ ...base, name: 'mcp__disk__write', affectedFiles: ['out.txt'] })).toBe(true);
    expect(shouldRefreshWorkspaceForActivity({ ...base, name: 'read_file' })).toBe(false);
    expect(shouldRefreshWorkspaceForActivity({ ...base, name: 'write_file', status: 'running' })).toBe(false);
  });

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

  it('keeps plan acceptance criteria in durable activity and honors an empty new-task snapshot', () => {
    const first = applyActivityEvent([], { type: 'activity_event', activity: {
      id: 'plan-1', sessionId: 's', turnId: 't1', kind: 'plan', status: 'updated',
      items: [{ title: 'Build', status: 'in_progress' }], acceptanceCriteria: ['The page renders.'],
    } });
    const next = applyActivityEvent(first, { type: 'activity_event', activity: {
      id: 'plan-2', sessionId: 's', turnId: 't2', kind: 'plan', status: 'updated',
      source: 'workbench', items: [], acceptanceCriteria: [],
    } });

    expect(first[0].acceptanceCriteria).toEqual(['The page renders.']);
    expect(next[1].acceptanceCriteria).toEqual([]);
  });

  it('keeps approval state on the operation row instead of rendering a duplicate action', () => {
    const operation: ActivityRecord = {
      id: 'op-1', operationId: 'op-1', sessionId: 's-1', turnId: 't-1', kind: 'operation',
      name: 'write_file', status: 'running', arguments: { path: 'index.html' },
    };
    const started = applyActivityEvent([], { type: 'activity_event', activity: operation });
    const waiting = applyActivityEvent(started, {
      type: 'activity_event', activity: { ...operation, approvalStatus: 'waiting', approvalMode: 'per-action' },
    });
    const approved = applyActivityEvent(waiting, {
      type: 'activity_event', activity: { ...operation, approvalStatus: 'approved', approvalMode: 'per-action' },
    });
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: approved, mode: 'compact', surface: 'chat' }));

    expect(approved).toHaveLength(1);
    expect(approved[0].approvalStatus).toBe('approved');
    expect(markup).toContain('approval approved');
    expect(markup.match(/<details class="activity-card/g)).toHaveLength(1);
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

  it('renders durable prompt provenance and exact included skill names in the activity trace', () => {
    const record: ActivityRecord = {
      id: 'task-request-1', sessionId: 's-1', turnId: 't-1', kind: 'prompt', name: 'Model request 1', status: 'sent',
      promptManifest: {
        request_index: 1, configured_context: 65536, maximum_output_tokens: 8192,
        input_budget: 57344, estimated_request_input_tokens: 4096, message_count: 2,
        checkpoint_included: true, compaction_notice_count: 1,
        messages: [{ index: 0, role: 'system', source: 'task_checkpoint', characters: 900, estimated_tokens: 450, retrieved_files: [] }],
        project_instruction_sources: [{ path: 'AGENTS.md', characters: 20, estimated_tokens: 10 }], retrieved_project_files: ['src/App.tsx'],
        skills: { enabled: true, selected_sources: ['project'], available: [{ name: 'react-review', source: 'project' }],
          catalog_entries_in_request_tool_schema: ['react-review'], load_references_in_request_history: [] },
        tools: [{ name: 'read_file', provider: 'workbench' }],
        workflow: { harness_profile: 'small-model', task_intent: 'implement', effective_access: 'ask' },
      },
    };
    const trace = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'sidebar', surface: 'sidebar' }));

    expect(trace).toContain('Model request 1');
    expect(trace).toContain('AGENTS.md');
    expect(trace).toContain('src/App.tsx');
    expect(trace).toContain('react-review');
    expect(trace).toContain('small-model');
    expect(trace).toContain('4,096');
  });

  it('distinguishes saved provider request settings from prompt estimates and shows omitted reasoning overrides', () => {
    const record: ActivityRecord = {
      id: 'request-1', sessionId: 's-1', turnId: 't-1', kind: 'prompt', name: 'Model request 1', status: 'sent',
      promptManifest: { request_index: 1, configured_context: 65536, maximum_output_tokens: 8192, messages: [] },
      providerRequest: {
        provider: 'ollama', model: 'ornith:latest', request_api: '/api/chat', request_index: 1,
        dispatch_status: 'response_stream_ended', provider_done: true,
        requested_context: 65536, max_output_tokens: 8192, reasoning_override: 'high',
        reasoning_field_sent: false, keep_alive: '30m', request_options: { num_ctx: 65536, num_predict: 8192 }, additional_fields: {},
        estimated_input_tokens: 4096,
      },
      providerUsage: { prompt_eval_count: 4096, prompt_eval_cached_count: 2048, eval_count: 212, eval_duration: 30_000_000_000 },
    };
    const trace = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'sidebar', surface: 'sidebar' }));

    expect(trace).toContain('Provider request settings and dispatch');
    expect(trace).toContain('Response stream ended');
    expect(trace).toContain('ollama');
    expect(trace).toContain('ornith:latest');
    expect(trace).toContain('Reasoning override');
    expect(trace).toContain('provider/model default');
    expect(trace).toContain('65536');
    expect(trace).toContain('8192');
    expect(trace).toContain('30m');
    expect(trace).toContain('num_predict');
    expect(trace).toContain('Additional request fields');
    expect(trace).toContain('<pre class="prompt-request-options">{}</pre>');
    expect(trace).toContain('Provider returned usage');
    expect(trace).toContain('Cached prompt tokens');
    expect(trace).toContain('2,048');
    expect(trace).toContain('30.00 s');
    const conflictTrace = renderToStaticMarkup(createElement(ActivityFeed, { entries: [{ ...record,
      providerRequest: { ...record.providerRequest, additional_fields: { ignored_runtime_option_overrides: { num_ctx: 8192, num_predict: 500 } } },
    }], mode: 'sidebar', surface: 'sidebar' }));
    expect(conflictTrace).toContain('Runtime options tried to override controls owned by this run');
    expect(conflictTrace).toContain('num_ctx');
    const waiting = renderToStaticMarkup(createElement(ActivityFeed, { entries: [{ ...record, status: 'awaiting_response_headers',
      providerRequest: { ...record.providerRequest, dispatch_status: 'awaiting_response_headers' } }], mode: 'sidebar', surface: 'sidebar' }));
    expect(waiting).toContain('waiting for response headers');
    expect(waiting).toContain('Cancel interrupts this request');
  });

  it('labels capped tool scans as partial rather than complete in activity views', () => {
    const record: ActivityRecord = {
      id: 'scan-1', sessionId: 's-1', turnId: 't-1', kind: 'operation', name: 'search_files',
      status: 'partial', result: 'Some results were returned; the scan may be incomplete.',
    };
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'compact', surface: 'sidebar' }));
    expect(markup).toContain('activity-partial');
    expect(markup).toContain('state-partial');
    expect(markup).toContain('partial');
  });

  it('shows an inspect-before-retry warning for uncertain operations while collapsed', () => {
    const record: ActivityRecord = {
      id: 'mcp-uncertain', sessionId: 's-1', turnId: 't-1', kind: 'operation',
      name: 'mcp_calendar_create_event', status: 'uncertain', result: 'The server may have applied the action.',
    };
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'compact', surface: 'chat' }));
    expect(markup).toContain('inspect before retry');
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

  it('shows within-task exchange omissions in the persisted compaction event', () => {
    const record: ActivityRecord = {
      id: 'compact-1', sessionId: 's-1', turnId: 't-1', kind: 'context', status: 'compacted',
      omittedTurns: 0, omittedOperationGroups: 6, retainedTurns: 1, inputBudget: 57_344,
      configuredContext: 65_536, checkpointIncluded: true, checkpointEstimate: 800,
    };
    const markup = renderToStaticMarkup(createElement(ActivityFeed, { entries: [record], mode: 'sidebar', surface: 'sidebar' }));
    expect(markup).toContain('0 earlier turns and 6 in-task exchange groups omitted');
    expect(markup).toContain('57,344 input budget');
  });
});
