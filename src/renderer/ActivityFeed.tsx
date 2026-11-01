import { useEffect, useState } from 'react';
import type { ActivityMode, ActivityRecord } from '../shared/protocol';

const INITIAL_ACTIVITY_WINDOW = 100;
const ACTIVITY_WINDOW_STEP = 100;

function ProgressiveText({ value }: { value: string }) {
  const [visible, setVisible] = useState(16_000);
  if (!value) return null;
  const shown = value.slice(0, visible);
  const remaining = value.length - shown.length;
  return <div className="activity-output-block"><pre>{shown}</pre>{remaining > 0 && <button className="activity-show-more" onClick={() => setVisible((count) => count + 16_000)}>Show next {Math.min(16_000, remaining).toLocaleString()} characters · {remaining.toLocaleString()} remaining</button>}</div>;
}

function ActivityCard({ row, expanded, surface }: { row: ActivityRecord; expanded: boolean; surface: 'chat' | 'sidebar' }) {
  const title = row.name?.replaceAll('_', ' ') || (row.kind === 'plan' ? 'Plan updated' : row.kind === 'approval' ? 'Action approval' : row.kind === 'question' ? row.title || 'Question for you' : row.kind === 'context' ? 'Request context compacted' : row.kind === 'prompt' ? 'Model prompt sources' : 'Activity');
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
      {row.status === 'uncertain' && <span className="activity-review-warning">inspect before retry</span>}
      {row.approvalStatus && <span className={`activity-approval activity-approval-${row.approvalStatus}`}>approval {row.approvalStatus.replaceAll('_', ' ')}</span>}
      {surface === 'sidebar' && row.affectedFiles?.length ? <span className="activity-file-count">{row.affectedFiles.length} file{row.affectedFiles.length === 1 ? '' : 's'}</span> : null}
    </summary>
    <div className="activity-card-details">
      {row.affectedFiles?.length ? <div className="activity-files">{row.affectedFiles.map((file) => <code key={file}>{file}</code>)}</div> : null}
      {row.arguments !== undefined && <details className="activity-subdetails"><summary>Arguments</summary><ProgressiveText value={JSON.stringify(row.arguments, null, 2)}/></details>}
      {Object.entries(output).map(([stream, value]) => value ? <details className="activity-subdetails" key={stream}><summary>{stream} · {value.length.toLocaleString()} characters</summary><ProgressiveText value={value}/></details> : null)}
      {row.result ? <details className="activity-subdetails"><summary>Result · {row.result.length.toLocaleString()} characters</summary><ProgressiveText value={row.result}/></details> : null}
      {row.kind === 'question' && <div className="activity-question"><b>{row.question}</b>{row.options?.map((option, index) => <span key={`${row.id}-option-${index}`}>{option.label}{option.description ? ` · ${option.description}` : ''}</span>)}{row.answer && <p><strong>Answer:</strong> {row.answer}</p>}</div>}
      {row.kind === 'plan' && row.taskMode && <div className="activity-plan-item"><b>Task mode selected</b><span>{row.taskMode}</span></div>}
      {row.items?.map((item, index) => <div className="activity-plan-item" key={`${row.id}-${index}`}><b>{item.group && <small className="plan-group">{item.group}</small>}{item.title || item.text || 'Work item'}</b><span>{item.status || 'pending'}</span></div>)}
      {row.acceptanceCriteria?.length ? <details className="activity-subdetails"><summary>Acceptance criteria · {row.acceptanceCriteria.length}</summary><ul className="activity-plan-list">{row.acceptanceCriteria.map((criterion, index) => <li key={`${row.id}-criterion-${index}`}>{criterion}</li>)}</ul></details> : null}
      {row.decisions?.length ? <details className="activity-subdetails"><summary>Recorded decisions · {row.decisions.length}</summary><ul className="activity-plan-list">{row.decisions.map((decision, index) => <li key={`${row.id}-decision-${index}`}>{decision}</li>)}</ul></details> : null}
      {row.kind === 'context' && <div className="activity-plan-item"><b>{row.omittedTurns || 0} earlier turn{row.omittedTurns === 1 ? '' : 's'} and {row.omittedOperationGroups || 0} in-task exchange group{row.omittedOperationGroups === 1 ? '' : 's'} omitted from this inference request</b><span>{row.retainedTurns || 0} retained · {row.inputBudget?.toLocaleString() || '—'} input budget · {row.configuredContext?.toLocaleString() || '—'} configured context · checkpoint {row.checkpointIncluded ? `included (${row.checkpointEstimate?.toLocaleString() || 0} estimated tokens${row.checkpointCompacted ? ', summarized' : ''})` : 'not included'}</span>{row.checkpointOmissions && Object.keys(row.checkpointOmissions).length > 0 && <small>Checkpoint history summarized: {Object.entries(row.checkpointOmissions).map(([key, count]) => `${key.replaceAll('_', ' ')} ${count.toLocaleString()}`).join(' · ')}</small>}</div>}
      {row.kind === 'prompt' && <PromptManifestDetails manifest={row.promptManifest || {}} providerRequest={row.providerRequest} providerUsage={row.providerUsage}/>}
      {row.kind === 'approval' && <div className="activity-plan-item"><b>{String(row.arguments || '')}</b></div>}
      {row.kind === 'tool_preparation' && <div className="activity-plan-item"><b>{row.status === 'assembled' ? 'Complete structured call received; operation activity below reports dispatch and approval.' : row.status === 'interrupted' ? 'The response ended before this structured call was complete.' : 'Model is preparing a structured tool call. Partial arguments are withheld until the complete call is validated.'}</b><span>{row.provider || 'provider'} · request {row.requestIndex ?? '—'} · call {row.callIndex ?? '—'} · {Number(row.argumentCharacters || 0).toLocaleString()} argument characters</span></div>}
      {row.startedAt && <time>{new Date(row.startedAt * 1000).toLocaleTimeString()}</time>}
    </div>
  </details>;
}

