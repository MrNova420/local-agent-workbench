import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import type { AccessMode, ActivityEventEnvelope, ActivityMode, ActivityRecord, ApprovalMode, HarnessProfile, ModelCatalog, ModelInfo, ProjectFile, RunOptions, SessionSummary, WorkerCommand, WorkerEvent, WorkspaceHistoryEntry } from '../shared/protocol';
import { nextRunPhase, restoredRunPhase, runStepProgress } from '../shared/run-state';
import { addGenerationUsage, beginGeneration, emptyRunMetrics, endGeneration, estimateOutputTokens, liveOutputTokensPerSecond, outputTokensAreEstimated, recordFirstToken, recordStreamedText, type RunMetrics } from '../shared/run-metrics';
import { buildModelLabels, buildTokenPresets, chooseDefaultModel, normalizeReasoningChoice } from '../shared/model-controls';
import { normalizeGpuStats } from '../shared/resource-metrics';
import { restoreTranscriptMessages } from '../shared/transcript';
import { LocalModelOrbit } from './ModelOrbit';
import { ActivityFeed } from './ActivityFeed';
import { applyActivityEvent } from '../shared/activity';
import { DEFAULT_RUN_SHEET_LAYOUT, moveRunSheetPanel, normalizeRunSheetLayout, resizeRunSheetPanel, type RunSheetLayout, type RunSheetPanel } from '../shared/run-sheet-layout';
import { nextHarnessProfile } from '../shared/harness-profile';

type ChatMessage = { role: 'user' | 'assistant'; content: string; thinking?: string; streaming?: boolean; recoveredPartial?: boolean };
type Session = {
  session_id: string;
  workspace: string;
  model: string;
  provider_id?: 'ollama' | 'llama.cpp';
  model_id?: string;
  context: number;
  messages: Array<{ role: string; content?: string; thinking?: string; tool_calls?: unknown[] }>;
  access?: AccessMode;
  approval_mode?: ApprovalMode;
  reasoning?: boolean | string | null;
  max_tokens?: number;
  temperature?: number;
  keep_alive?: string;
  harness_profile?: HarnessProfile;
  working_workspace?: string;
  copy_manifest?: Record<string, string>;
  last_error?: { message: string; occurred_at: number };
  activity_mode?: ActivityMode;
  activity_events?: ActivityRecord[];
  plan?: Array<{ title?: string; text?: string; status?: string }>;
  run_state?: Record<string, unknown> | null;
};
type TraceRow = { id: string; title: string; description?: string; kind: 'tool' | 'status' | 'plan' | 'error'; time: number };
type Approval = { actionId: string; name: string; arguments: unknown; workspace: string; mode: ApprovalMode };
type Notice = { tone: 'good' | 'warn' | 'bad'; text: string };
type TelemetryView = {
  cpu: number | null; ram: string; gpu: string; gpuUtil: number | null;
  vramUsed: number | null; vramTotal: number | null; vramPercent: number | null; gpuPower: number | null;
  loadedContext: number | null; contextMismatch: boolean; serviceRss: string; serviceCpu: number | null;
  kvSlot: { contextTokens: number | null; contextLimit: number | null; cachedTokens: number | null; processing: boolean } | null;
};
type AppliedSettings = { model: string; context: number; maxOutput: number; reasoning: boolean | string | null };

const initialOptions = {
  context: 8192,
  maxTokens: 4096,
  temperature: 0.2,
  keepAlive: '30m',
  access: 'ask' as AccessMode,
  approvalMode: 'per-action' as ApprovalMode,
  reasoning: null as boolean | string | null,
  harnessProfile: 'standard' as HarnessProfile,
};

function shortPath(value?: string) {
  if (!value) return 'No project selected';
  const normalized = value.replaceAll('\\', '/').replace(/\/$/, '');
  return normalized.split('/').at(-1) || value;
}
function fmt(n?: number) { return n == null ? '—' : new Intl.NumberFormat().format(n); }
function secs(ms: number) { return `${Math.floor(ms / 1000)}s`; }
function tokenDelay(ms: number | null) { return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`; }

function Icon({ name }: { name: 'spark' | 'folder' | 'arrow' | 'close' | 'play' | 'stop' | 'clock' | 'cpu' | 'memory' | 'branch' | 'chevron' | 'plus' | 'terminal' | 'check' | 'refresh' }) {
  const paths: Record<string, React.ReactNode> = {
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    folder: <><path d="M3 6.7A1.7 1.7 0 0 1 4.7 5H10l2 2h7.3A1.7 1.7 0 0 1 21 8.7v8.6a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 17.3V6.7Z"/><path d="M3.5 9h17"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    cpu: <><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/></>,
    memory: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4m4-4v4m4-4v4m4-4v4M7 3v3m5-3v3m5-3v3M7 18v3m5-3v3m5-3v3"/></>,
    branch: <><path d="M6 3v12a4 4 0 0 0 4 4h8"/><path d="M14 7h4a3 3 0 0 0 3-3"/><circle cx="6" cy="3" r="2"/><circle cx="18" cy="19" r="2"/><circle cx="21" cy="4" r="2"/></>,
    chevron: <path d="m7 10 5 5 5-5"/>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    terminal: <><path d="m4 6 6 6-6 6"/><path d="M12 18h8"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Button({ children, onClick, kind = 'quiet', disabled, title, className = '' }: { children: React.ReactNode; onClick?: () => void; kind?: 'quiet' | 'bright' | 'outline' | 'danger'; disabled?: boolean; title?: string; className?: string }) {
  return <button className={`button button-${kind} ${className}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}

function SheetPanelControls({ panel, layout, onMove, onResize }: { panel: RunSheetPanel; layout: RunSheetLayout; onMove: (panel: RunSheetPanel, direction: -1 | 1) => void; onResize: (panel: RunSheetPanel, direction: -1 | 1) => void }) {
  return <div className="sheet-panel-controls" aria-label={`${panel} panel layout`}>
    <button onClick={() => onMove(panel, -1)} disabled={layout.order[0] === panel} aria-label={`Move ${panel} panel up`} title="Move panel up">↑</button>
    <button onClick={() => onMove(panel, 1)} disabled={layout.order.at(-1) === panel} aria-label={`Move ${panel} panel down`} title="Move panel down">↓</button>
    <button onClick={() => onResize(panel, -1)} disabled={layout.heights[panel] <= 90} aria-label={`Make ${panel} panel shorter`} title="Make panel shorter">−</button>
    <button onClick={() => onResize(panel, 1)} disabled={layout.heights[panel] >= 520} aria-label={`Make ${panel} panel taller`} title="Make panel taller">+</button>
  </div>;
}

