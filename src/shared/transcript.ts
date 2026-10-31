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

export function restoreTranscriptMessages(rows: PersistedTranscriptRow[]): TranscriptMessage[] {
  return rows
    .filter((row) => (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string' && row.content.length > 0)
    .map((row) => ({
      role: row.role as TranscriptMessage['role'],
      content: row.content!,
      thinking: typeof row.thinking === 'string' ? row.thinking : undefined,
    }));
}