function PromptManifestDetails({ manifest, providerRequest, providerUsage }: { manifest: Record<string, unknown>; providerRequest?: Record<string, unknown>; providerUsage?: Record<string, unknown> }) {
  const messages = Array.isArray(manifest.messages) ? manifest.messages as Array<Record<string, unknown>> : [];
  const instructions = Array.isArray(manifest.project_instruction_sources) ? manifest.project_instruction_sources as Array<Record<string, unknown>> : [];
  const retrieved = Array.isArray(manifest.retrieved_project_files) ? manifest.retrieved_project_files.map(String) : [];
  const tools = Array.isArray(manifest.tools) ? manifest.tools as Array<Record<string, unknown>> : [];
  const selectedToolNames = Array.isArray(manifest.selected_tool_names) ? manifest.selected_tool_names.map(String) : Array.isArray(providerRequest?.tool_names) ? (providerRequest.tool_names as unknown[]).map(String) : tools.map((tool) => String(tool.name || ''));
  const deferredToolNames = Array.isArray(manifest.deferred_tool_names) ? manifest.deferred_tool_names.map(String) : Array.isArray(providerRequest?.deferred_tool_names) ? (providerRequest.deferred_tool_names as unknown[]).map(String) : [];
  const skills = manifest.skills && typeof manifest.skills === 'object' ? manifest.skills as Record<string, unknown> : {};
  const availableSkills = Array.isArray(skills.available) ? skills.available as Array<Record<string, unknown>> : [];
  const catalogSkills = Array.isArray(skills.catalog_entries_in_request_tool_schema) ? skills.catalog_entries_in_request_tool_schema.map(String) : [];
  const skillReferences = Array.isArray(skills.load_references_in_request_history) ? skills.load_references_in_request_history as Array<Record<string, unknown>> : [];
  const workflow = manifest.workflow && typeof manifest.workflow === 'object' ? manifest.workflow as Record<string, unknown> : {};
  const actualOptions = providerRequest?.request_options;
  const additionalFields = providerRequest?.additional_fields;
  const ignoredRuntimeOverrides = additionalFields && typeof additionalFields === 'object'
    ? (additionalFields as Record<string, unknown>).ignored_runtime_option_overrides
    : undefined;
  const dispatchStatus = String(providerRequest?.dispatch_status || 'not recorded');
  const dispatchText: Record<string, string> = {
    prepared: 'Prepared; dispatch has not been confirmed',
    awaiting_response_headers: 'Request dispatched; waiting for response headers. Cancel interrupts this request.',
    response_headers_received: `Response headers received${providerRequest?.http_status == null ? '' : ` · HTTP ${String(providerRequest.http_status)}`}`,
    response_stream_ended: `Response stream ended${providerRequest?.provider_done === true ? ' · provider marked done' : providerRequest?.provider_done === false ? ' · provider did not mark done' : ''}`,
    request_failed: `Request failed${providerRequest?.failure_phase ? ` during ${String(providerRequest.failure_phase).replaceAll('_', ' ')}` : ''}: ${String(providerRequest?.request_error || 'no error detail')}`,
    cancelled_during_request: `Cancelled${providerRequest?.failure_phase ? ` during ${String(providerRequest.failure_phase).replaceAll('_', ' ')}` : ''}`,
  };
  const missingUsageText = dispatchStatus === 'prepared' || dispatchStatus === 'awaiting_response_headers'
    ? 'Provider usage is not available yet because the response has not completed.'
    : dispatchStatus === 'request_failed' || dispatchStatus === 'cancelled_during_request'
      ? 'The request ended before provider usage counters were returned.'
      : dispatchStatus === 'response_stream_ended'
        ? 'This runtime did not return usage counters for the completed request.'
        : 'Usage counters were not recorded for this older session.';
  const usageRows: Array<[string, string, boolean]> = [
    ['Prompt tokens', 'prompt_eval_count', false], ['Cached prompt tokens', 'prompt_eval_cached_count', false],
    ['Generated tokens', 'eval_count', false], ['Prompt evaluation time', 'prompt_eval_duration', true],
    ['Generation time', 'eval_duration', true], ['Model load time', 'load_duration', true],
  ];
  return <div className="prompt-manifest-details">
    <p>This is a source and size record for the request sent to the selected runtime. Prompt text is not duplicated in the journal.</p>
    <h4>Provider request settings and dispatch</h4>{providerRequest ? <>
      <div className="prompt-source-row"><b>{dispatchText[dispatchStatus] || `Dispatch state: ${dispatchStatus.replaceAll('_', ' ')}`}</b>{providerRequest.header_wait_seconds != null && <span>Response-header wait · {Number(providerRequest.header_wait_seconds).toFixed(2)} s</span>}{providerRequest.http_reason && <span>{String(providerRequest.http_reason)}</span>}</div>
      <div className="prompt-manifest-stats"><span>Provider <b>{String(providerRequest.provider || 'unknown')}</b></span><span>Selected model <b>{String(providerRequest.model || 'unknown')}</b></span><span>API model <b>{String(providerRequest.api_model || 'not reported')}</b></span><span>API <b>{String(providerRequest.request_api || 'unknown')}</b></span><span>Request <b>{String(providerRequest.request_index ?? '—')}</b></span><span>Streaming <b>{providerRequest.stream == null ? 'not reported' : String(providerRequest.stream)}</b></span><span>Tools in request <b>{providerRequest.tool_count == null ? 'not reported' : Number(providerRequest.tool_count).toLocaleString()}</b></span><span>Requested context <b>{Number(providerRequest.requested_context || 0).toLocaleString()}</b></span><span>Runtime context <b>{providerRequest.runtime_context == null ? 'not reported' : Number(providerRequest.runtime_context).toLocaleString()}</b></span><span>Output limit <b>{Number(providerRequest.max_output_tokens || 0).toLocaleString()}</b></span><span>Reasoning override <b>{providerRequest.reasoning_field_sent === false ? 'omitted' : providerRequest.reasoning_field_sent === true ? `sent: ${String(providerRequest.reasoning_override)}` : 'not reported'}</b></span>{providerRequest.runtime_reasoning !== undefined && <span>Runtime reasoning <b>{String(providerRequest.runtime_reasoning)}</b></span>}{providerRequest.reasoning_field_sent === false && providerRequest.runtime_reasoning === undefined && <span>Reasoning behavior <b>provider/model default</b></span>}{providerRequest.keep_alive !== undefined && <span>Keep alive <b>{String(providerRequest.keep_alive)}</b></span>}<span>Input estimate <b>{providerRequest.estimated_input_tokens == null ? 'not reported' : Number(providerRequest.estimated_input_tokens).toLocaleString()}</b></span>{providerRequest.input_estimate_method !== undefined && <span>Estimate method <b>{String(providerRequest.input_estimate_method)}</b></span>}</div>
      <h4>Request options</h4><pre className="prompt-request-options">{actualOptions === undefined ? 'Not reported by this runtime.' : JSON.stringify(actualOptions, null, 2)}</pre>
      <h4>Additional request fields</h4><pre className="prompt-request-options">{additionalFields === undefined ? 'None reported by this runtime.' : JSON.stringify(additionalFields, null, 2)}</pre>
      {ignoredRuntimeOverrides && <p className="prompt-none">Runtime options tried to override controls owned by this run. The selected context, output-token limit, and temperature were sent instead; the conflicting values are recorded above.</p>}
    </> : <p className="prompt-none">Exact provider request settings were not recorded for this older session.</p>}
    <h4>Provider returned usage</h4>{providerUsage ? <div className="prompt-manifest-stats">{usageRows.map(([label, key, duration]) => {
      const value = providerUsage[key];
      const formatted = typeof value !== 'number' ? 'not reported' : duration ? `${(value / 1_000_000_000).toFixed(2)} s` : value.toLocaleString();
      return <span key={key}>{label} <b>{formatted}</b></span>;
    })}</div> : <p className="prompt-none">{missingUsageText}</p>}
    <div className="prompt-manifest-stats"><span>Request <b>{String(manifest.request_index ?? '—')}</b></span><span>Input estimate <b>{Number(manifest.estimated_request_input_tokens || 0).toLocaleString()}</b></span><span>Budget <b>{Number(manifest.input_budget || 0).toLocaleString()}</b></span><span>Context <b>{Number(manifest.configured_context || 0).toLocaleString()}</b></span><span>Output <b>{Number(manifest.maximum_output_tokens || 0).toLocaleString()}</b></span><span>Checkpoint <b>{manifest.checkpoint_included ? 'included' : 'not present'}</b></span></div>
    <h4>Messages sent</h4>{messages.map((message) => <div className="prompt-source-row" key={String(message.index)}><b>{String(message.index)} · {String(message.role)} · {String(message.source)}</b><span>{Number(message.characters || 0).toLocaleString()} characters · ~{Number(message.estimated_tokens || 0).toLocaleString()} tokens</span>{Array.isArray(message.retrieved_files) && message.retrieved_files.map(String).map((file) => <code key={file}>{file}</code>)}</div>)}
    <h4>Project instructions</h4>{instructions.length ? instructions.map((source) => <code key={String(source.path)}>{String(source.path)} · {Number(source.characters || 0).toLocaleString()} characters · ~{Number(source.estimated_tokens || 0).toLocaleString()} tokens</code>) : <span className="prompt-none">None detected</span>}
    <h4>Retrieved project files</h4>{retrieved.length ? retrieved.map((path) => <code key={path}>{path}</code>) : <span className="prompt-none">No retrieval excerpts in this request</span>}
    <h4>Skills · {skills.enabled ? 'enabled' : 'disabled'} · sources {(Array.isArray(skills.selected_sources) ? skills.selected_sources : []).map(String).join(', ') || 'none'}</h4><div className="prompt-source-list">{availableSkills.map((skill) => <span key={String(skill.name)}><b>{String(skill.name)}</b><small>{String(skill.source)}{catalogSkills.includes(String(skill.name)) ? ' · listed in tool schema' : ' · discoverable through skill list'}</small></span>)}</div>{skillReferences.length > 0 && <div className="prompt-source-list"><b>Skill results retained in request history</b>{skillReferences.map((reference, index) => <span key={`${index}-${String(reference.name)}-${String(reference.path)}`}>{String(reference.action)} · {String(reference.name)}{reference.path ? ` / ${String(reference.path)}` : ''}<small>{String(reference.result)}</small></span>)}</div>}
    <h4>Tools sent to model · {selectedToolNames.length}</h4><div className="prompt-source-list">{selectedToolNames.map((name) => <span key={name}><b>{name}</b></span>)}</div>
    {deferredToolNames.length > 0 && <details className="activity-subdetails"><summary>Other available tools · {deferredToolNames.length} (load on demand)</summary><div className="prompt-source-list">{deferredToolNames.map((name) => <span key={name}><b>{name}</b></span>)}</div></details>}
    <h4>Workflow</h4><span className="prompt-none">{String(workflow.harness_profile || 'standard')} · {String(workflow.task_intent || 'auto')} · {String(workflow.effective_access || 'unknown')} access · {Number(manifest.compaction_notice_count || 0)} compaction notice(s)</span>
  </div>;
}

