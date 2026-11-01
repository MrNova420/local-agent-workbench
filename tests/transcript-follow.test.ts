import { describe, expect, it } from 'vitest';
import { isNearTranscriptEnd } from '../src/shared/transcript-follow';

describe('streaming transcript follow behavior', () => {
  it('follows newly generated content only when the reader is already at the end', () => {
    expect(isNearTranscriptEnd({ scrollHeight: 1200, scrollTop: 1080, clientHeight: 100 })).toBe(true);
    expect(isNearTranscriptEnd({ scrollHeight: 1200, scrollTop: 700, clientHeight: 100 })).toBe(false);
  });
});
