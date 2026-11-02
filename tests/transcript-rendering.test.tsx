import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/renderer/Markdown';
import { appendTranscriptSegment, reconcileLiveAssistantMessage, restoreTranscriptMessages } from '../src/shared/transcript';

describe('resumed transcript rendering', () => {
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