export function ActivityFeed({ entries, mode, surface }: { entries: ActivityRecord[]; mode: ActivityMode; surface: 'chat' | 'sidebar' }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_ACTIVITY_WINDOW);
  const scope = entries[0]?.sessionId || '';
  useEffect(() => setVisibleCount(INITIAL_ACTIVITY_WINDOW), [scope]);
  if (surface === 'chat' && mode === 'sidebar') return null;
  if (!entries.length) return surface === 'sidebar' ? <p className="sheet-empty">Reads, tool calls, and results will appear here as they happen.</p> : null;
  const visibleEntries = entries.slice(Math.max(0, entries.length - visibleCount));
  const earlierCount = entries.length - visibleEntries.length;
  return <div className={`activity-feed activity-feed-${surface} activity-mode-${mode}`} aria-label={surface === 'chat' ? 'Agent activity in this conversation' : 'Activity trace'}>
    {earlierCount > 0 && <button className="activity-load-earlier" onClick={() => setVisibleCount((count) => count + ACTIVITY_WINDOW_STEP)}>
      Load earlier activity · showing {visibleEntries.length.toLocaleString()} of {entries.length.toLocaleString()} total
    </button>}
    {visibleEntries.map((row) => <ActivityCard key={row.id} row={row} expanded={surface === 'chat' && mode === 'inline'} surface={surface}/>) }
  </div>;
}