export default function App() {
  const [models, setModels] = useState<string[]>([]);
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const displayModelLabels = useMemo(() => buildModelLabels(models, modelLabels), [models, modelLabels]);
  const [model, setModel] = useState('');
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [workspace, setWorkspace] = useState(localStorage.getItem('agent-workspace') || '');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceHistoryEntry[]>([]);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [activityMode, setActivityMode] = useState<ActivityMode>(() => ['sidebar', 'inline'].includes(sessionStorage.getItem('agent-activity-mode') || '') ? sessionStorage.getItem('agent-activity-mode') as ActivityMode : 'compact');
  const [activityDefault, setActivityDefault] = useState<ActivityMode>(() => ['sidebar', 'inline'].includes(localStorage.getItem('agent-activity-default') || '') ? localStorage.getItem('agent-activity-default') as ActivityMode : 'compact');
  const [askActivityChoice, setAskActivityChoice] = useState(() => localStorage.getItem('agent-ask-activity') === 'true');
  const [activityChoiceOpen, setActivityChoiceOpen] = useState(false);
  const [sessionConflict, setSessionConflict] = useState<{ id: string; workspace: string; versions: Array<{ source: 'app' | 'project'; updated_at?: number }> } | null>(null);
  const [recoverySession, setRecoverySession] = useState<Session | null>(null);
  const [cancelChoiceOpen, setCancelChoiceOpen] = useState(false);
  const [closeChoiceOpen, setCloseChoiceOpen] = useState(false);
  const [trace, setTrace] = useState<TraceRow[]>([]);
  const [plan, setPlan] = useState<Array<{ title?: string; text?: string; status?: string }>>([]);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [copyChanges, setCopyChanges] = useState<Array<{ path: string; action: string; conflict: boolean; reason: string }>>([]);
  const [selectedChanges, setSelectedChanges] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [installed, setInstalled] = useState(false);
  const [connected, setConnected] = useState<'checking' | 'yes' | 'no'>('checking');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('Ready');
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [runMetrics, setRunMetrics] = useState<RunMetrics>(emptyRunMetrics);
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({});
  const [appliedSettings, setAppliedSettings] = useState<AppliedSettings | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
  const [downloadedModelDirectory, setDownloadedModelDirectory] = useState('');
  const [diffOpen, setDiffOpen] = useState(false);
  const [mcpJson, setMcpJson] = useState('{"mcpServers":{}}');
  const [options, setOptions] = useState(() => ({
    ...initialOptions,
    harnessProfile: localStorage.getItem('agent-harness-profile') === 'small-model' ? 'small-model' as HarnessProfile : 'standard' as HarnessProfile,
  }));
  const [settingsTouched, setSettingsTouched] = useState(false);
  const [view, setView] = useState<'landing' | 'project' | 'session'>('landing');
  const [projectTab, setProjectTab] = useState<'overview' | 'files' | 'sessions'>('overview');
  const [contextTouched, setContextTouched] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const notify = useCallback((text: string, tone: Notice['tone'] = 'good') => {
    setNotice({ text, tone });
    window.setTimeout(() => setNotice((current) => current?.text === text ? null : current), 4500);
  }, []);

  const request = useCallback(async <T,>(command: WorkerCommand): Promise<T> => window.agent.request<T>(command), []);

  const refreshModels = useCallback(async () => {
    setConnected('checking');
    try {
      const catalog = await request<ModelCatalog>({ command: 'model_catalog' });
      const rows = [...catalog.ollama, ...catalog.gguf.map((entry) => entry.id)];
      setModels(rows);
      setModelLabels(Object.fromEntries(catalog.gguf.map((entry) => [entry.id, entry.label])));
      setConnected(catalog.ollama_error ? 'no' : 'yes');
      setModel((current) => chooseDefaultModel(rows, current));
      if (catalog.ollama_error && !catalog.gguf.length) notify(`Ollama is not reachable: ${catalog.ollama_error}`, 'bad');
      else if (!catalog.ollama_error && !rows.length) notify('Ollama is connected, but no models are installed.', 'warn');
    } catch (error) {
      setConnected('no');
      setModels([]);
      notify(`Ollama is not reachable: ${(error as Error).message}`, 'bad');
    }
  }, [notify, request]);

  const refreshWorkspace = useCallback(async (root: string) => {
    const [fileRows, sessionRows] = await Promise.all([
      request<ProjectFile[]>({ command: 'workspace_files', workspace: root }),
      request<SessionSummary[]>({ command: 'sessions_list', workspace: root }),
    ]);
    setFiles(fileRows);
    setSessions(sessionRows);
  }, [request]);

  const refreshWorkspaceHistory = useCallback(async (query = '') => {
    setWorkspaces(await request<WorkspaceHistoryEntry[]>({ command: 'workspaces_list', query }));
  }, [request]);

  const refreshHome = useCallback(async () => {
    const [history, rows] = await Promise.all([
      request<WorkspaceHistoryEntry[]>({ command: 'workspaces_list', query: '' }),
      request<SessionSummary[]>({ command: 'sessions_list' }),
    ]);
    setWorkspaces(history);
    setSessions(rows);
  }, [request]);

  const showProject = useCallback(async (root: string) => {
    try {
      const filesResult = await request<ProjectFile[]>({ command: 'workspace_files', workspace: root });
      await request({ command: 'workspace_record', workspace: root });
      setWorkspace(root);
      localStorage.setItem('agent-workspace', root);
      setFiles(filesResult);
      setSessions(await request<SessionSummary[]>({ command: 'sessions_list', workspace: root }));
      await refreshWorkspaceHistory('');
      setSession(null);
      setMessages([]);
      setView('project');
      setProjectTab('overview');
    } catch (error) { notify(`Could not open project: ${(error as Error).message}`, 'bad'); }
  }, [notify, refreshWorkspaceHistory, request]);

  const loadSession = useCallback(async (id: string, selectedWorkspace = workspace, source?: 'app' | 'project') => {
    try {
      const response = await request<Session | { conflict: true; recommended_source: 'project'; versions: Array<{ source: 'app' | 'project'; updated_at?: number }> }>({ command: 'session_resume', sessionId: id, workspace: selectedWorkspace || undefined, source });
      if ('conflict' in response && response.conflict) {
        setSessionConflict({ id, workspace: selectedWorkspace, versions: response.versions });
        return;
      }
      const loaded = response as Session;
      setSessionConflict(null);
      setPhase(restoredRunPhase(loaded.run_state?.status));
      const root = loaded.workspace;
      setModel(loaded.model);
      const rows: ChatMessage[] = restoreTranscriptMessages(loaded.messages);
      setWorkspace(root);
      localStorage.setItem('agent-workspace', root);
      setSession(loaded);
      const partial = typeof loaded.run_state?.partial_content === 'string' ? loaded.run_state.partial_content : '';
      const partialThinking = typeof loaded.run_state?.partial_thinking === 'string' ? loaded.run_state.partial_thinking : '';
      if (loaded.run_state?.status === 'interrupted' && (partial || partialThinking)) rows.push({ role: 'assistant', content: partial, thinking: partialThinking, recoveredPartial: true });
      setMessages(rows);
      setActivities(Array.isArray(loaded.activity_events) ? loaded.activity_events : []);
      setPlan(Array.isArray(loaded.plan) ? loaded.plan : []);
      const nextMode: ActivityMode = loaded.activity_mode === 'sidebar' || loaded.activity_mode === 'inline' ? loaded.activity_mode : 'compact';
      setActivityMode(nextMode);
      sessionStorage.setItem('agent-activity-mode', nextMode);
      setTrace(loaded.last_error ? [{ id: `last-error-${loaded.last_error.occurred_at}`, title: 'Previous run failed', description: loaded.last_error.message, kind: 'error', time: loaded.last_error.occurred_at * 1000 }] : []);
      setOptions({
        context: loaded.context || modelInfo?.context || 8192,
        maxTokens: loaded.max_tokens || 4096,
        temperature: loaded.temperature ?? 0.2,
        keepAlive: loaded.keep_alive || '30m',
        access: loaded.access || 'ask',
        approvalMode: loaded.approval_mode === 'per-task' ? 'per-task' : 'per-action',
        reasoning: loaded.reasoning ?? null,
        harnessProfile: loaded.harness_profile === 'small-model' ? 'small-model' : (localStorage.getItem('agent-harness-profile') === 'small-model' ? 'small-model' : 'standard'),
      });
      setContextTouched(true);
      setSettingsTouched(true);
      setView('session');
      setRecoverySession(loaded.run_state?.status === 'interrupted' ? loaded : null);
      setSessions(await request<SessionSummary[]>({ command: 'sessions_list', workspace: root }));
      await refreshWorkspaceHistory('');
    } catch (error) { notify(`Could not resume session: ${(error as Error).message}`, 'bad'); }
  }, [modelInfo?.context, notify, refreshWorkspaceHistory, request, workspace]);

  async function recoverInterruptedRun(action: 'resume' | 'retry' | 'restore') {
    if (!recoverySession) return;
    const recovered = await request<{ state: Session; prompt?: string; action: string }>({ command: 'session_recover', sessionId: recoverySession.session_id, action });
    setRecoverySession(null);
    setSession(recovered.state);
    const restored: ChatMessage[] = restoreTranscriptMessages(recovered.state.messages);
    const partial = typeof recovered.state.run_state?.partial_content === 'string' ? recovered.state.run_state.partial_content : '';
    const partialThinking = typeof recovered.state.run_state?.partial_thinking === 'string' ? recovered.state.run_state.partial_thinking : '';
    if (partial || partialThinking) restored.push({ role: 'assistant', content: partial, thinking: partialThinking, recoveredPartial: true });
    setMessages(restored);
    setActivities(Array.isArray(recovered.state.activity_events) ? recovered.state.activity_events : []);
    if (action === 'restore' || !recovered.prompt) return;
    const settings = (recovered.state.run_state?.settings || {}) as Record<string, unknown>;
    const run: RunOptions = {
      workspace: recovered.state.workspace, sessionId: recovered.state.session_id,
      providerId: recovered.state.provider_id === 'llama.cpp' ? 'llama.cpp' : 'ollama',
      prompt: recovered.prompt, model: String(settings.model || recovered.state.model),
      context: Number(settings.context || recovered.state.context),
      maxTokens: Number(settings.max_tokens || recovered.state.max_tokens || 4096),
      temperature: Number(recovered.state.temperature ?? 0.2),
      access: recovered.state.access || 'ask', approvalMode: recovered.state.approval_mode || 'per-action',
      keepAlive: recovered.state.keep_alive || '30m',
      reasoning: (settings.reasoning ?? recovered.state.reasoning ?? null) as boolean | string | null,
      harnessProfile: settings.harness_profile === 'small-model' || recovered.state.harness_profile === 'small-model' ? 'small-model' : 'standard',
    };
    setPrompt(''); setRunning(true); setPhase('Recovering interrupted task'); setStartedAt(Date.now()); setElapsed(0);
    try { await request({ command: 'run_start', options: run }); }
    catch (error) { setRunning(false); setPhase('Recovery failed'); notify(`Could not continue the interrupted task: ${(error as Error).message}`, 'bad'); }
  }

  useEffect(() => {
    void refreshModels();
    void refreshHome().catch((error) => notify(`Could not load saved workspace history: ${(error as Error).message}`, 'warn'));
    void request({ command: 'ping' }).then(() => setInstalled(true)).catch(() => setInstalled(false));
    const unsubscribe = window.agent.onEvent((event) => {
      if (event.type === 'service_ready') setInstalled(true);
      if (event.type === 'service_error' || event.type === 'service_exit') {
        setInstalled(false);
        if (event.type === 'service_exit') {
          setApproval(null);
          setRunning(false);
          setPhase((current) => nextRunPhase(current, event));
          setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
          setRunMetrics((current) => endGeneration(current));
          setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        }
        notify(String(event.error || 'Agent service stopped.'), 'bad');
      }
      if (event.type === 'service_log') console.info('[agent service]', event.text);
      if (event.type === 'activity_event') setActivities((current) => applyActivityEvent(current, event as unknown as ActivityEventEnvelope));
      if (event.type === 'session_mirror_error') notify(`The app copy is saved, but the project mirror failed: ${String(event.error || 'unavailable')}`, 'warn');
      if (event.type === 'model_registered') {
        setModelLabels((current) => ({ ...current, [String(event.model)]: String(event.label || shortModel(String(event.model))) }));
        setModel(String(event.model));
        void refreshModels();
      }
      if (event.type === 'hf_download_job_complete') { setDownloadedModelDirectory(String(event.directory || '')); notify('Selected Hugging Face files were downloaded at the pinned revision.', 'good'); void refreshModels(); }
      if (event.type === 'hf_download_error' || event.type === 'llama_error' || event.type === 'ollama_import_error') notify(String(event.error || 'Model operation failed.'), 'bad');
      if (event.type === 'llama_loading') notify(`Loading ${shortModel(String(event.model))} with ${fmt(Number(event.context))} context. The app owns this runtime process.`, 'warn');
      if (event.type === 'llama_ready') notify(`GGUF server ready · ${fmt(Number(event.effective_context ?? event.context))} ${event.effective_context == null ? 'configured' : 'effective'} context.`, 'good');
      if (event.type === 'llama_load_cancelled' || event.type === 'hf_download_cancelled') notify('Model operation cancelled.', 'warn');
      if (event.type === 'ollama_import_complete') { notify(`Safetensors import complete: ${String(event.name)}.`, 'good'); void refreshModels(); }
      if (event.type === 'ollama_import_cancelled') notify('Safetensors import cancelled.', 'warn');
      if (event.type === 'phase') {
        setPhase((current) => nextRunPhase(current, event));
        if (event.phase === 'reasoning' || event.phase === 'generating') setRunMetrics((current) => {
          const measured = recordFirstToken(current, event.elapsed);
          return measured.isGenerating ? measured : beginGeneration(measured);
        });
      }
      if (event.type === 'text') {
        const chunk = String(event.text || '');
        setRunMetrics((current) => recordStreamedText(current, chunk));
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role === 'assistant' && last.streaming) return [...current.slice(0, -1), { ...last, content: last.content + chunk }];
          return [...current, { role: 'assistant', content: chunk, streaming: true }];
        });
      }
      if (event.type === 'thinking') {
        const chunk = String(event.text || '');
        setRunMetrics((current) => recordStreamedText(current, chunk));
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role === 'assistant' && last.streaming) return [...current.slice(0, -1), { ...last, thinking: (last.thinking || '') + chunk }];
          return [...current, { role: 'assistant', content: '', thinking: chunk, streaming: true }];
        });
      }
      if (event.type === 'plan') {
        const items = Array.isArray(event.items) ? event.items as typeof plan : [];
        setPlan(items);
      }
      if (event.type === 'approval_request') {
        setApproval({ actionId: String(event.actionId), name: String(event.name), arguments: event.arguments, workspace: String(event.workspace), mode: event.mode === 'per-task' ? 'per-task' : 'per-action' });
      }
      if (event.type === 'session_saved') {
        const root = String(event.workspace || workspace);
        if (root) void request<SessionSummary[]>({ command: 'sessions_list', workspace: root }).then(setSessions).catch(() => undefined);
        void refreshWorkspaceHistory('').catch(() => undefined);
      }
      if (event.type === 'generation_complete') {
        setPhase((current) => nextRunPhase(current, event));
      }
      if (event.type === 'generation_usage') setRunMetrics((current) => addGenerationUsage(current, event.usage));
      if (event.type === 'inference_settings') setAppliedSettings({ model: String(event.model), context: Number(event.requested_context), maxOutput: Number(event.max_output_tokens), reasoning: event.reasoning_override == null ? null : event.reasoning_override as boolean | string });
      if (event.type === 'complete') {
        setApproval(null);
        setRunning(false); setPhase((current) => nextRunPhase(current, event));
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        setRunMetrics((current) => endGeneration(current));
        setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
      }
      if (event.type === 'cancelled') {
        setApproval(null); setRunning(false); setPhase((current) => nextRunPhase(current, event)); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        setRunMetrics((current) => endGeneration(current));
        notify('This request was cancelled. Runtime processes and model state were left alone.', 'warn');
      }
      if (event.type === 'stopped_after_operation') {
        setApproval(null); setRunning(false); setPhase('Stopped after active operation'); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setRunMetrics((current) => endGeneration(current));
        notify('The active operation was saved. No further model or tool calls were started.', 'warn');
      }
      if (event.type === 'error') {
        setApproval(null);
        setRunning(false); setPhase((current) => nextRunPhase(current, event)); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setTrace((current) => [...current, { id: crypto.randomUUID(), title: 'Run failed', description: String(event.error || 'The task failed.'), kind: 'error', time: Date.now() }]);
        setRunMetrics((current) => endGeneration(current));
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        notify(String(event.error || 'The task failed.'), 'bad');
      }
      if (event.type === 'run_idle') {
        setApproval(null);
        setRunning(false);
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        setRunMetrics((current) => endGeneration(current));
        setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setPhase((current) => nextRunPhase(current, event));
      }
      if (event.type === 'mcp_status') notify(String(event.text), event.text && String(event.text).startsWith('MCP unavailable') ? 'warn' : 'good');
      if (event.type === 'load_warn') notify(String(event.text), 'warn');
      if (event.type === 'context_limit') notify(String(event.error), 'bad');
    });
    const unsubscribeClose = window.agent.onCloseDecision(() => setCloseChoiceOpen(true));
    return () => { unsubscribe(); unsubscribeClose(); };
  }, [notify, refreshHome, refreshModels, refreshWorkspaceHistory, request, workspace]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'o' && !running) { event.preventDefault(); void chooseWorkspace(); }
      if (event.ctrlKey && event.key === ',') { event.preventDefault(); setSettingsOpen(true); }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [running]);

  useEffect(() => {
    if (!workspace) return;
    void refreshWorkspace(workspace).catch((error) => {
      setWorkspace(''); localStorage.removeItem('agent-workspace');
      notify(`Previous workspace is unavailable: ${(error as Error).message}`, 'warn');
    });
  }, []);

  useEffect(() => {
    if (!model) { setModelInfo(null); return; }
    let current = true;
    void request<ModelInfo>({ command: 'model_info', model }).then((value) => {
      if (!current) return;
      setModelInfo(value);
      if (!contextTouched && !session && !settingsTouched && value.context !== null) setOptions((old) => ({ ...old, context: value.context! }));
    }).catch(() => { if (current) setModelInfo(null); });
    return () => { current = false; };
  }, [contextTouched, model, request, session, settingsTouched]);

  useEffect(() => {
    let live = true;
    const refresh = () => void request<Record<string, unknown>>({ command: 'system_snapshot' }).then((value) => { if (live) setSnapshot(value); }).catch(() => undefined);
    refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => { live = false; window.clearInterval(interval); };
  }, [request]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (running && startedAt) setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [running, startedAt]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);

  const currentSessions = useMemo(() => sessions.filter((row) => !workspace || row.workspace === workspace), [sessions, workspace]);
  const availableFiles = useMemo(() => files.filter((row) => row.path).slice(0, 500), [files]);
  const telemetry = useMemo(() => {
    const loaded = Array.isArray(snapshot.loaded) ? snapshot.loaded as Array<Record<string, unknown>> : [];
    const active = loaded.find((row) => row.name === model);
    const llama = snapshot.llama && typeof snapshot.llama === 'object' ? snapshot.llama as Record<string, unknown> : {};
    const gpuStats = normalizeGpuStats(snapshot.gpu_stats);
    const llamaMatches = model.startsWith('gguf::') && llama.running === true && String(llama.model || '') === model.slice('gguf::'.length);
    const llamaContext = llamaMatches && typeof llama.effective_context === 'number' ? llama.effective_context : null;
    const slotMetrics = llamaMatches && llama.slot_metrics && typeof llama.slot_metrics === 'object' ? llama.slot_metrics as Record<string, unknown> : null;
    const slots = slotMetrics && Array.isArray(slotMetrics.slots) ? slotMetrics.slots as Array<Record<string, unknown>> : [];
    const currentSlot = slots.find((slot) => slot.is_processing === true) || slots.find((slot) => typeof slot.context_tokens_in_slot === 'number') || null;
    return {
      cpu: typeof snapshot.cpu_percent === 'number' ? Math.round(snapshot.cpu_percent) : null,
      ram: typeof snapshot.ram_total_bytes === 'number' && typeof snapshot.ram_available_bytes === 'number'
        ? `${((snapshot.ram_total_bytes - snapshot.ram_available_bytes) / 1024 ** 3).toFixed(1)} / ${(snapshot.ram_total_bytes / 1024 ** 3).toFixed(0)} GB` : '—',
      gpu: gpuStats?.name ?? (typeof snapshot.gpu === 'string' ? snapshot.gpu.split(',')[0].trim() : 'GPU status unavailable'),
      gpuUtil: gpuStats?.utilizationPercent ?? null,
      vramUsed: gpuStats?.memoryUsedMiB ?? null,
      vramTotal: gpuStats?.memoryTotalMiB ?? null,
      vramPercent: gpuStats?.memoryUsedMiB != null && gpuStats.memoryTotalMiB ? Math.round(gpuStats.memoryUsedMiB / gpuStats.memoryTotalMiB * 100) : null,
      gpuPower: gpuStats?.powerWatts ?? null,
      loadedContext: llamaMatches ? llamaContext : active && typeof active.context_length === 'number' ? active.context_length : null,
      contextMismatch: Boolean((llamaMatches && llamaContext !== null && llamaContext < options.context) || (active && typeof active.context_length === 'number' && active.context_length < options.context)),
      kvSlot: currentSlot ? {
        contextTokens: typeof currentSlot.context_tokens_in_slot === 'number' ? currentSlot.context_tokens_in_slot : null,
        contextLimit: typeof currentSlot.n_ctx === 'number' ? currentSlot.n_ctx : null,
        cachedTokens: typeof currentSlot.n_prompt_tokens_cache === 'number' ? currentSlot.n_prompt_tokens_cache : null,
        processing: currentSlot.is_processing === true,
      } : null,
      serviceRss: typeof snapshot.service_rss_bytes === 'number' ? `${(snapshot.service_rss_bytes / 1024 ** 3).toFixed(2)} GB` : '—',
      serviceCpu: typeof snapshot.service_cpu_percent === 'number' ? Math.round(snapshot.service_cpu_percent) : null,
    };
  }, [model, options.context, snapshot]);

  async function chooseWorkspace() {
    const selected = await window.agent.chooseWorkspace();
    if (selected) await showProject(selected);
  }

  async function newSession(selectedActivityMode?: ActivityMode) {
    if (!workspace) { await chooseWorkspace(); return; }
    if (!selectedActivityMode && askActivityChoice) { setActivityChoiceOpen(true); return; }
    try {
      const selectedModel = model;
      if (!selectedModel) { notify('Add or install a local model from Model Library before starting a session.', 'warn'); setModelLibraryOpen(true); return; }
      const selectedInfo = await request<ModelInfo>({ command: 'model_info', model: selectedModel });
      const configuredContext = !contextTouched && !settingsTouched ? selectedInfo.context ?? options.context : options.context;
      const chosenMode = selectedActivityMode || activityDefault;
      const created = await request<Session>({ command: 'session_new', workspace, model: selectedModel, context: configuredContext, activityMode: chosenMode });
      setSession(created); setMessages([]); setTrace([]); setPlan([]); setPrompt(''); setElapsed(0); setPhase('Ready'); setView('session');
      setActivities([]); setActivityMode(chosenMode); sessionStorage.setItem('agent-activity-mode', chosenMode);
      setRunMetrics(emptyRunMetrics());
      setOptions((old) => ({ ...old, context: created.context, approvalMode: 'per-action', reasoning: null }));
      void refreshWorkspace(workspace);
      window.setTimeout(() => promptRef.current?.focus(), 60);
    } catch (error) { notify(`Could not start a session: ${(error as Error).message}`, 'bad'); }
  }

  async function startRun() {
    if (running || !session || !workspace || !model || !prompt.trim()) return;
    if (model.startsWith('gguf::')) {
      try {
        const status = await request<Record<string, unknown>>({ command: 'llama_status' });
        if (status.running !== true || status.model !== model.slice('gguf::'.length) || status.context !== options.context || status.reasoning !== options.reasoning) {
          setModelLibraryOpen(true);
          notify('Load the selected GGUF with these context and reasoning settings before starting the task.', 'warn');
          return;
        }
      } catch (error) { notify(`Could not verify llama.cpp runtime: ${(error as Error).message}`, 'bad'); return; }
    }
    const task = prompt.trim();
    const run: RunOptions = {
      workspace, sessionId: session.session_id, prompt: task, model, providerId: model.startsWith('gguf::') ? 'llama.cpp' : 'ollama',
      context: options.context, maxTokens: options.maxTokens, temperature: options.temperature,
      access: options.access, approvalMode: options.approvalMode, keepAlive: options.keepAlive,
      reasoning: normalizeReasoningChoice(options.reasoning, modelInfo?.reasoning ?? null),
      harnessProfile: options.harnessProfile,
    };
    if (options.approvalMode === 'auto') setOptions((current) => ({ ...current, approvalMode: 'per-action' }));
    setMessages((current) => [...current, { role: 'user', content: task }]);
    setTrace([]); setPlan([]); setPrompt(''); setRunning(true); setPhase('Connecting to Ollama');
    setStartedAt(Date.now()); setElapsed(0); setRunMetrics(emptyRunMetrics());
    try { await request({ command: 'run_start', options: run }); }
    catch (error) { setRunning(false); setPhase('Run failed'); notify((error as Error).message, 'bad'); }
  }

  async function toggleHarnessProfile() {
    const harnessProfile = nextHarnessProfile(options.harnessProfile);
    setOptions((current) => ({ ...current, harnessProfile }));
    localStorage.setItem('agent-harness-profile', harnessProfile);
    if (!session) return;
    try {
      await request({ command: 'session_harness_profile', sessionId: session.session_id, harnessProfile });
      setSession((current) => current ? { ...current, harness_profile: harnessProfile } : current);
    } catch (error) {
      notify(`Workflow changed for this run, but the session setting could not be saved: ${(error as Error).message}`, 'warn');
    }
  }

  async function cancelRun() { setCancelChoiceOpen(true); }

  async function chooseCancelAction(action: 'continue' | 'cancel' | 'finish') {
    setCancelChoiceOpen(false);
    if (action === 'continue') return;
    try {
      if (action === 'cancel') { await request({ command: 'run_cancel' }); setPhase('Cancelling request'); }
      else { await request({ command: 'run_stop_after_operation' }); setPhase('Finishing active operation'); }
    } catch (error) { notify(`Could not update the run: ${(error as Error).message}`, 'bad'); }
  }

  async function answerApproval(approved: boolean) {
    if (!approval) return;
    const action = approval;
    setApproval(null);
    try { await request({ command: 'approval_reply', actionId: action.actionId, approved }); }
    catch (error) { notify((error as Error).message, 'bad'); }
  }

  async function showDiff() {
    if (!workspace) {
      setDiffError('Choose a project before reviewing its changes.');
      setDiffOpen(true);
      return;
    }
    setDiffOpen(true);
    setDiffLoading(true);
    setDiffError('');
    setDiff('');
    setCopyChanges([]);
    setSelectedChanges([]);
    try {
      if (session?.access === 'copy') setCopyChanges(await request({ command: 'copy_review', sessionId: session.session_id }));
      else setDiff((await request<{ text: string }>({ command: 'workspace_diff', workspace })).text);
    } catch (error) {
      const message = (error as Error).message;
      setDiffError(message);
      notify(`Could not load changes: ${message}`, 'bad');
    } finally {
      setDiffLoading(false);
    }
  }

  async function applyCopyChanges() {
    if (!session || !selectedChanges.length) return;
    try {
      const result = await request<{ applied: string[] }>({ command: 'copy_apply', sessionId: session.session_id, paths: selectedChanges });
      setDiffOpen(false); setSelectedChanges([]); notify(`Applied ${result.applied.length} reviewed change(s) to the source project.`);
      void showDiff();
    } catch (error) { notify((error as Error).message, 'bad'); }
  }

  async function openMcp() {
    try {
      const config = await request({ command: 'mcp_config_get' });
      setMcpJson(JSON.stringify(config, null, 2)); setMcpOpen(true);
    } catch (error) { notify((error as Error).message, 'bad'); }
  }

  async function saveMcp() {
    try {
      const config = JSON.parse(mcpJson) as unknown;
      await request({ command: 'mcp_config_set', config }); setMcpOpen(false); notify('Local MCP configuration saved.');
    } catch (error) { notify(`Could not save MCP settings: ${(error as Error).message}`, 'bad'); }
  }

  async function saveSettings() {
    setSettingsTouched(true);
    if (!Number.isInteger(options.context) || options.context < 1024 || !Number.isInteger(options.maxTokens) || options.maxTokens < 1 || options.temperature < 0 || options.temperature > 2) {
      notify('Check the context, output-token, and temperature values.', 'bad'); return;
    }
    localStorage.setItem('agent-activity-default', activityDefault);
    localStorage.setItem('agent-ask-activity', String(askActivityChoice));
    localStorage.setItem('agent-harness-profile', options.harnessProfile);
    sessionStorage.setItem('agent-activity-mode', activityMode);
    setSettingsOpen(false);
    if (session) {
      try { await request({ command: 'session_activity_mode', sessionId: session.session_id, activityMode }); }
      catch (error) { notify(`Run settings saved, but activity display could not be saved to this session: ${(error as Error).message}`, 'warn'); }
      setSession({ ...session, activity_mode: activityMode, model, model_id: model, provider_id: model.startsWith('gguf::') ? 'llama.cpp' : 'ollama', context: options.context, access: options.access, approval_mode: options.approvalMode === 'auto' ? 'per-action' : options.approvalMode, reasoning: options.reasoning, max_tokens: options.maxTokens, temperature: options.temperature, keep_alive: options.keepAlive, harness_profile: options.harnessProfile });
    }
  }

  function enter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void startRun(); }
  }

  const readyToRun = installed && connected === 'yes' && !!workspace && !!session && !!model && !!prompt.trim() && !running;

  return <div className="app-shell">
    <header className="topbar drag-region">
      <div className="brand-lockup no-drag">
        <div className="brand-orbit"><i/><b/><em/></div>
        <div><span className="brand-name">LOCAL / AGENT</span><span className="brand-sub">WORKBENCH 01</span></div>
      </div>
      <div className="topbar-divider"/>
      <button className={`workspace-chip no-drag ${workspace ? 'is-set' : ''}`} onClick={chooseWorkspace} title={workspace} disabled={running}>
        <span className="workspace-dot"/><span className="workspace-chip-text"><small>WORKSPACE</small><strong>{shortPath(workspace)}</strong></span><Icon name="chevron"/>
      </button>
      <div className="topbar-spacer"/>
      <div className="model-control no-drag">
        <span className="model-glyph"><Icon name="spark"/></span>
        <label><small>LOCAL MODEL</small><select value={model} onChange={(e) => { setModel(e.target.value); setContextTouched(false); setSettingsTouched(false); }} disabled={running}>
          {!models.length && <option value="">No local models</option>}{models.map((name) => <option value={name} key={name}>{displayModelLabels[name] || shortModel(name)}</option>)}
        </select></label>
      </div>
      <div className={`connection-pill no-drag ${model.startsWith('gguf::') ? (snapshot.llama && (snapshot.llama as Record<string, unknown>).running ? 'yes' : 'no') : connected}`}><span className="connection-light"/>{model.startsWith('gguf::') ? snapshot.llama && (snapshot.llama as Record<string, unknown>).running ? 'GGUF LOADED' : 'GGUF NOT LOADED' : connected === 'yes' ? 'OLLAMA READY' : connected === 'no' ? 'OLLAMA OFFLINE' : 'CHECKING'}</div>
      <Button kind="quiet" className="top-settings no-drag" onClick={() => setModelLibraryOpen(true)}>Model library</Button>
      <Button kind="quiet" className="top-settings no-drag" onClick={() => setSettingsOpen(true)}>Settings <span className="keycap">CTRL ,</span></Button>
    </header>

    <main className="main-stage">
      {view === 'landing' && <Landing
        workspaces={workspaces} workspaceSearch={workspaceSearch} sessions={sessions} models={models} modelLabels={displayModelLabels} model={model} context={options.context}
        connected={connected} telemetry={telemetry} onChoose={chooseWorkspace} onOpen={showProject}
        onModel={(name) => { setModel(name); setContextTouched(false); setSettingsTouched(false); }} onRefresh={() => { void refreshHome(); void refreshModels(); }}
        onModelInfo={(name) => request<ModelInfo>({ command: 'model_info', model: name })}
        onSearch={(value) => { setWorkspaceSearch(value); void refreshWorkspaceHistory(value); }}
        onPin={(root, pinned) => void request({ command: 'workspace_pin', workspace: root, pinned }).then(() => refreshWorkspaceHistory(workspaceSearch)).catch((error) => notify((error as Error).message, 'warn'))}
        onRemove={(root) => void request({ command: 'workspace_remove', workspace: root }).then(() => refreshWorkspaceHistory(workspaceSearch)).catch((error) => notify((error as Error).message, 'warn'))}
        onLibrary={() => setModelLibraryOpen(true)}
      />}
      {view === 'project' && <ProjectHome
        root={workspace} tab={projectTab} setTab={setProjectTab} files={availableFiles} sessions={currentSessions}
        onNew={() => void newSession()} onOpenSession={(id) => void loadSession(id, workspace)} onFiles={() => void refreshWorkspace(workspace)}
        onDiff={showDiff} onMcp={openMcp} running={running}
        onHome={() => setView('landing')}
      />}
      {view === 'session' && <SessionRoom
        root={workspace} session={session} messages={messages} activities={activities} activityMode={activityMode} plan={plan} phase={phase}
        elapsed={elapsed} running={running} prompt={prompt} setPrompt={setPrompt} promptRef={promptRef}
        options={options} setOptions={setOptions} files={availableFiles} telemetry={telemetry}
        runMetrics={runMetrics} onRun={startRun} onCancel={cancelRun} onSettings={() => setSettingsOpen(true)} onBack={() => { if (!running) setView('project'); }}
        onDiff={showDiff} onMcp={openMcp} onEnter={enter} endRef={endRef} model={model} modelInfo={modelInfo} appliedSettings={appliedSettings} onToggleHarnessProfile={() => void toggleHarnessProfile()}
      />}
    </main>

    <footer className="system-ribbon">
      <div className="ribbon-left"><span className={`ribbon-state ${installed ? 'live' : 'dim'}`}/><span>{installed ? 'ENGINE BRIDGE READY' : 'STARTING LOCAL BRIDGE'}</span><span className="ribbon-sep">/</span><span>REASONING: {options.reasoning == null ? 'MODEL DEFAULT' : String(options.reasoning).toUpperCase()}</span></div>
      <div className="ribbon-metrics" title={telemetry.gpu}>
        <span><Icon name="cpu"/> CPU {telemetry.cpu == null ? '—' : `${telemetry.cpu}%`}</span>
        <span><Icon name="memory"/> RAM {telemetry.ram}</span>
        <span>GPU {telemetry.gpuUtil == null ? '—' : `${telemetry.gpuUtil}%`}</span>
        <span className="vram-stat">VRAM {telemetry.vramUsed == null ? '—' : fmt(telemetry.vramUsed)} / {telemetry.vramTotal == null ? '—' : fmt(telemetry.vramTotal)} MiB</span>
        <span className="power-stat">PWR {telemetry.gpuPower == null ? '—' : `${telemetry.gpuPower.toFixed(2)} W`}</span>
      </div>
      <button className="ribbon-link" onClick={() => void request<Record<string, unknown>>({ command: 'system_snapshot' }).then(setSnapshot)}>DIAGNOSTICS <Icon name="arrow"/></button>
    </footer>

    {notice && <div className={`toast toast-${notice.tone}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)}><Icon name="close"/></button></div>}
    {settingsOpen && <SettingsModal model={model} modelLabel={displayModelLabels[model] || shortModel(model)} modelInfo={modelInfo} options={options} setOptions={setOptions} activityDefault={activityDefault} setActivityDefault={setActivityDefault} activityMode={activityMode} setActivityMode={setActivityMode} askActivityChoice={askActivityChoice} setAskActivityChoice={setAskActivityChoice} hasSession={!!session} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onMcp={openMcp} />}
    {modelLibraryOpen && <ModelLibraryModal model={model} models={models} modelLabels={displayModelLabels} context={options.context} reasoning={options.reasoning} downloadedDirectory={downloadedModelDirectory} onModel={setModel} onRefresh={refreshModels} onClose={() => setModelLibraryOpen(false)} notify={notify}/>}
    {mcpOpen && <Modal title="Local MCP connections" eyebrow="TOOL BRIDGE" onClose={() => setMcpOpen(false)}>
      <p className="modal-copy">Each server starts as a local stdio process. Add only commands you trust. Tool calls require approval.</p>
      <textarea className="code-editor mcp-editor" value={mcpJson} onChange={(e) => setMcpJson(e.target.value)} spellCheck={false}/>
      <div className="modal-actions"><Button kind="quiet" onClick={() => setMcpOpen(false)}>Cancel</Button><Button kind="bright" onClick={() => void saveMcp()}>Save connections</Button></div>
    </Modal>}
    {approval && <ApprovalModal approval={approval} onChoice={(yes) => void answerApproval(yes)} onCancelRun={() => void cancelRun()} />}
    {activityChoiceOpen && <Modal title="Choose live activity display" eyebrow="NEW SESSION" dismissible={false} onClose={() => undefined}>
      <p className="modal-copy">Choose how tool calls, file changes, and command output should appear while the model works. This session’s choice can be changed later.</p>
      <div className="activity-mode-choices">{([['compact', 'Compact cards', 'Show concise operation cards with expandable details.'], ['sidebar', 'Activity sidebar only', 'Keep the conversation focused and show operations in the trace.'], ['inline', 'Full inline output', 'Expand tool output directly in the conversation.']] as const).map(([mode, title, detail]) => <button key={mode} className={`activity-mode-choice ${activityDefault === mode ? 'recommended' : ''}`} onClick={() => { setActivityChoiceOpen(false); void newSession(mode); }}><b>{title}{activityDefault === mode ? ' · DEFAULT' : ''}</b><small>{detail}</small></button>)}</div>
    </Modal>}
    {sessionConflict && <Modal title="Session copies have diverged" eyebrow="CHOOSE WHICH VERSION TO KEEP" wide dismissible={false} onClose={() => undefined}>
      <p className="modal-copy">Both copies are preserved. Choose the version to load and synchronize; the project copy is recommended because it travels with this workspace.</p>
      <div className="activity-mode-choices">{sessionConflict.versions.map((version) => <button key={version.source} className={`activity-mode-choice ${version.source === 'project' ? 'recommended' : ''}`} onClick={() => { const conflict = sessionConflict; setSessionConflict(null); void loadSession(conflict.id, conflict.workspace, version.source); }}><b>{version.source === 'project' ? 'Project folder copy · recommended' : 'App-wide library copy'}</b><small>Last saved {version.updated_at ? new Date(version.updated_at * 1000).toLocaleString() : 'time unknown'}</small></button>)}</div>
    </Modal>}
    {recoverySession && <Modal title="An interrupted task was found" eyebrow="RECOVER SESSION" wide dismissible={false} onClose={() => undefined}>
      <p className="modal-copy">The app recovered the latest safe checkpoint. Partial model text is marked in the transcript. An in-flight tool operation may have partly completed and will not be replayed automatically.</p>
      {typeof recoverySession.run_state?.uncertain_operation === 'object' && <div className="approval-context"><span>REVIEW BEFORE RETRYING</span><code>{JSON.stringify(recoverySession.run_state.uncertain_operation)}</code></div>}
      <div className="activity-mode-choices"><button className="activity-mode-choice recommended" onClick={() => void recoverInterruptedRun('resume').catch((error) => notify(`Recovery failed: ${(error as Error).message}`, 'bad'))}><b>Continue from safe checkpoint</b><small>Inspect any uncertain effect before proposing another action.</small></button><button className="activity-mode-choice" onClick={() => void recoverInterruptedRun('retry').catch((error) => notify(`Recovery failed: ${(error as Error).message}`, 'bad'))}><b>Retry interrupted task</b><small>The model is explicitly warned to inspect before repeating uncertain work.</small></button><button className="activity-mode-choice" onClick={() => void recoverInterruptedRun('restore').catch((error) => notify(`Recovery failed: ${(error as Error).message}`, 'bad'))}><b>Restore history only</b><small>Keep the transcript and activity without continuing the task.</small></button></div>
    </Modal>}
    {cancelChoiceOpen && <Modal title="What should happen to this run?" eyebrow="RUN IS ACTIVE" dismissible={false} onClose={() => undefined}>
      <p className="modal-copy">Choose how to stop. Received text and completed tool results are saved before the run ends.</p>
      <div className="activity-mode-choices"><button className="activity-mode-choice" onClick={() => void chooseCancelAction('continue')}><b>Keep it running</b><small>Close this prompt and let the current task continue.</small></button><button className="activity-mode-choice danger-choice" onClick={() => void chooseCancelAction('cancel')}><b>Cancel now</b><small>Interrupt the current request and save output already received.</small></button><button className="activity-mode-choice recommended" onClick={() => void chooseCancelAction('finish')}><b>Finish the active operation, then stop</b><small>Save the current tool result and stop before the next model or tool call.</small></button></div>
    </Modal>}
    {closeChoiceOpen && <Modal title="A task is still running" eyebrow="CLOSE WORKBENCH" dismissible={false} onClose={() => undefined}>
      <p className="modal-copy">The task is still active. Choose whether to keep the window open, hide it while work continues, or cancel and close.</p>
      <div className="activity-mode-choices"><button className="activity-mode-choice" onClick={() => { setCloseChoiceOpen(false); void window.agent.resolveCloseChoice('keep'); }}><b>Keep the app open</b><small>Return to the live task.</small></button><button className="activity-mode-choice recommended" onClick={() => { setCloseChoiceOpen(false); void window.agent.resolveCloseChoice('hide'); }}><b>Hide to background and continue</b><small>The workbench keeps running in the system tray.</small></button><button className="activity-mode-choice danger-choice" onClick={() => { setCloseChoiceOpen(false); void window.agent.resolveCloseChoice('cancel-close'); }}><b>Cancel the run and close</b><small>Wait for the current request to stop and save its received output.</small></button></div>
    </Modal>}
    {diffOpen && <Modal title={session?.access === 'copy' ? 'Review proposed changes' : 'Project changes'} eyebrow="CHANGE REVIEW" wide onClose={() => setDiffOpen(false)}>
      {diffLoading ? <div className="empty-state" role="status">Loading changes from the selected project…</div> : diffError ? <div className="empty-state" role="alert">Could not load project changes: {diffError}</div> : session?.access === 'copy' ? <>
        <p className="modal-copy">These changes are in a disposable project copy. Select conflict-free files to apply them to the source workspace.</p>
        <div className="change-list">{copyChanges.length ? copyChanges.map((change) => <label className={`change-row ${change.conflict ? 'conflict' : ''}`} key={change.path}>
          <input type="checkbox" disabled={change.conflict} checked={selectedChanges.includes(change.path)} onChange={(e) => setSelectedChanges((list) => e.target.checked ? [...list, change.path] : list.filter((path) => path !== change.path))}/>
          <span className={`change-action ${change.action}`}>{change.action}</span><code>{change.path}</code>{change.conflict && <small>{change.reason || 'Conflict'}</small>}
        </label>) : <div className="empty-state">No reviewable changes in the working copy.</div>}</div>
        <div className="modal-actions"><Button kind="quiet" onClick={() => setDiffOpen(false)}>Close review</Button><Button kind="bright" disabled={!selectedChanges.length} onClick={() => void applyCopyChanges()}>Apply selected to source</Button></div>
      </> : <><pre className="diff-view">{diff || 'No changes available.'}</pre><div className="modal-actions"><Button kind="quiet" onClick={() => setDiffOpen(false)}>Done</Button></div></>}
    </Modal>}
  </div>;
}

function Landing({ workspaces, workspaceSearch, sessions, models, modelLabels, model, context, connected, telemetry, onChoose, onOpen, onModel, onModelInfo, onRefresh, onSearch, onPin, onRemove, onLibrary }: {
  workspaces: WorkspaceHistoryEntry[]; workspaceSearch: string; sessions: SessionSummary[]; models: string[]; modelLabels: Record<string, string>; model: string; context: number; connected: string;
  telemetry: TelemetryView;
  onChoose: () => void; onOpen: (root: string) => void; onModel: (name: string) => void; onModelInfo: (name: string) => Promise<ModelInfo>; onRefresh: () => void;
  onSearch: (value: string) => void; onPin: (root: string, pinned: boolean) => void; onRemove: (root: string) => void; onLibrary: () => void;
}) {
  return <section className="landing-view">
    <div className="landing-grid">
      <div className="landing-copy">
        <div className="eyebrow-line"><span className="eyebrow-mark"/> PRIVATE DEVELOPMENT / LOCAL FIRST</div>
        <h1>Give the model<br/><span>room to work.</span></h1>
        <p className="landing-description">A development desk for patient local agents. Keep the full project in view, see what the model is doing, and decide what reaches your files.</p>
        <div className="launch-actions"><Button kind="bright" onClick={onChoose}><Icon name="folder"/> Open a project <Icon name="arrow"/></Button><span className="launch-note"><kbd>CTRL</kbd> <b>+</b> <kbd>O</kbd> to switch workspaces</span></div>
        <div className="landing-stats"><div><small>INSTALLED MODELS</small><strong>{String(models.length).padStart(2, '0')}</strong></div><div><small>ACTIVE CONTEXT</small><strong>{fmt(context)} <i>tokens</i></strong></div><div><small>LOCAL ENGINE</small><strong className={connected === 'yes' ? 'text-mint' : connected === 'no' ? 'text-rose' : ''}>{connected === 'yes' ? 'ONLINE' : connected === 'no' ? 'OFFLINE' : 'CHECKING'}</strong></div></div>
      </div>
      <div className="landing-visual" aria-label="Installed local models arranged around the local AI workspace">
        <LocalModelOrbit models={models} labels={modelLabels} selectedModel={model} onModelInfo={onModelInfo} />
        <div className="visual-core"><span>LOCAL</span><strong>AI</strong><small>WORKS IN YOUR SPACE</small></div>
        <div className="orbit-label label-tl"><i/> PRIVATE BY DEFAULT</div><div className="orbit-label label-br"><i/> NO REMOTE ROUTING</div>
        <div className="visual-coordinate">[LOCATION REMOVED]<br/>[LOCATION REMOVED]</div>
      </div>
    </div>
    <div className="landing-lower">
      <div className="landing-column">
        <div className="section-heading"><div><span className="section-number">01</span><h2>Recent workspaces</h2></div><button onClick={onRefresh}><Icon name="refresh"/> Refresh</button></div>
        <input className="workspace-history-search" value={workspaceSearch} onChange={(event) => onSearch(event.target.value)} placeholder="Search workspace history…" aria-label="Search workspace history"/>
        {workspaces.length ? <div className="project-tiles workspace-history-list">{workspaces.map((entry) => <div key={`${entry.path}-${entry.first_opened_at}`} className={`workspace-history-row ${entry.available ? '' : 'unavailable'}`}>
          <button className="project-tile-main" disabled={!entry.available} onClick={() => onOpen(entry.path)}><span className="tile-glyph"><Icon name="folder"/></span><span><strong>{shortPath(entry.path)}{entry.pinned ? ' · PINNED' : ''}</strong><small>{entry.path}</small><em>{entry.available ? 'AVAILABLE' : 'FOLDER UNAVAILABLE'}</em></span><Icon name="arrow"/></button>
          <button className="workspace-history-action" title={entry.pinned ? 'Unpin workspace' : 'Pin workspace'} onClick={() => onPin(entry.path, !entry.pinned)}>{entry.pinned ? 'Unpin' : 'Pin'}</button>
          <button className="workspace-history-action remove" title="Remove from workspace history" onClick={() => onRemove(entry.path)}>Remove</button>
        </div>)}</div> : <div className="empty-inline"><span className="empty-art"><Icon name="folder"/></span><span><b>{workspaceSearch ? 'No workspaces match this search.' : 'No workspace has been opened here yet.'}</b><small>Open a project folder to add it to persistent local history.</small></span></div>}
      </div>
      <div className="landing-column engine-column">
        <div className="section-heading"><div><span className="section-number">02</span><h2>Inference source</h2></div><span className={`source-status ${connected}`}>{connected === 'yes' ? 'REACHABLE' : connected === 'no' ? 'OFFLINE' : 'CHECKING'}</span></div>
        <label className="model-picker-card"><span className="picker-symbol"><Icon name="spark"/></span><span className="picker-content"><small>LOCAL MODEL</small><select value={model} onChange={(e) => onModel(e.target.value)}>{!models.length && <option value="">No installed models</option>}{models.map((name) => <option key={name} value={name}>{modelLabels[name] || shortModel(name)}</option>)}</select><span>Choose Ollama models or add Hugging Face GGUF files.</span></span><Icon name="chevron"/></label>
        <Button kind="outline" onClick={onLibrary}>Browse Hugging Face / add local models</Button>
        <div className="engine-foot"><span><Icon name="cpu"/> {telemetry.serviceCpu == null ? 'SERVICE READY' : `SERVICE ${telemetry.serviceCpu}% CPU`}</span><span><Icon name="memory"/> {telemetry.serviceRss} SIDECAR</span><span>{sessions.length} SAVED SESSIONS</span></div>
      </div>
    </div>
  </section>;
}

function ProjectHome({ root, tab, setTab, files, sessions, onNew, onOpenSession, onFiles, onDiff, onMcp, onHome, running }: {
  root: string; tab: 'overview' | 'files' | 'sessions'; setTab: (value: 'overview' | 'files' | 'sessions') => void;
  files: ProjectFile[]; sessions: SessionSummary[]; onNew: () => void; onOpenSession: (id: string) => void;
  onFiles: () => void; onDiff: () => void; onMcp: () => void; onHome: () => void; running: boolean;
}) {
  const textFiles = files.filter((row) => row.text).length;
  return <section className="project-view">
    <div className="project-identity">
      <div className="project-monogram">{shortPath(root).slice(0, 2).toUpperCase()}</div>
      <div className="project-title"><span className="eyebrow-line"><span className="eyebrow-mark"/> ACTIVE PROJECT</span><h1>{shortPath(root)}</h1><p title={root}>{root}</p></div>
      <div className="project-identity-actions"><Button kind="quiet" onClick={onHome}><Icon name="arrow"/> Home</Button><Button kind="outline" onClick={onMcp}>MCP connections</Button><Button kind="outline" onClick={onDiff}>Review Git changes</Button><Button kind="bright" disabled={running} onClick={onNew}><Icon name="plus"/> Start a task</Button></div>
    </div>
    <nav className="project-tabs">{(['overview', 'files', 'sessions'] as const).map((item, index) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); if (item === 'files') onFiles(); }}><span>0{index + 1}</span>{item}</button>)}</nav>
    {tab === 'overview' && <div className="project-overview">
      <div className="overview-main">
        <div className="overview-welcome"><span className="eyebrow-line">WORKING DIRECTORY / VERIFIED</span><h2>Pick up where<br/>the work is.</h2><p>Built-in file tools stay within this project. Approved commands and MCP tools may access other locations under your Windows account; approval is not OS sandboxing. Session history stays associated with this folder.</p><Button kind="bright" onClick={onNew}><Icon name="plus"/> Create a new task</Button></div>
        <div className="workspace-facts"><div><small>VISIBLE FILES</small><strong>{fmt(files.length)}</strong></div><div><small>TEXT FILES</small><strong>{fmt(textFiles)}</strong></div><div><small>SAVED SESSIONS</small><strong>{fmt(sessions.length)}</strong></div></div>
      </div>
      <div className="recent-session-card"><div className="section-heading"><div><span className="section-number">03</span><h2>Recent sessions</h2></div><button onClick={() => setTab('sessions')}>All sessions <Icon name="arrow"/></button></div>
        {sessions.slice(0, 5).map((row, index) => <button className="session-tile" key={row.session_id} onClick={() => onOpenSession(row.session_id)}><span className="session-index">{String(index + 1).padStart(2, '0')}</span><span><strong>Session {row.session_id.slice(-8)}</strong><small>{row.model}</small>{row.sync_conflict && <small className="session-conflict-note">Copies differ · project version recommended</small>}</span><time>{new Date(row.updated_at * 1000).toLocaleDateString()}</time><Icon name="arrow"/></button>)}
        {!sessions.length && <div className="empty-inline compact"><span><b>No sessions for this folder yet.</b><small>Your first task will create a resumable session.</small></span></div>}
      </div>
      <div className="project-capabilities"><div><Icon name="branch"/><span><b>File boundary</b><small>Built-in file tools stay under this root.</small></span></div><div><Icon name="terminal"/><span><b>Host command access</b><small>Approval is consent, not OS containment.</small></span></div><div><Icon name="clock"/><span><b>Local history</b><small>Sessions can be resumed at any time.</small></span></div></div>
    </div>}
    {tab === 'files' && <div className="project-file-list"><div className="section-heading"><div><span className="section-number">04</span><h2>Indexed project files</h2></div><span>{files.length} entries</span></div>{files.map((file) => <div className="file-row" key={file.path}><span className={`file-glyph ${file.text ? 'text-file' : ''}`}>{file.text ? 'Aa' : '▧'}</span><code>{file.path}</code><small>{file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}</small></div>)}</div>}
    {tab === 'sessions' && <div className="project-file-list"><div className="section-heading"><div><span className="section-number">05</span><h2>Saved sessions</h2></div><span>{sessions.length} sessions</span></div>{sessions.map((row) => <button className="session-tile full-session" key={row.session_id} onClick={() => onOpenSession(row.session_id)}><span className="session-index"><Icon name="clock"/></span><span><strong>Session {row.session_id}</strong><small>{row.model}</small>{row.sync_conflict && <small className="session-conflict-note">Copies differ · project version recommended</small>}</span><time>{new Date(row.updated_at * 1000).toLocaleString()}</time><Icon name="arrow"/></button>)}</div>}
  </section>;
}

function SessionRoom({ root, session, messages, activities, activityMode, plan, phase, elapsed, running, prompt, setPrompt, promptRef, options, setOptions, files, telemetry, runMetrics, appliedSettings, onRun, onCancel, onSettings, onBack, onDiff, onMcp, onEnter, endRef, model, modelInfo, onToggleHarnessProfile }: {
  root: string; session: Session | null; messages: ChatMessage[]; activities: ActivityRecord[]; activityMode: ActivityMode; plan: Array<{ title?: string; text?: string; status?: string }>;
  phase: string; elapsed: number; running: boolean; prompt: string; setPrompt: (value: string) => void;
  promptRef: React.RefObject<HTMLTextAreaElement | null>; options: typeof initialOptions;
  setOptions: React.Dispatch<React.SetStateAction<typeof initialOptions>>; files: ProjectFile[];
  telemetry: TelemetryView;
  runMetrics: RunMetrics; appliedSettings: AppliedSettings | null;
  onRun: () => void; onCancel: () => void; onSettings: () => void; onBack: () => void; onDiff: () => void; onMcp: () => void;
  onEnter: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; endRef: React.RefObject<HTMLDivElement | null>; model: string; modelInfo: ModelInfo | null; onToggleHarnessProfile: () => void;
}) {
  const [sheetLayout, setSheetLayout] = useState<RunSheetLayout>(() => {
    try { return normalizeRunSheetLayout(JSON.parse(localStorage.getItem('agent-run-sheet-layout') || 'null')); }
    catch { return DEFAULT_RUN_SHEET_LAYOUT; }
  });
  useEffect(() => { localStorage.setItem('agent-run-sheet-layout', JSON.stringify(sheetLayout)); }, [sheetLayout]);
  const movePanel = (panel: RunSheetPanel, direction: -1 | 1) => setSheetLayout((layout) => moveRunSheetPanel(layout, panel, direction));
  const resizePanel = (panel: RunSheetPanel, direction: -1 | 1) => setSheetLayout((layout) => resizeRunSheetPanel(layout, panel, direction));
  const panelStyle = (panel: RunSheetPanel) => ({ order: sheetLayout.order.indexOf(panel) + 1, height: `${sheetLayout.heights[panel]}px` });
  const steps = ['Ready', 'Waiting for first token', 'Generating', phase === 'Turn complete' ? 'Turn complete' : 'Finishing turn'];
  const currentStep = runStepProgress(phase, running);
  return <section className="session-view">
    <div className="session-commandline"><button className="crumb-back" onClick={onBack}>PROJECT / {shortPath(root).toUpperCase()}</button><span className="crumb-slash">/</span><span className="session-crumb">SESSION {session?.session_id.slice(-8).toUpperCase()}</span><span className="commandline-spacer"/><button className="inline-command" onClick={onMcp}>MCP</button><button className="inline-command" onClick={onDiff}>CHANGES</button><span className={`phase-chip ${running ? 'is-running' : ''}`}><i/>{running ? phase.toUpperCase() : phase.toUpperCase()}</span><span className="run-elapsed"><Icon name="clock"/> {running ? secs(elapsed) : '—'}</span></div>
    <div className="task-route" aria-label="Task execution phases">{steps.map((step, index) => <div className={`route-step ${index < currentStep ? 'done' : ''} ${index === currentStep ? 'current' : ''}`} key={step}><span className="route-node">{index < currentStep ? <Icon name="check"/> : `0${index + 1}`}</span><span>{step === 'Waiting for first token' ? 'Prefill / waiting' : step}</span></div>)}</div>
    <div className="session-main-grid">
      <section className="transcript-plane" aria-label="Conversation transcript">
        {!messages.length ? <div className="transcript-empty"><div className="empty-symbol"><Icon name="spark"/></div><span className="eyebrow-line">NEW WORK UNIT / {shortPath(root).toUpperCase()}</span><h2>What should we<br/>work through?</h2><p>The model sees selected, relevant project files as needed. You control any action that can change the workspace.</p><div className="starter-prompts"><button onClick={() => setPrompt('Inspect this project and explain its architecture and how to run it.')}>Map the project <Icon name="arrow"/></button><button onClick={() => setPrompt('Review this project for the highest-priority bug and propose a fix.')}>Find a bug <Icon name="arrow"/></button><button onClick={() => setPrompt('Add a focused feature to this project and verify it with the existing tests.')}>Build a feature <Icon name="arrow"/></button></div></div> : <div className="message-list">{messages.map((message, index) => <article className={`message-card message-${message.role}`} key={`${index}-${message.role}`}>
          <div className="message-meta"><span className={`speaker-mark ${message.role}`}>{message.role === 'user' ? 'YOU' : <Icon name="spark"/>}</span><strong>{message.role === 'user' ? 'Task brief' : 'Local agent'}</strong><span>{message.recoveredPartial ? 'PARTIAL · INTERRUPTED' : message.role === 'user' ? 'INPUT' : message.streaming ? 'LIVE OUTPUT' : 'RESPONSE'}</span>{message.streaming && <i className="stream-pulse"/>}</div>
          <div className="message-content"><Markdown content={message.content}/></div>
          {message.thinking && <details className="reasoning-trace"><summary>Model reasoning · {message.thinking.length.toLocaleString()} characters</summary><div>{message.thinking}</div></details>}
        </article>)}<ActivityFeed entries={activities} mode={activityMode} surface="chat"/><div ref={endRef}/></div>}
        <div className="composer-shell">
          <div className="composer-profile"><span className={`profile-chip access-${options.access}`}>{options.access.toUpperCase()}</span><span className="profile-chip approval-chip">{options.approvalMode === 'auto' ? 'AUTO APPROVE · THIS RUN' : options.approvalMode === 'per-task' ? 'PER TASK' : 'PER ACTION'}</span><span className="profile-chip capability-chip" title="Capability reported by the selected local runtime; support metadata may be unknown">TOOLS {modelInfo?.tool_support === 'supported' ? 'SUPPORTED' : modelInfo?.tool_support === 'unsupported' ? 'UNSUPPORTED' : 'UNKNOWN'}</span><button className={`profile-toggle ${options.harnessProfile === 'small-model' ? 'is-active' : ''}`} type="button" aria-pressed={options.harnessProfile === 'small-model'} title="Changes agent workflow guidance only; model settings and token limits stay unchanged" onClick={onToggleHarnessProfile} disabled={running}>Small-model {options.harnessProfile === 'small-model' ? 'on' : 'off'}</button><span className="profile-hint">{fmt(options.context)} context · {fmt(options.maxTokens)} output</span><button onClick={onSettings}>Adjust run</button></div>
          <textarea ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onEnter} placeholder="Describe the work. Use Shift + Enter to add detail…" rows={3} disabled={running} aria-label="Task prompt"/>
          <div className="composer-bottom"><span><kbd>ENTER</kbd> to run <b>·</b> <kbd>SHIFT ENTER</kbd> for a new line <b>·</b> reasoning {options.reasoning == null ? 'model default' : String(options.reasoning)}</span>{running ? <Button kind="danger" onClick={onCancel}><Icon name="stop"/> Cancel request</Button> : <Button kind="bright" onClick={onRun} disabled={!prompt.trim()}><Icon name="play"/> Run task</Button>}</div>
        </div>
      </section>
      <aside className="run-sheet">
        <div className="run-sheet-heading"><div><span className="eyebrow-line">LIVE WORK SHEET</span><h2>Task signals</h2></div><Button kind="outline" className="sheet-inspect" onClick={onDiff}><Icon name="branch"/> Inspect changes</Button><span className={`run-lamp ${running ? 'active' : ''}`}/></div>
        <section className="sheet-panel" style={panelStyle('signals')} aria-label="Run signals and generation metrics">
          <div className="sheet-panel-heading"><span>MODEL &amp; GENERATION</span><SheetPanelControls panel="signals" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div>
          <div className="signal-matrix"><div className={`signal-card signal-wide ${telemetry.contextMismatch ? 'signal-warning' : ''}`}><small>MODEL / CONTEXT</small><strong title={model}>{shortModel(model)}</strong><span>{telemetry.loadedContext ? `RUNTIME ${fmt(telemetry.loadedContext)} / ${fmt(options.context)} REQUESTED TOKENS` : `${fmt(options.context)} REQUESTED · NOT CURRENTLY LOADED`}</span></div><div className="signal-card"><small>REQUEST SENT</small><strong>{appliedSettings && appliedSettings.model === model ? `${fmt(appliedSettings.context)} / ${fmt(appliedSettings.maxOutput)}` : '—'}</strong><span>CONTEXT / OUTPUT TOKENS</span></div><div className="signal-card"><small>REASONING OVERRIDE</small><strong>{appliedSettings && appliedSettings.model === model ? appliedSettings.reasoning == null ? 'DEFAULT' : String(appliedSettings.reasoning).toUpperCase() : '—'}</strong><span>EXACT SELECTED VALUE</span></div><div className="signal-card"><small>ELAPSED</small><strong>{running ? secs(elapsed) : '—'}</strong><span>{running ? phase.toUpperCase() : 'NO ACTIVE RUN'}</span></div><div className="signal-card"><small>FILES IN VIEW</small><strong>{files.length}</strong><span>INDEXED / IGNORE AWARE</span></div></div>
          <div className="run-metrics" aria-label="Model generation and prompt-cache statistics"><div><small>FIRST TOKEN</small><strong>{tokenDelay(runMetrics.firstTokenMs)}</strong></div><div title={outputTokensAreEstimated(runMetrics) ? 'Live estimate from streamed text; replaced by the provider’s exact rate after generation.' : 'Exact rate reported by the provider.'}><small>OUTPUT / SEC{outputTokensAreEstimated(runMetrics) ? ' · LIVE' : ''}</small><strong>{liveOutputTokensPerSecond(runMetrics)?.toFixed(1).replace(/^/, outputTokensAreEstimated(runMetrics) ? '~' : '') ?? '—'}</strong></div><div title={outputTokensAreEstimated(runMetrics) ? 'Live estimate from streamed text; replaced by the provider’s exact token count after generation.' : 'Exact output token count reported by the provider.'}><small>OUTPUT TOKENS{outputTokensAreEstimated(runMetrics) ? ' · LIVE' : ''}</small><strong>{outputTokensAreEstimated(runMetrics) ? '~' : ''}{fmt(estimateOutputTokens(runMetrics))}</strong></div><div title={`Provider-reported prompt reuse across model calls: ${fmt(runMetrics.cachedPromptTokens)} cached of ${fmt(runMetrics.promptTokens)} prompt tokens.`}><small>PROMPT REUSE</small><strong>{runMetrics.promptTokens ? `${Math.round(runMetrics.cachedPromptTokens / runMetrics.promptTokens * 100)}%` : '—'}</strong></div></div>
          <div className="kv-cache-panel" aria-label="KV cache and prompt reuse details"><div className="kv-cache-heading"><span>KV CACHE / PROMPT REUSE</span><small>{model.startsWith('gguf::') ? 'LLAMA.CPP' : 'OLLAMA'}</small></div><div className="kv-cache-grid"><div><small>CACHED PROMPT TOKENS · TASK</small><strong>{runMetrics.promptTokens ? `${fmt(runMetrics.cachedPromptTokens)} / ${fmt(runMetrics.promptTokens)} · ${Math.round(runMetrics.cachedPromptTokens / runMetrics.promptTokens * 100)}%` : 'Not reported yet'}</strong></div><div><small>UNCACHED PROMPT TOKENS · TASK</small><strong>{runMetrics.promptTokens ? fmt(Math.max(0, runMetrics.promptTokens - runMetrics.cachedPromptTokens)) : 'Not reported yet'}</strong></div><div><small>UNCACHED PREFILL TIME · TASK</small><strong>{runMetrics.promptEvalNanoseconds ? `${(runMetrics.promptEvalNanoseconds / 1e9).toFixed(2)} s` : 'Not reported'}</strong></div><div><small>MODEL LOAD TIME · TASK</small><strong>{runMetrics.modelLoadNanoseconds ? `${(runMetrics.modelLoadNanoseconds / 1e9).toFixed(2)} s` : 'Not reported'}</strong></div><div><small>SLOT CONTEXT TOKENS</small><strong>{telemetry.kvSlot ? `${telemetry.kvSlot.processing ? 'ACTIVE' : 'RETAINED'} · ${fmt(telemetry.kvSlot.contextTokens ?? undefined)} / ${fmt(telemetry.kvSlot.contextLimit ?? undefined)}` : model.startsWith('gguf::') ? 'Slot telemetry unavailable' : 'Not exposed by Ollama'}</strong></div><div><small>KV ALLOCATION BYTES</small><strong>Not exposed by runtime</strong></div><div><small>KV CACHE TYPE / PRECISION</small><strong>Not exposed by runtime</strong></div></div><p>Cache counters refresh after each completed model response; llama.cpp slot context refreshes with system telemetry. VRAM below is device-wide and is not KV-cache memory.</p></div>
          {telemetry.contextMismatch && <p className="context-warning" role="status">Ollama reports a smaller runtime context than requested. Available memory may limit allocation.</p>}
        </section>
        <div className="sheet-section sheet-panel" style={panelStyle('plan')}><div className="sheet-heading"><h3>Plan</h3><span>{plan.length ? `${plan.length} steps` : 'Awaiting agent'}</span><SheetPanelControls panel="plan" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div>{plan.length ? <ol className="plan-list">{plan.map((item, index) => <li key={`${index}-${item.title || item.text}`}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.title || item.text || 'Work item'}</b><small>{item.status || 'pending'}</small></li>)}</ol> : <p className="sheet-empty">A task checklist appears here when the agent creates one.</p>}</div>
        <div className="sheet-section trace-section sheet-panel" style={panelStyle('activity')}><div className="sheet-heading"><h3>Activity trace</h3><span>{activities.length} events</span><SheetPanelControls panel="activity" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div><ActivityFeed entries={activities} mode={activityMode} surface="sidebar"/></div>
        <div className="resource-summary sheet-panel" style={panelStyle('resources')}>
          <div className="resource-heading"><span>RESOURCE / SYSTEM</span><SheetPanelControls panel="resources" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div>
          <div className="resource-heading"><span>SIDECAR {telemetry.serviceRss}</span></div>
          <div className="resource-grid">
            <div className="resource-tile"><small>CPU</small><strong>{telemetry.cpu == null ? '—' : `${telemetry.cpu}%`}</strong><div className="meter"><i style={{ width: `${Math.min(100, telemetry.cpu ?? 0)}%` }}/></div></div>
            <div className="resource-tile"><small>RAM</small><strong>{telemetry.ram}</strong><div className="meter"><i style={{ width: `${memoryPct(telemetry.ram)}%` }}/></div></div>
            <div className="resource-tile"><small>GPU LOAD</small><strong>{telemetry.gpuUtil == null ? '—' : `${telemetry.gpuUtil}%`}</strong><div className="meter"><i style={{ width: `${Math.min(100, telemetry.gpuUtil ?? 0)}%` }}/></div></div>
            <div className="resource-tile"><small>VRAM · {telemetry.gpu}</small><strong>{telemetry.vramUsed == null ? '—' : fmt(telemetry.vramUsed)} / {telemetry.vramTotal == null ? '—' : fmt(telemetry.vramTotal)} MiB</strong><div className="meter"><i style={{ width: `${telemetry.vramPercent ?? 0}%` }}/></div></div>
            <div className="resource-tile"><small>GPU POWER</small><strong>{telemetry.gpuPower == null ? '—' : `${telemetry.gpuPower.toFixed(2)} W`}</strong><span>BOARD DRAW</span></div>
            <div className="resource-tile"><small>AGENT SERVICE</small><strong>{telemetry.serviceCpu == null ? '—' : `${telemetry.serviceCpu}% CPU`}</strong><span>{telemetry.serviceRss} RAM</span></div>
          </div>
        </div>
      </aside>
    </div>
  </section>;
}

type HubModel = { repo: string; revision: string; downloads: number; likes: number; gated: boolean };
type HubFile = { path: string; format: string; size: number | null; is_lfs: boolean; revision: string };

function ModelLibraryModal({ model, models, modelLabels, context, reasoning, downloadedDirectory, onModel, onRefresh, onClose, notify }: {
  model: string; models: string[]; modelLabels: Record<string, string>; context: number; reasoning: boolean | string | null;
  downloadedDirectory: string; onModel: (value: string) => void; onRefresh: () => Promise<void>; onClose: () => void;
  notify: (text: string, tone?: Notice['tone']) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HubModel[]>([]);
  const [repo, setRepo] = useState<HubModel | null>(null);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [configuredBinary, setConfiguredBinary] = useState('');
  const [runtime, setRuntime] = useState<Record<string, unknown>>({});
  const [downloadText, setDownloadText] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<'idle' | 'search' | 'files' | 'download' | 'load' | 'import'>('idle');
  const [safetensorsName, setSafetensorsName] = useState('imported-hf-model');

  useEffect(() => {
    void window.agent.request<Record<string, unknown>>({ command: 'llama_status' }).then((value) => {
      setRuntime(value);
      setConfiguredBinary(String(value.configured_binary || ''));
    }).catch((error) => notify(`Could not read llama.cpp status: ${(error as Error).message}`, 'warn'));
    const unsubscribe = window.agent.onEvent((event) => {
      if (event.type === 'hf_download_progress') {
        const size = (value: unknown) => typeof value === 'number' ? `${(value / 1024 ** 2).toFixed(1)} MB` : 'unknown size';
        setDownloadText(`${String(event.file)} · ${size(event.received_bytes)} / ${size(event.total_bytes)}`);
      }
      if (event.type === 'llama_ready') { setRuntime((value) => ({ ...value, running: true, model: event.model, context: event.context, effective_context: event.effective_context, owned: event.owned, reasoning: event.reasoning })); setBusy(false); setOperation('idle'); }
      if (event.type === 'llama_error' || event.type === 'hf_download_error' || event.type === 'ollama_import_error' || event.type === 'llama_load_cancelled' || event.type === 'hf_download_cancelled' || event.type === 'ollama_import_cancelled') { setBusy(false); setOperation('idle'); }
      if (event.type === 'hf_download_job_complete' || event.type === 'ollama_import_complete') { setBusy(false); setOperation('idle'); }
    });
    return unsubscribe;
  }, [notify]);

  async function searchHub() {
    if (!query.trim()) return;
    setBusy(true); setOperation('search'); setResults([]); setRepo(null); setFiles([]); setDownloadText('Searching the Hub…');
    try { setResults(await window.agent.request<HubModel[]>({ command: 'hf_search', query })); setDownloadText(''); }
    catch (error) { notify(`Hugging Face search failed: ${(error as Error).message}`, 'bad'); setDownloadText('Search failed.'); }
    finally { setBusy(false); setOperation('idle'); }
  }

  async function inspectRepo(row: HubModel) {
    setRepo(row); setBusy(true); setOperation('files'); setFiles([]); setSelectedFiles([]); setDownloadText(`Inspecting ${row.repo} at ${row.revision.slice(0, 10)}…`);
    try {
      const rows = await window.agent.request<HubFile[]>({ command: 'hf_repo_files', repo: row.repo, revision: row.revision });
      setFiles(rows);
      const gguf = rows.filter((file) => file.format === 'gguf');
      const tensors = rows.filter((file) => file.format === 'safetensors');
      const support = rows.filter((file) => file.format === 'other' && /^(config\.json|generation_config\.json|tokenizer.*|special_tokens_map\.json|added_tokens\.json)$/i.test(file.path.split('/').at(-1) || ''));
      setSelectedFiles(gguf.length ? [gguf[0].path] : [...tensors, ...support].map((file) => file.path));
      setDownloadText('');
    } catch (error) { notify(`Could not inspect repository: ${(error as Error).message}`, 'bad'); setDownloadText('Repository inspection failed.'); }
    finally { setBusy(false); setOperation('idle'); }
  }

  async function addLocalGguf() {
    const path = await window.agent.chooseModelFile();
    if (!path) return;
    try {
      const record = await window.agent.request<{ id: string }>({ command: 'gguf_register', path, source: { kind: 'local' } });
      onModel(record.id); await onRefresh(); notify('Local GGUF added to the model library.');
    } catch (error) { notify(`Could not add GGUF: ${(error as Error).message}`, 'bad'); }
  }

  async function chooseServer() {
    const path = await window.agent.chooseLlamaBinary();
    if (!path) return;
    try {
      const saved = await window.agent.request<{ binary: string }>({ command: 'llama_binary_set', path });
      setConfiguredBinary(saved.binary); notify('llama.cpp server executable saved.');
    } catch (error) { notify(`Could not configure llama.cpp: ${(error as Error).message}`, 'bad'); }
  }

  async function downloadFiles() {
    if (!repo || !selectedFiles.length) return;
    setBusy(true); setOperation('download'); setDownloadText('Starting selected downloads…');
    try {
      await window.agent.request({ command: 'hf_download_start', repo: repo.repo, revision: repo.revision, files: selectedFiles });
      setDownloadText(`Downloading ${selectedFiles.length} selected file(s)…`);
    } catch (error) { setBusy(false); setOperation('idle'); notify(`Could not start download: ${(error as Error).message}`, 'bad'); }
  }

  async function loadSelectedGguf() {
    if (!model.startsWith('gguf::')) return;
    if (!configuredBinary) {
      const path = await window.agent.chooseLlamaBinary();
      if (!path) return;
      try { const saved = await window.agent.request<{ binary: string }>({ command: 'llama_binary_set', path }); setConfiguredBinary(saved.binary); }
      catch (error) { notify(`Could not configure llama.cpp: ${(error as Error).message}`, 'bad'); return; }
    }
    setBusy(true); setOperation('load'); setDownloadText(`Loading model with ${fmt(context)} context…`);
    try {
      await window.agent.request({ command: 'llama_model_load', model, context, reasoning });
    } catch (error) { setBusy(false); setOperation('idle'); notify(`Could not load GGUF: ${(error as Error).message}`, 'bad'); }
  }

  async function addSafetensorsToOllama() {
    let directory = downloadedDirectory;
    if (!directory) directory = await window.agent.chooseModelDirectory() || '';
    if (!directory) return;
    setBusy(true); setOperation('import'); setDownloadText(`Importing ${safetensorsName} into Ollama…`);
    try { await window.agent.request({ command: 'ollama_safetensors_import', directory, name: safetensorsName }); }
    catch (error) { setBusy(false); setOperation('idle'); notify(`Could not start Safetensors import: ${(error as Error).message}`, 'bad'); }
  }

  async function cancelOperation() {
    const command = operation === 'download' ? 'hf_download_cancel' : operation === 'load' ? 'llama_model_cancel' : operation === 'import' ? 'ollama_import_cancel' : null;
    if (!command) return;
    try { await window.agent.request({ command }); setDownloadText('Cancelling operation…'); }
    catch (error) { notify(`Could not cancel operation: ${(error as Error).message}`, 'bad'); }
  }

  const selectedBytes = files.filter((file) => selectedFiles.includes(file.path)).reduce((total, file) => total + (file.size || 0), 0);
  const isGguf = model.startsWith('gguf::');
  const runtimeRunning = runtime.running === true && runtime.model === model;
  return <Modal title="Model library" eyebrow="LOCAL RUNTIMES / HUGGING FACE" wide onClose={onClose}>
    <p className="modal-copy">Ollama models stay available as installed. Search Hugging Face, pin a revision, and download only the files you select. GGUF inference uses an explicitly configured llama.cpp server; the app never loads a model on launch.</p>
    <div className="library-runtime-card"><div><small>LLAMA.CPP SERVER</small><strong>{configuredBinary ? configuredBinary.split(/[\\/]/).at(-1) : 'Not configured'}</strong><span>{runtimeRunning ? `APP-OWNED · ${fmt(Number(runtime.effective_context ?? runtime.context))} ${runtime.effective_context == null ? 'configured' : 'effective'} context` : 'No app-owned GGUF server active'}</span></div><Button kind="outline" onClick={() => void chooseServer()}>{configuredBinary ? 'Change executable' : 'Choose executable'}</Button></div>
    <div className="library-toolbar"><Button kind="outline" onClick={() => void addLocalGguf()}>Add local GGUF</Button><Button kind="outline" onClick={() => void onRefresh()}>Refresh installed models</Button>{isGguf && <><Button kind="bright" disabled={busy} onClick={() => void loadSelectedGguf()}>{runtimeRunning ? 'Reload selected settings' : 'Load selected GGUF'}</Button>{runtimeRunning && <Button kind="danger" onClick={() => void window.agent.request({ command: 'llama_model_stop' }).then(() => { setRuntime((value) => ({ ...value, running: false })); notify('Stopped the app-owned llama.cpp server.'); })}>Stop app-owned model</Button>}</>}</div>
    <div className="library-current"><span>SELECTED MODEL</span><code>{modelLabels[model] || shortModel(model)}</code><span>Context {fmt(context)} · reasoning {reasoning == null ? 'default' : String(reasoning)}</span></div>
    <div className="settings-fields select-fields"><label className="settings-field"><span>Hugging Face model search</span><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchHub(); }} placeholder="Search model names or authors"/></label><div className="settings-field library-search-action"><span>Public and gated repositories</span><Button kind="bright" disabled={busy || !query.trim()} onClick={() => void searchHub()}>Search Hugging Face</Button></div></div>
    {results.length > 0 && <div className="library-columns"><div className="library-results">{results.map((row) => <button className={`library-result ${repo?.repo === row.repo ? 'selected' : ''}`} key={row.repo} onClick={() => void inspectRepo(row)}><strong>{row.repo}</strong><small>{fmt(row.downloads)} downloads · {row.gated ? 'gated' : 'public'} · {row.revision.slice(0, 10)}</small></button>)}</div>{repo && <div className="library-files"><div className="library-files-heading"><strong>{repo.repo}</strong><small>Revision {repo.revision}</small></div>{files.map((file) => <label className="library-file" key={file.path}><input type="checkbox" checked={selectedFiles.includes(file.path)} onChange={(event) => setSelectedFiles((current) => event.target.checked ? [...current, file.path] : current.filter((name) => name !== file.path))}/><span><b>{file.path}</b><small>{file.format.toUpperCase()} · {file.size == null ? 'size unknown' : `${(file.size / 1024 ** 3).toFixed(2)} GB`}</small></span></label>)}<div className="library-download-row"><span>{selectedFiles.length} file(s) · {(selectedBytes / 1024 ** 3).toFixed(2)} GB listed</span><Button kind="bright" disabled={busy || !selectedFiles.length} onClick={() => void downloadFiles()}>Download selected</Button></div></div>}</div>}
    {downloadText && <div className="library-progress" role="status"><span>{downloadText}</span>{['download', 'load', 'import'].includes(operation) && <Button kind="danger" onClick={() => void cancelOperation()}>Cancel operation</Button>}</div>}
    <div className="library-safetensors"><div><strong>Safetensors through Ollama</strong><small>Import a downloaded repository folder or choose a local model directory. Ollama accepts only supported architectures.</small></div><input aria-label="Ollama model name" value={safetensorsName} onChange={(event) => setSafetensorsName(event.target.value)} maxLength={64}/><Button kind="outline" disabled={busy} onClick={() => void addSafetensorsToOllama()}>Import directory</Button></div>
    <div className="modal-actions"><Button kind="quiet" onClick={onClose}>Close</Button></div>
  </Modal>;
}

function shortModel(value: string) { return value.startsWith('gguf::') ? value.slice('gguf::'.length).replaceAll('\\', '/').split('/').at(-1) || 'GGUF model' : value.split('/').at(-1) || value || 'No model selected'; }
function memoryPct(value: string) { const match = value.match(/([\d.]+)\s*\/\s*([\d.]+)/); return match ? Math.min(100, Number(match[1]) / Number(match[2]) * 100) : 0; }

function Modal({ title, eyebrow, children, onClose, wide = false, dismissible = true }: { title: string; eyebrow: string; children: React.ReactNode; onClose: () => void; wide?: boolean; dismissible?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (!dismissible && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } }}><section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>{dismissible && <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close"/></button>}<span className="eyebrow-line">{eyebrow}</span><h2>{title}</h2>{children}</section></div>;
}

function SettingsModal({ model, modelLabel, modelInfo, options, setOptions, activityDefault, setActivityDefault, activityMode, setActivityMode, askActivityChoice, setAskActivityChoice, hasSession, onClose, onSave, onMcp }: {
  model: string; modelLabel: string; modelInfo: ModelInfo | null; options: typeof initialOptions; setOptions: React.Dispatch<React.SetStateAction<typeof initialOptions>>;
  activityDefault: ActivityMode; setActivityDefault: (mode: ActivityMode) => void; activityMode: ActivityMode; setActivityMode: (mode: ActivityMode) => void;
  askActivityChoice: boolean; setAskActivityChoice: (ask: boolean) => void; hasSession: boolean;
  onClose: () => void; onSave: () => void; onMcp: () => void;
}) {
  const tokenPresets = buildTokenPresets({ contextLimit: modelInfo?.context ?? null, contextLimitKnown: modelInfo?.context_limit_known ?? false, outputLimit: modelInfo?.max_output_tokens ?? null });
  const reasoning = modelInfo?.reasoning;
  const reasoningValues: Array<boolean | string | null> = [null, ...(reasoning?.support === 'toggle' || reasoning?.support === 'levels' ? reasoning.values : [])];
  const selectedReasoningIndex = Math.max(0, reasoningValues.findIndex((value) => value === options.reasoning));
  const field = (label: string, value: number, key: 'context' | 'maxTokens' | 'temperature') => <label className="settings-field"><span>{label}</span><input type="number" value={value} min={key === 'context' ? 1024 : 1} max={key === 'temperature' ? 2 : undefined} step={key === 'temperature' ? 0.1 : 1} onChange={(e) => setOptions((old) => ({ ...old, [key]: key === 'temperature' ? Number(e.target.value) : Number.parseInt(e.target.value || '0', 10) }))}/></label>;
  return <Modal title="Run configuration" eyebrow="MODEL / EXECUTION" onClose={onClose}>
    <div className="setting-model-strip"><span className="picker-symbol"><Icon name="spark"/></span><span><small>SELECTED MODEL</small><strong title={model}>{modelLabel}</strong><i>{reasoning?.support === 'levels' || reasoning?.support === 'toggle' ? 'Reasoning values reported by runtime' : 'Reasoning controls unavailable; model default is preserved'}</i></span></div>
    <div className="settings-fields"><label className="settings-field"><span>Context window preset{tokenPresets.contextLimitKnown ? '' : ' · model maximum unknown'}</span><select value={tokenPresets.context.some((preset) => preset.value === options.context) ? String(options.context) : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setOptions((old) => ({ ...old, context: Number(e.target.value) })); }}><option value="custom">Custom value</option>{tokenPresets.context.map((preset) => <option key={preset.value} value={preset.value} disabled={preset.disabled}>{preset.label}{preset.disabled ? ' · exceeds model limit' : ''}</option>)}</select></label>{field('Context tokens · custom', options.context, 'context')}{<label className="settings-field"><span>Maximum output preset{tokenPresets.outputLimitKnown ? '' : ' · provider maximum unknown'}</span><select value={tokenPresets.output.some((preset) => preset.value === options.maxTokens) ? String(options.maxTokens) : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setOptions((old) => ({ ...old, maxTokens: Number(e.target.value) })); }}><option value="custom">Custom value</option>{tokenPresets.output.map((preset) => <option key={preset.value} value={preset.value} disabled={preset.disabled}>{preset.label}{preset.disabled ? ' · exceeds supported limit' : ''}</option>)}</select></label>}{field('Maximum output tokens · custom', options.maxTokens, 'maxTokens')}{field('Temperature', options.temperature, 'temperature')}</div>
    <label className="settings-field"><span>Reasoning</span><select value={String(selectedReasoningIndex)} onChange={(e) => { const value = reasoningValues[Number(e.target.value)] ?? null; setOptions((old) => ({ ...old, reasoning: normalizeReasoningChoice(value, reasoning ?? null) })); }}><option value="0">Model default</option>{reasoningValues.slice(1).map((value, index) => <option key={`${typeof value}-${String(value)}-${index}`} value={index + 1}>{typeof value === 'boolean' ? value ? 'On' : 'Off' : value}</option>)}</select><small>{reasoning ? `Model default: ${String(reasoning.default ?? 'not reported')}` : 'The model did not report reasoning controls; no override will be sent.'}</small></label>
    <div className="context-facts"><span>Advertised maximum <b>{modelInfo?.context_limit_known ? fmt(modelInfo.context ?? undefined) : 'Unknown'}</b></span><span>Runtime context <b>{modelInfo?.effective_context ? fmt(modelInfo.effective_context) : modelInfo?.provider === 'llama.cpp' ? 'Not loaded / allocation unverified' : 'Shown in the task signal panel'}</b></span></div>
    <label className="settings-field"><span>Keep model warm after a request</span><select value={options.keepAlive} onChange={(e) => setOptions((old) => ({ ...old, keepAlive: e.target.value }))}><option value="30m">30 minutes</option><option value="10m">10 minutes</option><option value="5m">5 minutes</option><option value="0">Unload when idle (Ollama setting)</option></select></label>
    <div className="settings-fields select-fields"><label className="settings-field"><span>File access</span><select value={options.access} onChange={(e) => setOptions((old) => ({ ...old, access: e.target.value as AccessMode }))}><option value="copy">Copy workspace</option><option value="plan">Plan only</option><option value="ask">Ask before writes</option><option value="edit">Edit project</option></select></label><label className="settings-field"><span>Approval</span><select value={options.approvalMode} onChange={(e) => setOptions((old) => ({ ...old, approvalMode: e.target.value as ApprovalMode }))}><option value="per-action">Approve each action</option><option value="per-task">Approve for this task</option><option value="auto">Auto-approve actions · this run</option></select>{options.approvalMode === 'auto' && <small className="auto-approve-warning">Automatically approves project tool actions for this run. Workspace boundaries and access mode remain in force.</small>}</label></div>
    <label className="settings-field"><span>Harness workflow</span><select value={options.harnessProfile} onChange={(e) => setOptions((old) => ({ ...old, harnessProfile: e.target.value as HarnessProfile }))}><option value="standard">Standard</option><option value="small-model">Small-model workflow</option></select><small>Small-model workflow asks the agent to take shorter, sequential tool steps and inspect each result. It does not change model, context, output tokens, reasoning, temperature, access, or approvals.</small></label>
    <div className="settings-fields select-fields"><label className="settings-field"><span>App-wide activity default</span><select value={activityDefault} onChange={(event) => setActivityDefault(event.target.value as ActivityMode)}><option value="compact">Compact cards · expandable</option><option value="sidebar">Activity sidebar only</option><option value="inline">Full inline output</option></select></label>{hasSession && <label className="settings-field"><span>This session activity view</span><select value={activityMode} onChange={(event) => setActivityMode(event.target.value as ActivityMode)}><option value="compact">Compact cards · expandable</option><option value="sidebar">Activity sidebar only</option><option value="inline">Full inline output</option></select></label>}</div>
    <label className="activity-choice-toggle"><input type="checkbox" checked={askActivityChoice} onChange={(event) => setAskActivityChoice(event.target.checked)}/><span><b>Choose an activity view for each new session</b><small>When off, new sessions use the app-wide default.</small></span></label>
    <div className="settings-bottom"><Button kind="outline" onClick={onMcp}>Configure local MCP</Button><span>Context is never silently reduced.</span></div>
    <div className="modal-actions"><Button kind="quiet" onClick={onClose}>Cancel</Button><Button kind="bright" onClick={onSave}>Apply to this session</Button></div>
  </Modal>;
}

function ApprovalModal({ approval, onChoice, onCancelRun }: { approval: Approval; onChoice: (value: boolean) => void; onCancelRun: () => void }) {
  return <Modal title={approval.name.replaceAll('_', ' ')} eyebrow="ACTION NEEDS YOUR REVIEW" wide dismissible={false} onClose={() => undefined}>
    <p className="modal-copy">The agent requested an action under <b>{approval.mode === 'per-task' ? 'per-task' : 'per-action'} approval</b>. Review the exact arguments and selected workspace, then choose an action.</p>
    <div className="approval-context"><span>WORKSPACE</span><code>{approval.workspace}</code></div>
    <pre className="diff-view approval-preview">{JSON.stringify(approval.arguments, null, 2)}</pre>
    <div className="modal-actions"><Button kind="quiet" onClick={onCancelRun}>Cancel task</Button><Button kind="outline" onClick={() => onChoice(false)}>Deny action</Button><Button kind="bright" onClick={() => onChoice(true)}>Approve {approval.mode === 'per-task' ? 'task' : 'action'}</Button></div>
  </Modal>;
}
