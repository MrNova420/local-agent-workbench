export type PersistedTranscriptRow = {
  role: string;
  content?: string;
  thinking?: unknown;
};

export type PersistedTranscriptTurn = { turn_id?: string; transcript_saved?: boolean };

export type TranscriptMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  turnId?: string;
};

export function appendTranscriptSegment(previous: string, chunk: string, separatedByTool: boolean): string {
  if (!separatedByTool || !previous) return previous + chunk;
  const separator = previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n';
  return previous + separator + chunk;
}

export function restoreTranscriptMessages(rows: PersistedTranscriptRow[], turns: PersistedTranscriptTurn[] = []): TranscriptMessage[] {
  const savedTurns = turns.filter((turn) => turn.transcript_saved !== false);
  let userTurnIndex = 0;
  const restored: TranscriptMessage[] = [];
  for (const row of rows) {
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string' || row.content.length === 0) continue;
    const turnId = row.role === 'user' ? savedTurns[userTurnIndex++]?.turn_id : undefined;
    restored.push({
      role: row.role,
      content: row.content,
      thinking: typeof row.thinking === 'string' ? row.thinking : undefined,
      turnId,
    });
  }
  return restored;
}
