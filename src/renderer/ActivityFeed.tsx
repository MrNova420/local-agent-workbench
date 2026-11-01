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
  const title = row.name?.replaceAll('_', ' ') || (row.kind === 'plan' ? 'Plan updated' : row.kind === 'approval' ? 'Action approval' : row.kind === 'context' ? 'Request context compacted' : row.kind === 'prompt' ? 'Model prompt sources' : 'Activity');
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
      {row.kind === 'prompt' && <PromptManifestDetails manifest={row.promptManifest || {}}/>}
      {row.kind === 'approval' && <div className="activity-plan-item"><b>{String(row.arguments || '')}</b></div>}
      {row.startedAt && <time>{new Date(row.startedAt * 1000).toLocaleTimeString()}</time>}
    </div>
  </details>;
}

function PromptManifestDetails({ manifest }: { manifest: Record<string, unknown> }) {
  const messages = Array.isArray(manifest.messages) ? manifest.messages as Array<Record<string, unknown>> : [];
  const instructions = Array.isArray(manifest.project_instruction_sources) ? manifest.project_instruction_sources as Array<Record<string, unknown>> : [];
  const retrieved = Array.isArray(manifest.retrieved_project_files) ? manifest.retrieved_project_files.map(String) : [];
  const tools = Array.isArray(manifest.tools) ? manifest.tools as Array<Record<string, unknown>> : [];
  const skills = manifest.skills && typeof manifest.skills === 'object' ? manifest.skills as Record<string, unknown> : {};
  const availableSkills = Array.isArray(skills.available) ? skills.available as Array<Record<string, unknown>> : [];
  const catalogSkills = Array.isArray(skills.catalog_entries_in_request_tool_schema) ? skills.catalog_entries_in_request_tool_schema.map(String) : [];
  const skillReferences = Array.isArray(skills.load_references_in_request_history) ? skills.load_references_in_request_history as Array<Record<string, unknown>> : [];
  const workflow = manifest.workflow && typeof manifest.workflow === 'object' ? manifest.workflow as Record<string, unknown> : {};
  return <div className="prompt-manifest-details">
    <p>This is a source and size record for the request sent to the selected runtime. Prompt text is not duplicated in the journal.</p>
    <div className="prompt-manifest-stats"><span>Request <b>{String(manifest.request_index ?? '—')}</b></span><span>Input estimate <b>{Number(manifest.estimated_request_input_tokens || 0).toLocaleString()}</b></span><span>Budget <b>{Number(manifest.input_budget || 0).toLocaleString()}</b></span><span>Context <b>{Number(manifest.configured_context || 0).toLocaleString()}</b></span><span>Output <b>{Number(manifest.maximum_output_tokens || 0).toLocaleString()}</b></span><span>Checkpoint <b>{manifest.checkpoint_included ? 'included' : 'not present'}</b></span></div>
    <h4>Messages sent</h4>{messages.map((message) => <div className="prompt-source-row" key={String(message.index)}><b>{String(message.index)} · {String(message.role)} · {String(message.source)}</b><span>{Number(message.characters || 0).toLocaleString()} characters · ~{Number(message.estimated_tokens || 0).toLocaleString()} tokens</span>{Array.isArray(message.retrieved_files) && message.retrieved_files.map(String).map((file) => <code key={file}>{file}</code>)}</div>)}
    <h4>Project instructions</h4>{instructions.length ? instructions.map((source) => <code key={String(source.path)}>{String(source.path)} · {Number(source.characters || 0).toLocaleString()} characters · ~{Number(source.estimated_tokens || 0).toLocaleString()} tokens</code>) : <span className="prompt-none">None detected</span>}
    <h4>Retrieved project files</h4>{retrieved.length ? retrieved.map((path) => <code key={path}>{path}</code>) : <span className="prompt-none">No retrieval excerpts in this request</span>}
    <h4>Skills · {skills.enabled ? 'enabled' : 'disabled'} · sources {(Array.isArray(skills.selected_sources) ? skills.selected_sources : []).map(String).join(', ') || 'none'}</h4><div className="prompt-source-list">{availableSkills.map((skill) => <span key={String(skill.name)}><b>{String(skill.name)}</b><small>{String(skill.source)}{catalogSkills.includes(String(skill.name)) ? ' · listed in tool schema' : ' · discoverable through skill list'}</small></span>)}</div>{skillReferences.length > 0 && <div className="prompt-source-list"><b>Skill results retained in request history</b>{skillReferences.map((reference, index) => <span key={`${index}-${String(reference.name)}-${String(reference.path)}`}>{String(reference.action)} · {String(reference.name)}{reference.path ? ` / ${String(reference.path)}` : ''}<small>{String(reference.result)}</small></span>)}</div>}
    <h4>Tools sent to model</h4><div className="prompt-source-list">{tools.map((tool) => <span key={String(tool.name)}><b>{String(tool.name)}</b><small>{String(tool.provider)}</small></span>)}</div>
    <h4>Workflow</h4><span className="prompt-none">{String(workflow.harness_profile || 'standard')} · {String(workflow.task_intent || 'auto')} · {String(workflow.effective_access || 'unknown')} access · {Number(manifest.compaction_notice_count || 0)} compaction notice(s)</span>
  </div>;
}

export function ActivityFeed({ entries, mode, surface }: { entries: ActivityRecord[]; mode: ActivityMode; surface: 'chat' | 'sidebar' }) {
  if (surface === 'chat' && mode === 'sidebar') return null;
  if (!entries.length) return surface === 'sidebar' ? <p className="sheet-empty">Reads, tool calls, and results will appear here as they happen.</p> : null;
  return <div className={`activity-feed activity-feed-${surface} activity-mode-${mode}`} aria-label={surface === 'chat' ? 'Agent activity in this conversation' : 'Activity trace'}>
    {entries.map((row) => <ActivityCard key={row.id} row={row} expanded={surface === 'chat' && mode === 'inline'} surface={surface}/>) }
  </div>;
}
