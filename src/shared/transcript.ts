export type PersistedTranscriptRow = {
  role: string;
  content?: string;
  thinking?: unknown;
  turn_id?: string;
  steering_id?: string;
  steering_status?: 'pending' | 'interrupting' | 'delivered' | 'undelivered';
  partial_response?: boolean;
  steering_interrupted?: boolean;
};

export type PersistedTranscriptTurn = { turn_id?: string; transcript_saved?: boolean };

export type TranscriptMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  turnId?: string;
  steeringId?: string;
  steeringStatus?: 'pending' | 'interrupting' | 'delivered' | 'undelivered';
  recoveredPartial?: boolean;
  steeringInterrupted?: boolean;
};

export function appendTranscriptSegment(previous: string, chunk: string, separatedByTool: boolean): string {
  if (!separatedByTool || !previous) return previous + chunk;
  const separator = previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n';
  return previous + separator + chunk;
}

/** Seal the previous provider request's assistant row before a new request starts. */
export function finalizeStreamingAssistantMessage<T extends LiveTranscriptMessage>(messages: T[]): T[] {
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant' || !last.streaming) return messages;
  return [...messages.slice(0, -1), { ...last, streaming: false } as T];
}

export function restoreTranscriptMessages(rows: PersistedTranscriptRow[], turns: PersistedTranscriptTurn[] = []): TranscriptMessage[] {
  const savedTurns = turns.filter((turn) => turn.transcript_saved !== false);
  let userTurnIndex = 0;
  const restored: TranscriptMessage[] = [];
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const content = typeof row.content === 'string' ? row.content : '';
    const hasThinking = typeof row.thinking === 'string' && row.thinking.length > 0;
    if ((row.role === 'user' && content.length === 0)
        || (row.role === 'assistant' && content.length === 0 && !hasThinking)) continue;
    const explicitTurnId = typeof row.turn_id === 'string' ? row.turn_id : undefined;
    const turnId = row.role === 'user' ? explicitTurnId || savedTurns[userTurnIndex++]?.turn_id : undefined;
    const steeringId = typeof row.steering_id === 'string' ? row.steering_id : undefined;
    const steeringStatus = row.steering_status === 'pending' || row.steering_status === 'interrupting' || row.steering_status === 'undelivered' ? row.steering_status : steeringId ? 'delivered' : undefined;
    restored.push({
      role: row.role,
      content,
      thinking: typeof row.thinking === 'string' ? row.thinking : undefined,
      turnId,
      ...(steeringId ? { steeringId } : {}),
      ...(steeringStatus ? { steeringStatus } : {}),
      ...(row.role === 'assistant' && row.partial_response === true ? { recoveredPartial: true } : {}),
      ...(row.role === 'assistant' && row.steering_interrupted === true ? { steeringInterrupted: true } : {}),
    });
  }
  return restored;
}

export type LiveTranscriptMessage = TranscriptMessage & { streaming?: boolean; recoveredPartial?: boolean };

/** Replace the active turn's partial assistant row with the sidecar's authoritative full buffer. */
export function reconcileLiveAssistantMessage(
  messages: LiveTranscriptMessage[], turnId: string, live: { content: string; thinking: string },
): LiveTranscriptMessage[] {
  if (!turnId) return messages;
  let exact = -1;
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor].role === 'assistant' && messages[cursor].turnId === turnId && messages[cursor].streaming) { exact = cursor; break; }
  }
  const index = exact >= 0 ? exact : messages.at(-1)?.role === 'assistant' && messages.at(-1)?.streaming ? messages.length - 1 : -1;
  const next = messages.slice();
  const replacement: LiveTranscriptMessage = {
    role: 'assistant', content: live.content, thinking: live.thinking || undefined, turnId, streaming: true,
  };
  if (index < 0) next.push(replacement);
  else next[index] = { ...next[index], ...replacement };
  return next;
}
