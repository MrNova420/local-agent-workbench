import { useState } from 'react';
import type { ActivityMode, ActivityRecord } from '../shared/protocol';

function ProgressiveText({ value }: { value: string }) {
  const [visible, setVisible] = useState(16_000);
  if (!value) return null;
  const shown = value.slice(0, visible);
  const remaining = value.length - shown.length;
  return <div className="activity-output-block"><pre>{shown}</pre>{remaining > 0 && <button className="activity-show-more" onClick={() => setVisible((count) => count + 16_000)}>Show next {Math.min(16_000, remaining).toLocaleString()} characters · {remaining.toLocaleString()} remaining</button>}</div>;
}

function ActivityCard({ row, expanded, surface }: { row: ActivityRecord; expanded: boolean; surface: 'chat' | 'sidebar' }) {
  const title = row.name?.replaceAll('_', ' ') || (row.kind === 'plan' ? 'Plan updated' : row.kind === 'approval' ? 'Action approval' : row.kind === 'context' ? 'Request context compacted' : 'Activity');
  const chatTitle = row.kind === 'operation' ? title.replace(/\bfile\b/gi, '').trim() : title;
  const firstFile = row.affectedFiles?.[0];
  const extraFiles = Math.max(0, (row.affectedFiles?.length || 0) - 1);
  const output = row.output || {};
  return <details className={`activity-card activity-${row.kind} activity-${row.status}`} open={expanded}>
    <summary className={`activity-summary activity-summary-${surface}`}>
      <span className={`activity-state-dot state-${row.status}`}/>
      {surface === 'chat' ? <>
        <span className="activity-chat-title">{chatTitle}</span>
        {firstFile && <code className="activity-chat-file">{firstFile}{extraFiles > 0 ? ` +${extraFiles}` : ''}</code>}
      </> : <strong>{title}</strong>}
      <span className="activity-status">{row.status.replaceAll('_', ' ')}</span>
      {row.approvalStatus && <span className={`activity-approval activity-approval-${row.approvalStatus}`}>approval {row.approvalStatus.replaceAll('_', ' ')}</span>}
      {surface === 'sidebar' && row.affectedFiles?.length ? <span className="activity-file-count">{row.affectedFiles.length} file{row.affectedFiles.length === 1 ? '' : 's'}</span> : null}
    </summary>
    <div className="activity-card-details">
      {row.affectedFiles?.length ? <div className="activity-files">{row.affectedFiles.map((file) => <code key={file}>{file}</code>)}</div> : null}
      {row.arguments !== undefined && <details className="activity-subdetails"><summary>Arguments</summary><ProgressiveText value={JSON.stringify(row.arguments, null, 2)}/></details>}
      {Object.entries(output).map(([stream, value]) => value ? <details className="activity-subdetails" key={stream}><summary>{stream} · {value.length.toLocaleString()} characters</summary><ProgressiveText value={value}/></details> : null)}
      {row.result ? <details className="activity-subdetails"><summary>Result · {row.result.length.toLocaleString()} characters</summary><ProgressiveText value={row.result}/></details> : null}
      {row.items?.map((item, index) => <div className="activity-plan-item" key={`${row.id}-${index}`}><b>{item.title || item.text || 'Work item'}</b><span>{item.status || 'pending'}</span></div>)}
      {row.kind === 'context' && <div className="activity-plan-item"><b>{row.omittedTurns || 0} earlier turn{row.omittedTurns === 1 ? '' : 's'} omitted from this inference request</b><span>{row.retainedTurns || 0} retained · {row.inputBudget?.toLocaleString() || '—'} input budget · {row.configuredContext?.toLocaleString() || '—'} configured context · checkpoint {row.checkpointIncluded ? `included (${row.checkpointEstimate?.toLocaleString() || 0} estimated tokens)` : 'not included'}</span></div>}
      {row.kind === 'approval' && <div className="activity-plan-item"><b>{String(row.arguments || '')}</b></div>}
      {row.startedAt && <time>{new Date(row.startedAt * 1000).toLocaleTimeString()}</time>}
    </div>
  </details>;
}

export function ActivityFeed({ entries, mode, surface }: { entries: ActivityRecord[]; mode: ActivityMode; surface: 'chat' | 'sidebar' }) {
  if (surface === 'chat' && mode === 'sidebar') return null;
  if (!entries.length) return surface === 'sidebar' ? <p className="sheet-empty">Reads, tool calls, and results will appear here as they happen.</p> : null;
  return <div className={`activity-feed activity-feed-${surface} activity-mode-${mode}`} aria-label={surface === 'chat' ? 'Agent activity in this conversation' : 'Activity trace'}>
    {entries.map((row) => <ActivityCard key={row.id} row={row} expanded={surface === 'chat' && mode === 'inline'} surface={surface}/>) }
  </div>;
}
