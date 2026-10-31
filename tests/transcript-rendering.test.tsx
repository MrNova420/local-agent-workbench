import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/renderer/Markdown';
import { restoreTranscriptMessages } from '../src/shared/transcript';

describe('resumed transcript rendering', () => {
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
});
