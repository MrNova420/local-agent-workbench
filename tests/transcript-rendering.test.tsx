import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/renderer/Markdown';
import { appendTranscriptSegment, finalizeStreamingAssistantMessage, readExpandedReasoning, reconcileLiveAssistantMessage, restoreTranscriptMessages, writeExpandedReasoning } from '../src/shared/transcript';

describe('resumed transcript rendering', () => {
  it('retains the complete long reasoning buffer when revisiting a saved turn', () => {
    const reasoning = `begin:${'analysis-step '.repeat(2_500)}:end`;
    const restored = restoreTranscriptMessages([
      { role: 'assistant', content: 'Answer', thinking: reasoning },
      { role: 'assistant', content: 'A newer answer', thinking: 'newer reasoning' },
    ]);

    expect(restored[0].thinking).toBe(reasoning);
    expect(restored[0].thinking).toHaveLength(reasoning.length);
    expect(restored[0].thinking).toMatch(/^begin:/);
    expect(restored[0].thinking).toMatch(/:end$/);
  });

  it('restores reasoning disclosure choices per session without losing full transcript text', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    writeExpandedReasoning(storage, 'session-a', [2, 0, 2, -1]);

    expect([...readExpandedReasoning(storage, 'session-a')]).toEqual([0, 2]);
    expect([...readExpandedReasoning(storage, 'session-b')]).toEqual([]);
    expect([...readExpandedReasoning({ ...storage, getItem: () => '{broken' }, 'session-a')]).toEqual([]);
  });

  it('reconciles the active turn from a full snapshot without duplicating streamed text', () => {
    const rows = [
      { role: 'user' as const, content: 'Build the page', turnId: 'turn-1' },
      { role: 'assistant' as const, content: 'partial', turnId: 'turn-1', streaming: true },
    ];
    const reconciled = reconcileLiveAssistantMessage(rows, 'turn-1', { content: 'complete answer', thinking: 'planning' });
    expect(reconciled).toHaveLength(2);
    expect(reconciled[1]).toMatchObject({ content: 'complete answer', thinking: 'planning', turnId: 'turn-1', streaming: true });
    expect(rows[1].content).toBe('partial');
  });

  it('preserves a completed reasoning segment when a later provider request starts in the same turn', () => {
    const firstRequest = [{
      role: 'assistant' as const, content: '', thinking: 'First request reasoning stays visible.', turnId: 'turn-1', streaming: true,
    }];
    const finalized = finalizeStreamingAssistantMessage(firstRequest);
    const secondRequest = reconcileLiveAssistantMessage(finalized, 'turn-1', {
      content: 'The implementation is ready.', thinking: 'Second request reasoning.',
    });

    expect(secondRequest).toHaveLength(2);
    expect(secondRequest[0]).toMatchObject({ thinking: 'First request reasoning stays visible.', streaming: false });
    expect(secondRequest[1]).toMatchObject({ thinking: 'Second request reasoning.', content: 'The implementation is ready.', streaming: true });
  });

  it('separates assistant response segments that resume after a tool call', () => {
    expect(appendTranscriptSegment('I will inspect the project.', 'The files are ready.', true)).toBe('I will inspect the project.\n\nThe files are ready.');
    expect(appendTranscriptSegment('I will inspect the project.', ' continues.', false)).toBe('I will inspect the project. continues.');
    expect(appendTranscriptSegment('I will inspect the project.\n', 'The files are ready.', true)).toBe('I will inspect the project.\n\nThe files are ready.');
  });

  it('keeps saved Markdown and syntax-highlighted code renderable after session restore', () => {
    const savedContent = [
      '## Verification results',
      '',
      '- Session resumed',
      '- Workspace stayed isolated',
      '',
      '```javascript',
      'const answer = 42;',
      '```',
    ].join('\n');
    const restored = restoreTranscriptMessages([
      { role: 'system', content: 'internal prompt' },
      { role: 'assistant', content: savedContent, thinking: 'kept separately' },
      { role: 'tool', content: 'internal result' },
    ]);
    const markup = renderToStaticMarkup(createElement(Markdown, { content: restored[0].content }));

    expect(restored).toEqual([{ role: 'assistant', content: savedContent, thinking: 'kept separately' }]);
    expect(markup).toContain('<h2>Verification results</h2>');
    expect(markup).toContain('<li>Session resumed</li>');
    expect(markup).toContain('<li>Workspace stayed isolated</li>');
    expect(markup).toContain('class="hljs language-javascript"');
    expect(markup).toContain('class="hljs-keyword"');
  });

  it('restores provider-disconnected assistant text with an explicit partial marker', () => {
    const restored = restoreTranscriptMessages([
      { role: 'user', content: 'Implement this feature' },
      { role: 'assistant', content: 'I inspected the files.', thinking: 'Checking current behavior', partial_response: true },
    ]);

    expect(restored[1]).toMatchObject({ content: 'I inspected the files.', thinking: 'Checking current behavior', recoveredPartial: true });
  });

  it('restores reasoning-only assistant segments after an interrupted same-task redirect', () => {
    const restored = restoreTranscriptMessages([
      { role: 'user', content: 'Implement this feature' },
      { role: 'assistant', thinking: 'I inspected the project and found the relevant component.', partial_response: true, steering_interrupted: true },
      { role: 'user', content: 'Keep the existing layout', steering_id: 'update-1', steering_status: 'delivered' },
    ]);

    expect(restored).toHaveLength(3);
    expect(restored[1]).toMatchObject({ content: '', thinking: 'I inspected the project and found the relevant component.', recoveredPartial: true, steeringInterrupted: true });
  });

  it('does not shift restored activity links after a canceled turn without a transcript prompt', () => {
    const restored = restoreTranscriptMessages([
      { role: 'user', content: 'First saved task' },
      { role: 'assistant', content: 'First result' },
      { role: 'user', content: 'Second saved task' },
      { role: 'assistant', content: 'Second result' },
    ], [
      { turn_id: 'canceled-before-inference', transcript_saved: false },
      { turn_id: 'turn-one', transcript_saved: true },
      { turn_id: 'turn-two' },
    ]);

    expect(restored.filter((message) => message.role === 'user').map((message) => message.turnId)).toEqual(['turn-one', 'turn-two']);
  });

  it('restores same-turn steering without consuming a separate turn identity', () => {
    const restored = restoreTranscriptMessages([
      { role: 'user', content: 'Build the page' },
      { role: 'assistant', content: 'I am working.' },
      { role: 'user', content: 'Keep the current layout', turn_id: 'turn-one', steering_id: 'steer-one', steering_status: 'delivered' },
      { role: 'assistant', content: 'Done.' },
      { role: 'user', content: 'A separate follow-up' },
    ], [{ turn_id: 'turn-one' }, { turn_id: 'turn-two' }]);

    expect(restored.filter((message) => message.role === 'user').map((message) => message.turnId)).toEqual(['turn-one', 'turn-one', 'turn-two']);
    expect(restored[2]).toMatchObject({ steeringId: 'steer-one', steeringStatus: 'delivered' });
  });
});
