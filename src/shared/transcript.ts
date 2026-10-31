export type PersistedTranscriptRow = {
  role: string;
  content?: string;
  thinking?: unknown;
};

export type TranscriptMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
};

export function appendTranscriptSegment(previous: string, chunk: string, separatedByTool: boolean): string {
  if (!separatedByTool || !previous) return previous + chunk;
  const separator = previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n';
  return previous + separator + chunk;
}

export function restoreTranscriptMessages(rows: PersistedTranscriptRow[]): TranscriptMessage[] {
  return rows
    .filter((row) => (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string' && row.content.length > 0)
    .map((row) => ({
      role: row.role as TranscriptMessage['role'],
      content: row.content!,
      thinking: typeof row.thinking === 'string' ? row.thinking : undefined,
    }));
}
