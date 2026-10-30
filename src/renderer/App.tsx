import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { AccessMode, ApprovalMode, ModelInfo, ProjectFile, RunOptions, SessionSummary, WorkerCommand, WorkerEvent } from '../shared/protocol';
import { nextRunPhase } from '../shared/run-state';
import { addGenerationUsage, beginGeneration, emptyRunMetrics, endGeneration, estimateOutputTokens, liveOutputTokensPerSecond, outputTokensAreEstimated, recordFirstToken, recordStreamedText, type RunMetrics } from '../shared/run-metrics';

type ChatMessage = { role: 'user' | 'assistant'; content: string; streaming?: boolean };
type Session = {
  session_id: string;
  workspace: string;
  model: string;
  context: number;
  messages: Array<{ role: string; content?: string; tool_calls?: unknown[] }>;
  access?: AccessMode;
  approval_mode?: ApprovalMode;
  max_tokens?: number;
  temperature?: number;
  keep_alive?: string;
  working_workspace?: string;
  copy_manifest?: Record<string, string>;
};
type TraceRow = { id: string; title: string; description?: string; kind: 'tool' | 'status' | 'plan'; time: number };
type Approval = { actionId: string; name: string; arguments: unknown; workspace: string; mode: ApprovalMode };
type Notice = { tone: 'good' | 'warn' | 'bad'; text: string };

const DEFAULT_MODEL = 'hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M';
const initialOptions = {
  context: 8192,
  maxTokens: 4096,
  temperature: 0.2,
  keepAlive: '30m',
  access: 'ask' as AccessMode,
  approvalMode: 'per-action' as ApprovalMode,
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

function Markdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>;
}

export default function App() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [workspace, setWorkspace] = useState(localStorage.getItem('agent-workspace') || '');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [trace, setTrace] = useState<TraceRow[]>([]);
  const [plan, setPlan] = useState<Array<{ title?: string; text?: string; status?: string }>>([]);
  const [diff, setDiff] = useState('');
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [mcpJson, setMcpJson] = useState('{"mcpServers":{}}');
  const [options, setOptions] = useState(initialOptions);
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
      const rows = await request<string[]>({ command: 'models' });
      setModels(rows);
      setConnected('yes');
      setModel((current) => current && rows.includes(current) ? current : rows.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : rows[0] || '');
      if (!rows.length) notify('Ollama is connected, but no models are installed.', 'warn');
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

  const showProject = useCallback(async (root: string) => {
    try {
      const filesResult = await request<ProjectFile[]>({ command: 'workspace_files', workspace: root });
      setWorkspace(root);
      localStorage.setItem('agent-workspace', root);
      setFiles(filesResult);
      setSessions(await request<SessionSummary[]>({ command: 'sessions_list', workspace: root }));
      setSession(null);
      setMessages([]);
      setView('project');
      setProjectTab('overview');
    } catch (error) { notify(`Could not open project: ${(error as Error).message}`, 'bad'); }
  }, [notify, request]);

  const loadSession = useCallback(async (id: string) => {
    try {
      const loaded = await request<Session>({ command: 'session_resume', sessionId: id });
      const root = loaded.workspace;
      const rows: ChatMessage[] = loaded.messages.filter((row) => (row.role === 'user' || row.role === 'assistant') && row.content)
        .map((row) => ({ role: row.role as ChatMessage['role'], content: row.content || '' }));
      setWorkspace(root);
      localStorage.setItem('agent-workspace', root);
      setSession(loaded);
      setMessages(rows);
      setOptions({
        context: loaded.context || modelInfo?.context || 8192,
        maxTokens: loaded.max_tokens || 4096,
        temperature: loaded.temperature ?? 0.2,
        keepAlive: loaded.keep_alive || '30m',
        access: loaded.access || 'ask',
        approvalMode: loaded.approval_mode || 'per-action',
      });
      setContextTouched(true);
      setSettingsTouched(true);
      setView('session');
      setSessions(await request<SessionSummary[]>({ command: 'sessions_list', workspace: root }));
    } catch (error) { notify(`Could not resume session: ${(error as Error).message}`, 'bad'); }
  }, [modelInfo?.context, notify, request]);

  useEffect(() => {
    void refreshModels();
    void request({ command: 'ping' }).then(() => setInstalled(true)).catch(() => setInstalled(false));
    const unsubscribe = window.agent.onEvent((event) => {
      if (event.type === 'service_ready') setInstalled(true);
      if (event.type === 'service_error' || event.type === 'service_exit') {
        setInstalled(false);
        notify(String(event.error || 'Agent service stopped.'), 'bad');
      }
      if (event.type === 'service_log') console.info('[agent service]', event.text);
      if (event.type === 'phase') {
        setPhase((current) => nextRunPhase(current, event));
        if (event.phase === 'generating') setRunMetrics((current) => beginGeneration(recordFirstToken(current, event.elapsed)));
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
      if (event.type === 'tool_start') {
        setTrace((current) => [...current, { id: crypto.randomUUID(), title: `Using ${String(event.name || 'tool')}`, description: JSON.stringify(event.arguments || {}, null, 2), kind: 'tool', time: Date.now() }]);
      }
      if (event.type === 'tool_done') {
        setTrace((current) => [...current, { id: crypto.randomUUID(), title: `${String(event.name || 'Tool')} returned`, description: String(event.result || '').slice(0, 1000), kind: 'tool', time: Date.now() }]);
      }
      if (event.type === 'plan') {
        const items = Array.isArray(event.items) ? event.items as typeof plan : [];
        setPlan(items);
        setTrace((current) => [...current, { id: crypto.randomUUID(), title: 'Plan updated', description: `${items.length} steps`, kind: 'plan', time: Date.now() }]);
      }
      if (event.type === 'approval_request') {
        setApproval({ actionId: String(event.actionId), name: String(event.name), arguments: event.arguments, workspace: String(event.workspace), mode: event.mode === 'per-task' ? 'per-task' : 'per-action' });
      }
      if (event.type === 'session_saved') {
        const root = String(event.workspace || workspace);
        if (root) void request<SessionSummary[]>({ command: 'sessions_list', workspace: root }).then(setSessions).catch(() => undefined);
      }
      if (event.type === 'generation_complete') {
        setPhase((current) => nextRunPhase(current, event));
      }
      if (event.type === 'generation_usage') setRunMetrics((current) => addGenerationUsage(current, event.usage));
      if (event.type === 'complete') {
        setRunning(false); setPhase((current) => nextRunPhase(current, event));
        setRunMetrics((current) => endGeneration(current));
        setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
      }
      if (event.type === 'cancelled') {
        setRunning(false); setPhase((current) => nextRunPhase(current, event)); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setRunMetrics((current) => endGeneration(current));
        notify('This request was cancelled. Ollama and the model were left alone.', 'warn');
      }
      if (event.type === 'error') {
        setRunning(false); setPhase((current) => nextRunPhase(current, event)); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setRunMetrics((current) => endGeneration(current));
        notify(String(event.error || 'The task failed.'), 'bad');
      }
      if (event.type === 'run_idle') {
        setRunning(false);
        setRunMetrics((current) => endGeneration(current));
        setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setPhase((current) => nextRunPhase(current, event));
      }
      if (event.type === 'mcp_status') notify(String(event.text), event.text && String(event.text).startsWith('MCP unavailable') ? 'warn' : 'good');
      if (event.type === 'load_warn') notify(String(event.text), 'warn');
      if (event.type === 'context_limit') notify(String(event.error), 'bad');
    });
    return unsubscribe;
  }, [notify, request, workspace]);

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
      if (!contextTouched && !session && !settingsTouched) setOptions((old) => ({ ...old, context: value.context }));
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
    return {
      cpu: typeof snapshot.cpu_percent === 'number' ? Math.round(snapshot.cpu_percent) : null,
      ram: typeof snapshot.ram_total_bytes === 'number' && typeof snapshot.ram_available_bytes === 'number'
        ? `${((snapshot.ram_total_bytes - snapshot.ram_available_bytes) / 1024 ** 3).toFixed(1)} / ${(snapshot.ram_total_bytes / 1024 ** 3).toFixed(0)} GB` : '—',
      gpu: typeof snapshot.gpu === 'string' ? snapshot.gpu.split(',')[0].trim() : 'GPU status unavailable',
      loadedContext: active && typeof active.context_length === 'number' ? active.context_length : null,
      contextMismatch: Boolean(active && typeof active.context_length === 'number' && active.context_length < options.context),
      serviceRss: typeof snapshot.service_rss_bytes === 'number' ? `${(snapshot.service_rss_bytes / 1024 ** 3).toFixed(2)} GB` : '—',
      serviceCpu: typeof snapshot.service_cpu_percent === 'number' ? Math.round(snapshot.service_cpu_percent) : null,
    };
  }, [model, options.context, snapshot]);

  async function chooseWorkspace() {
    const selected = await window.agent.chooseWorkspace();
    if (selected) await showProject(selected);
  }

  async function newSession() {
    if (!workspace) { await chooseWorkspace(); return; }
    try {
      const selectedModel = model || DEFAULT_MODEL;
      const configuredContext = !contextTouched && !settingsTouched
        ? (await request<ModelInfo>({ command: 'model_info', model: selectedModel })).context
        : options.context;
      const created = await request<Session>({ command: 'session_new', workspace, model: selectedModel, context: configuredContext });
      setSession(created); setMessages([]); setTrace([]); setPlan([]); setPrompt(''); setElapsed(0); setPhase('Ready'); setView('session');
      setRunMetrics(emptyRunMetrics());
      setOptions((old) => ({ ...old, context: created.context }));
      void refreshWorkspace(workspace);
      window.setTimeout(() => promptRef.current?.focus(), 60);
    } catch (error) { notify(`Could not start a session: ${(error as Error).message}`, 'bad'); }
  }

  async function startRun() {
    if (running || !session || !workspace || !model || !prompt.trim()) return;
    const task = prompt.trim();
    const run: RunOptions = {
      workspace, sessionId: session.session_id, prompt: task, model,
      context: options.context, maxTokens: options.maxTokens, temperature: options.temperature,
      access: options.access, approvalMode: options.approvalMode, keepAlive: options.keepAlive,
    };
    setMessages((current) => [...current, { role: 'user', content: task }]);
    setTrace([]); setPlan([]); setPrompt(''); setRunning(true); setPhase('Connecting to Ollama');
    setStartedAt(Date.now()); setElapsed(0); setRunMetrics(emptyRunMetrics());
    try { await request({ command: 'run_start', options: run }); }
    catch (error) { setRunning(false); setPhase('Run failed'); notify((error as Error).message, 'bad'); }
  }

  async function cancelRun() {
    try { await request({ command: 'run_cancel' }); setPhase('Cancelling request'); }
    catch (error) { notify(`Could not cancel: ${(error as Error).message}`, 'bad'); }
  }

  async function answerApproval(approved: boolean) {
    if (!approval) return;
    const action = approval;
    setApproval(null);
    try { await request({ command: 'approval_reply', actionId: action.actionId, approved }); }
    catch (error) { notify((error as Error).message, 'bad'); }
  }

  async function showDiff() {
    if (!workspace) return;
    try {
      if (session?.access === 'copy') setCopyChanges(await request({ command: 'copy_review', sessionId: session.session_id }));
      else setDiff((await request<{ text: string }>({ command: 'workspace_diff', workspace })).text);
      setDiffOpen(true);
    } catch (error) { notify(`Could not load changes: ${(error as Error).message}`, 'bad'); }
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
    setSettingsOpen(false);
    if (session) {
      setSession({ ...session, model, context: options.context, access: options.access, approval_mode: options.approvalMode, max_tokens: options.maxTokens, temperature: options.temperature, keep_alive: options.keepAlive });
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
          {!models.length && <option value="">Waiting for Ollama</option>}{models.map((name) => <option value={name} key={name}>{name}</option>)}
        </select></label>
      </div>
      <div className={`connection-pill no-drag ${connected}`}><span className="connection-light"/>{connected === 'yes' ? 'OLLAMA READY' : connected === 'no' ? 'OLLAMA OFFLINE' : 'CHECKING'}</div>
      <Button kind="quiet" className="top-settings no-drag" onClick={() => setSettingsOpen(true)}>Settings <span className="keycap">CTRL ,</span></Button>
    </header>

    <main className="main-stage">
      {view === 'landing' && <Landing
        workspace={workspace} sessions={sessions} models={models} model={model} context={options.context}
        connected={connected} telemetry={telemetry} onChoose={chooseWorkspace} onOpen={showProject}
        onResume={loadSession} onModel={(name) => { setModel(name); setContextTouched(false); setSettingsTouched(false); }} onRefresh={() => { void refreshModels(); }}
      />}
      {view === 'project' && <ProjectHome
        root={workspace} tab={projectTab} setTab={setProjectTab} files={availableFiles} sessions={currentSessions}
        onNew={newSession} onOpenSession={loadSession} onFiles={() => void refreshWorkspace(workspace)}
        onDiff={showDiff} onMcp={openMcp} running={running}
      />}
      {view === 'session' && <SessionRoom
        root={workspace} session={session} messages={messages} trace={trace} plan={plan} phase={phase}
        elapsed={elapsed} running={running} prompt={prompt} setPrompt={setPrompt} promptRef={promptRef}
        options={options} setOptions={setOptions} files={availableFiles} telemetry={telemetry}
        runMetrics={runMetrics} onRun={startRun} onCancel={cancelRun} onSettings={() => setSettingsOpen(true)} onBack={() => { if (!running) setView('project'); }}
        onDiff={showDiff} onMcp={openMcp} onEnter={enter} endRef={endRef} model={model}
      />}
    </main>

    <footer className="system-ribbon">
      <div className="ribbon-left"><span className={`ribbon-state ${installed ? 'live' : 'dim'}`}/><span>{installed ? 'ENGINE BRIDGE READY' : 'STARTING LOCAL BRIDGE'}</span><span className="ribbon-sep">/</span><span>REASONING: MODEL DEFAULT</span></div>
      <div className="ribbon-metrics"><span><Icon name="cpu"/> SYS {telemetry.cpu == null ? '—' : `${telemetry.cpu}%`}</span><span><Icon name="memory"/> RAM {telemetry.ram}</span><span className="gpu-readout">{telemetry.gpu}</span></div>
      <button className="ribbon-link" onClick={() => void request<Record<string, unknown>>({ command: 'system_snapshot' }).then(setSnapshot)}>DIAGNOSTICS <Icon name="arrow"/></button>
    </footer>

    {notice && <div className={`toast toast-${notice.tone}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)}><Icon name="close"/></button></div>}
    {settingsOpen && <SettingsModal model={model} modelInfo={modelInfo} options={options} setOptions={setOptions} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onMcp={openMcp} />}
    {mcpOpen && <Modal title="Local MCP connections" eyebrow="TOOL BRIDGE" onClose={() => setMcpOpen(false)}>
      <p className="modal-copy">Each server starts as a local stdio process. Add only commands you trust. Tool calls require approval.</p>
      <textarea className="code-editor mcp-editor" value={mcpJson} onChange={(e) => setMcpJson(e.target.value)} spellCheck={false}/>
      <div className="modal-actions"><Button kind="quiet" onClick={() => setMcpOpen(false)}>Cancel</Button><Button kind="bright" onClick={() => void saveMcp()}>Save connections</Button></div>
    </Modal>}
    {approval && <ApprovalModal approval={approval} onChoice={(yes) => void answerApproval(yes)} />}
    {diffOpen && <Modal title={session?.access === 'copy' ? 'Review proposed changes' : 'Project changes'} eyebrow="CHANGE REVIEW" wide onClose={() => setDiffOpen(false)}>
      {session?.access === 'copy' ? <>
        <p className="modal-copy">These changes are in a disposable project copy. Select conflict-free files to apply them to the source workspace.</p>
        <div className="change-list">{copyChanges.length ? copyChanges.map((change) => <label className={`change-row ${change.conflict ? 'conflict' : ''}`} key={change.path}>
          <input type="checkbox" disabled={change.conflict} checked={selectedChanges.includes(change.path)} onChange={(e) => setSelectedChanges((list) => e.target.checked ? [...list, change.path] : list.filter((path) => path !== change.path))}/>
          <span className={`change-action ${change.action}`}>{change.action}</span><code>{change.path}</code>{change.conflict && <small>{change.reason || 'Conflict'}</small>}
        </label>) : <div className="empty-state">No reviewable changes in the working copy.</div>}</div>
        <div className="modal-actions"><Button kind="quiet" onClick={() => setDiffOpen(false)}>Close review</Button><Button kind="bright" disabled={!selectedChanges.length} onClick={() => void applyCopyChanges()}>Apply selected to source</Button></div>
      </> : <><pre className="diff-view">{diff || 'No unstaged Git changes.'}</pre><div className="modal-actions"><Button kind="quiet" onClick={() => setDiffOpen(false)}>Done</Button></div></>}
    </Modal>}
  </div>;
}

function Landing({ workspace, sessions, models, model, context, connected, telemetry, onChoose, onOpen, onResume, onModel, onRefresh }: {
  workspace: string; sessions: SessionSummary[]; models: string[]; model: string; context: number; connected: string;
  telemetry: { cpu: number | null; ram: string; gpu: string; serviceRss: string; serviceCpu: number | null };
  onChoose: () => void; onOpen: (root: string) => void; onResume: (id: string) => void; onModel: (name: string) => void; onRefresh: () => void;
}) {
  const recentProjects = useMemo(() => [...new Set([workspace, ...sessions.map((row) => row.workspace)].filter(Boolean))].slice(0, 4), [sessions, workspace]);
  return <section className="landing-view">
    <div className="landing-grid">
      <div className="landing-copy">
        <div className="eyebrow-line"><span className="eyebrow-mark"/> PRIVATE DEVELOPMENT / LOCAL FIRST</div>
        <h1>Give the model<br/><span>room to work.</span></h1>
        <p className="landing-description">A development desk for patient local agents. Keep the full project in view, see what the model is doing, and decide what reaches your files.</p>
        <div className="launch-actions"><Button kind="bright" onClick={onChoose}><Icon name="folder"/> Open a project <Icon name="arrow"/></Button><span className="launch-note"><kbd>CTRL</kbd> <b>+</b> <kbd>O</kbd> to switch workspaces</span></div>
        <div className="landing-stats"><div><small>INSTALLED MODELS</small><strong>{String(models.length).padStart(2, '0')}</strong></div><div><small>ACTIVE CONTEXT</small><strong>{fmt(context)} <i>tokens</i></strong></div><div><small>LOCAL ENGINE</small><strong className={connected === 'yes' ? 'text-mint' : connected === 'no' ? 'text-rose' : ''}>{connected === 'yes' ? 'ONLINE' : connected === 'no' ? 'OFFLINE' : 'CHECKING'}</strong></div></div>
      </div>
      <div className="landing-visual" aria-hidden="true">
        <div className="visual-orbit orbit-a"/><div className="visual-orbit orbit-b"/><div className="visual-orbit orbit-c"/>
        <div className="visual-core"><span>LOCAL</span><strong>9B</strong><small>WORKS IN YOUR SPACE</small></div>
        <div className="orbit-label label-tl"><i/> PRIVATE BY DEFAULT</div><div className="orbit-label label-br"><i/> NO REMOTE ROUTING</div>
        <div className="visual-coordinate">[LOCATION REMOVED]<br/>[LOCATION REMOVED]</div>
      </div>
    </div>
    <div className="landing-lower">
      <div className="landing-column">
        <div className="section-heading"><div><span className="section-number">01</span><h2>Recent workspaces</h2></div><button onClick={onRefresh}><Icon name="refresh"/> Refresh</button></div>
        {recentProjects.length ? <div className="project-tiles">{recentProjects.map((root) => <button key={root} className="project-tile" onClick={() => onOpen(root)}><span className="tile-glyph"><Icon name="folder"/></span><span><strong>{shortPath(root)}</strong><small>{root}</small></span><Icon name="arrow"/></button>)}</div> : <div className="empty-inline"><span className="empty-art"><Icon name="folder"/></span><span><b>No workspace has been opened here yet.</b><small>Choose a project folder to create your first local work session.</small></span></div>}
      </div>
      <div className="landing-column engine-column">
        <div className="section-heading"><div><span className="section-number">02</span><h2>Inference source</h2></div><span className={`source-status ${connected}`}>{connected === 'yes' ? 'REACHABLE' : connected === 'no' ? 'OFFLINE' : 'CHECKING'}</span></div>
        <label className="model-picker-card"><span className="picker-symbol"><Icon name="spark"/></span><span className="picker-content"><small>OLLAMA MODEL</small><select value={model} onChange={(e) => onModel(e.target.value)}>{!models.length && <option value="">No installed models</option>}{models.map((name) => <option key={name}>{name}</option>)}</select><span>Model reasoning stays at its own default.</span></span><Icon name="chevron"/></label>
        <div className="engine-foot"><span><Icon name="cpu"/> {telemetry.serviceCpu == null ? 'SERVICE READY' : `SERVICE ${telemetry.serviceCpu}% CPU`}</span><span><Icon name="memory"/> {telemetry.serviceRss} SIDECAR</span><span>{sessions.length} SAVED SESSIONS</span></div>
      </div>
    </div>
  </section>;
}

function ProjectHome({ root, tab, setTab, files, sessions, onNew, onOpenSession, onFiles, onDiff, onMcp, running }: {
  root: string; tab: 'overview' | 'files' | 'sessions'; setTab: (value: 'overview' | 'files' | 'sessions') => void;
  files: ProjectFile[]; sessions: SessionSummary[]; onNew: () => void; onOpenSession: (id: string) => void;
  onFiles: () => void; onDiff: () => void; onMcp: () => void; running: boolean;
}) {
  const textFiles = files.filter((row) => row.text).length;
  return <section className="project-view">
    <div className="project-identity">
      <div className="project-monogram">{shortPath(root).slice(0, 2).toUpperCase()}</div>
      <div className="project-title"><span className="eyebrow-line"><span className="eyebrow-mark"/> ACTIVE PROJECT</span><h1>{shortPath(root)}</h1><p title={root}>{root}</p></div>
      <div className="project-identity-actions"><Button kind="outline" onClick={onMcp}>MCP connections</Button><Button kind="outline" onClick={onDiff}>Review Git changes</Button><Button kind="bright" disabled={running} onClick={onNew}><Icon name="plus"/> Start a task</Button></div>
    </div>
    <nav className="project-tabs">{(['overview', 'files', 'sessions'] as const).map((item, index) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); if (item === 'files') onFiles(); }}><span>0{index + 1}</span>{item}</button>)}</nav>
    {tab === 'overview' && <div className="project-overview">
      <div className="overview-main">
        <div className="overview-welcome"><span className="eyebrow-line">WORKING DIRECTORY / VERIFIED</span><h2>Pick up where<br/>the work is.</h2><p>The agent’s tools are scoped to this project for every turn. Session history stays associated with this exact folder.</p><Button kind="bright" onClick={onNew}><Icon name="plus"/> Create a new task</Button></div>
        <div className="workspace-facts"><div><small>VISIBLE FILES</small><strong>{fmt(files.length)}</strong></div><div><small>TEXT FILES</small><strong>{fmt(textFiles)}</strong></div><div><small>SAVED SESSIONS</small><strong>{fmt(sessions.length)}</strong></div></div>
      </div>
      <div className="recent-session-card"><div className="section-heading"><div><span className="section-number">03</span><h2>Recent sessions</h2></div><button onClick={() => setTab('sessions')}>All sessions <Icon name="arrow"/></button></div>
        {sessions.slice(0, 5).map((row, index) => <button className="session-tile" key={row.session_id} onClick={() => onOpenSession(row.session_id)}><span className="session-index">{String(index + 1).padStart(2, '0')}</span><span><strong>Session {row.session_id.slice(-8)}</strong><small>{row.model}</small></span><time>{new Date(row.updated_at * 1000).toLocaleDateString()}</time><Icon name="arrow"/></button>)}
        {!sessions.length && <div className="empty-inline compact"><span><b>No sessions for this folder yet.</b><small>Your first task will create a resumable session.</small></span></div>}
      </div>
      <div className="project-capabilities"><div><Icon name="branch"/><span><b>Project boundary</b><small>File tools stay under this root.</small></span></div><div><Icon name="terminal"/><span><b>Reviewable actions</b><small>Commands and risky writes ask first.</small></span></div><div><Icon name="clock"/><span><b>Local history</b><small>Sessions can be resumed at any time.</small></span></div></div>
    </div>}
    {tab === 'files' && <div className="project-file-list"><div className="section-heading"><div><span className="section-number">04</span><h2>Indexed project files</h2></div><span>{files.length} entries</span></div>{files.map((file) => <div className="file-row" key={file.path}><span className={`file-glyph ${file.text ? 'text-file' : ''}`}>{file.text ? 'Aa' : '▧'}</span><code>{file.path}</code><small>{file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}</small></div>)}</div>}
    {tab === 'sessions' && <div className="project-file-list"><div className="section-heading"><div><span className="section-number">05</span><h2>Saved sessions</h2></div><span>{sessions.length} sessions</span></div>{sessions.map((row) => <button className="session-tile full-session" key={row.session_id} onClick={() => onOpenSession(row.session_id)}><span className="session-index"><Icon name="clock"/></span><span><strong>Session {row.session_id}</strong><small>{row.model}</small></span><time>{new Date(row.updated_at * 1000).toLocaleString()}</time><Icon name="arrow"/></button>)}</div>}
  </section>;
}

function SessionRoom({ root, session, messages, trace, plan, phase, elapsed, running, prompt, setPrompt, promptRef, options, setOptions, files, telemetry, runMetrics, onRun, onCancel, onSettings, onBack, onDiff, onMcp, onEnter, endRef, model }: {
  root: string; session: Session | null; messages: ChatMessage[]; trace: TraceRow[]; plan: Array<{ title?: string; text?: string; status?: string }>;
  phase: string; elapsed: number; running: boolean; prompt: string; setPrompt: (value: string) => void;
  promptRef: React.RefObject<HTMLTextAreaElement | null>; options: typeof initialOptions;
  setOptions: React.Dispatch<React.SetStateAction<typeof initialOptions>>; files: ProjectFile[];
  telemetry: { cpu: number | null; ram: string; gpu: string; loadedContext: number | null; contextMismatch: boolean; serviceRss: string; serviceCpu: number | null };
  runMetrics: RunMetrics;
  onRun: () => void; onCancel: () => void; onSettings: () => void; onBack: () => void; onDiff: () => void; onMcp: () => void;
  onEnter: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; endRef: React.RefObject<HTMLDivElement | null>; model: string;
}) {
  const phaseKey = phase.toLowerCase();
  const steps = ['Ready', 'Waiting for first token', 'Generating', 'Finishing turn'];
  const currentStep = phaseKey.includes('waiting') ? 1 : phaseKey.includes('generat') ? 2 : phaseKey.includes('finish') ? 3 : running ? 1 : 0;
  return <section className="session-view">
    <div className="session-commandline"><button className="crumb-back" onClick={onBack}>PROJECT / {shortPath(root).toUpperCase()}</button><span className="crumb-slash">/</span><span className="session-crumb">SESSION {session?.session_id.slice(-8).toUpperCase()}</span><span className="commandline-spacer"/><button className="inline-command" onClick={onMcp}>MCP</button><button className="inline-command" onClick={onDiff}>CHANGES</button><span className={`phase-chip ${running ? 'is-running' : ''}`}><i/>{running ? phase.toUpperCase() : phase.toUpperCase()}</span><span className="run-elapsed"><Icon name="clock"/> {running ? secs(elapsed) : '—'}</span></div>
    <div className="task-route" aria-label="Task execution phases">{steps.map((step, index) => <div className={`route-step ${index < currentStep ? 'done' : ''} ${index === currentStep ? 'current' : ''}`} key={step}><span className="route-node">{index < currentStep ? <Icon name="check"/> : `0${index + 1}`}</span><span>{step === 'Waiting for first token' ? 'Prefill / waiting' : step}</span></div>)}</div>
    <div className="session-main-grid">
      <section className="transcript-plane" aria-label="Conversation transcript">
        {!messages.length ? <div className="transcript-empty"><div className="empty-symbol"><Icon name="spark"/></div><span className="eyebrow-line">NEW WORK UNIT / {shortPath(root).toUpperCase()}</span><h2>What should we<br/>work through?</h2><p>The model sees selected, relevant project files as needed. You control any action that can change the workspace.</p><div className="starter-prompts"><button onClick={() => setPrompt('Inspect this project and explain its architecture and how to run it.')}>Map the project <Icon name="arrow"/></button><button onClick={() => setPrompt('Review this project for the highest-priority bug and propose a fix.')}>Find a bug <Icon name="arrow"/></button><button onClick={() => setPrompt('Add a focused feature to this project and verify it with the existing tests.')}>Build a feature <Icon name="arrow"/></button></div></div> : <div className="message-list">{messages.map((message, index) => <article className={`message-card message-${message.role}`} key={`${index}-${message.role}`}>
          <div className="message-meta"><span className={`speaker-mark ${message.role}`}>{message.role === 'user' ? 'YOU' : <Icon name="spark"/>}</span><strong>{message.role === 'user' ? 'Task brief' : 'Local agent'}</strong><span>{message.role === 'user' ? 'INPUT' : message.streaming ? 'LIVE OUTPUT' : 'RESPONSE'}</span>{message.streaming && <i className="stream-pulse"/>}</div>
          <div className="message-content"><Markdown content={message.content}/></div>
        </article>)}<div ref={endRef}/></div>}
        <div className="composer-shell">
          <div className="composer-profile"><span className={`profile-chip access-${options.access}`}>{options.access.toUpperCase()}</span><span className="profile-chip approval-chip">{options.approvalMode === 'per-task' ? 'PER TASK' : 'PER ACTION'}</span><span className="profile-hint">{fmt(options.context)} context · {fmt(options.maxTokens)} output</span><button onClick={onSettings}>Adjust run</button></div>
          <textarea ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onEnter} placeholder="Describe the work. Use Shift + Enter to add detail…" rows={3} disabled={running} aria-label="Task prompt"/>
          <div className="composer-bottom"><span><kbd>ENTER</kbd> to run <b>·</b> <kbd>SHIFT ENTER</kbd> for a new line <b>·</b> reasoning left at model default</span>{running ? <Button kind="danger" onClick={onCancel}><Icon name="stop"/> Cancel request</Button> : <Button kind="bright" onClick={onRun} disabled={!prompt.trim()}><Icon name="play"/> Run task</Button>}</div>
        </div>
      </section>
      <aside className="run-sheet">
        <div className="run-sheet-heading"><div><span className="eyebrow-line">LIVE WORK SHEET</span><h2>Task signals</h2></div><span className={`run-lamp ${running ? 'active' : ''}`}/></div>
        <div className="signal-matrix"><div className={`signal-card signal-wide ${telemetry.contextMismatch ? 'signal-warning' : ''}`}><small>MODEL / CONTEXT</small><strong title={model}>{shortModel(model)}</strong><span>{telemetry.loadedContext ? `RUNTIME ${fmt(telemetry.loadedContext)} / ${fmt(options.context)} REQUESTED TOKENS` : `${fmt(options.context)} REQUESTED · NOT CURRENTLY LOADED`}</span></div><div className="signal-card"><small>ELAPSED</small><strong>{running ? secs(elapsed) : '—'}</strong><span>{running ? phase.toUpperCase() : 'NO ACTIVE RUN'}</span></div><div className="signal-card"><small>FILES IN VIEW</small><strong>{files.length}</strong><span>INDEXED / IGNORE AWARE</span></div></div>
        <div className="run-metrics" aria-label="Ollama generation statistics"><div><small>FIRST TOKEN</small><strong>{tokenDelay(runMetrics.firstTokenMs)}</strong></div><div title={outputTokensAreEstimated(runMetrics) ? 'Live estimate from streamed text; Ollama reports the exact rate after generation.' : 'Exact rate reported by Ollama.'}><small>OUTPUT / SEC{outputTokensAreEstimated(runMetrics) ? ' · LIVE' : ''}</small><strong>{liveOutputTokensPerSecond(runMetrics)?.toFixed(1).replace(/^/, outputTokensAreEstimated(runMetrics) ? '~' : '') ?? '—'}</strong></div><div title={outputTokensAreEstimated(runMetrics) ? 'Live estimate from streamed text; replaced by Ollama’s exact token count after generation.' : 'Exact output token count reported by Ollama.'}><small>OUTPUT TOKENS{outputTokensAreEstimated(runMetrics) ? ' · LIVE' : ''}</small><strong>{outputTokensAreEstimated(runMetrics) ? '~' : ''}{fmt(estimateOutputTokens(runMetrics))}</strong></div></div>
        {telemetry.contextMismatch && <p className="context-warning" role="status">Ollama reports a smaller runtime context than requested. Available memory may limit allocation.</p>}
        <div className="sheet-section"><div className="sheet-heading"><h3>Plan</h3><span>{plan.length ? `${plan.length} steps` : 'Awaiting agent'}</span></div>{plan.length ? <ol className="plan-list">{plan.map((item, index) => <li key={`${index}-${item.title || item.text}`}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.title || item.text || 'Work item'}</b><small>{item.status || 'pending'}</small></li>)}</ol> : <p className="sheet-empty">A task checklist appears here when the agent creates one.</p>}</div>
        <div className="sheet-section trace-section"><div className="sheet-heading"><h3>Activity trace</h3><span>{trace.length} events</span></div>{trace.length ? <div className="trace-list">{trace.slice(-8).reverse().map((row) => <div className="trace-item" key={row.id}><span className={`trace-dot ${row.kind}`}/><div><b>{row.title}</b><small>{row.description || ''}</small></div></div>)}</div> : <p className="sheet-empty">Reads, tool calls, and results will be grouped here.</p>}</div>
        <div className="resource-summary"><div className="resource-heading"><span>RESOURCE / SYSTEM</span><span>SIDECAR {telemetry.serviceRss}</span></div><div className="resource-row"><span>CPU</span><div className="meter"><i style={{ width: `${Math.min(100, telemetry.cpu ?? 0)}%` }}/></div><b>{telemetry.cpu == null ? '—' : `${telemetry.cpu}%`}</b></div><div className="resource-row"><span>RAM</span><div className="meter"><i style={{ width: `${memoryPct(telemetry.ram)}%` }}/></div><b>{telemetry.ram}</b></div><p>{telemetry.gpu}</p></div>
        <div className="sheet-bottom"><button onClick={onDiff}><Icon name="branch"/> Inspect changes <Icon name="arrow"/></button></div>
      </aside>
    </div>
  </section>;
}

function shortModel(value: string) { return value.split('/').at(-1) || value || 'No model selected'; }
function memoryPct(value: string) { const match = value.match(/([\d.]+)\s*\/\s*([\d.]+)/); return match ? Math.min(100, Number(match[1]) / Number(match[2]) * 100) : 0; }

function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close"/></button><span className="eyebrow-line">{eyebrow}</span><h2>{title}</h2>{children}</section></div>;
}

function SettingsModal({ model, modelInfo, options, setOptions, onClose, onSave, onMcp }: {
  model: string; modelInfo: ModelInfo | null; options: typeof initialOptions; setOptions: React.Dispatch<React.SetStateAction<typeof initialOptions>>;
  onClose: () => void; onSave: () => void; onMcp: () => void;
}) {
  const field = (label: string, value: number, key: 'context' | 'maxTokens' | 'temperature') => <label className="settings-field"><span>{label}</span><input type="number" value={value} min={key === 'context' ? 1024 : 1} max={key === 'temperature' ? 2 : undefined} step={key === 'temperature' ? 0.1 : 1} onChange={(e) => setOptions((old) => ({ ...old, [key]: key === 'temperature' ? Number(e.target.value) : Number.parseInt(e.target.value || '0', 10) }))}/></label>;
  return <Modal title="Run configuration" eyebrow="MODEL / EXECUTION" onClose={onClose}>
    <div className="setting-model-strip"><span className="picker-symbol"><Icon name="spark"/></span><span><small>SELECTED MODEL</small><strong title={model}>{model}</strong><i>Reasoning: model default</i></span></div>
    <div className="settings-fields">{field('Context tokens', options.context, 'context')}{field('Maximum output tokens', options.maxTokens, 'maxTokens')}{field('Temperature', options.temperature, 'temperature')}</div>
    <div className="context-facts"><span>Advertised context <b>{modelInfo ? fmt(modelInfo.context) : 'Unknown'}</b></span><span>Runtime allocation <b>Shown in the task signal panel</b></span></div>
    <label className="settings-field"><span>Keep model warm after a request</span><select value={options.keepAlive} onChange={(e) => setOptions((old) => ({ ...old, keepAlive: e.target.value }))}><option value="30m">30 minutes</option><option value="10m">10 minutes</option><option value="5m">5 minutes</option><option value="0">Unload when idle (Ollama setting)</option></select></label>
    <div className="settings-fields select-fields"><label className="settings-field"><span>File access</span><select value={options.access} onChange={(e) => setOptions((old) => ({ ...old, access: e.target.value as AccessMode }))}><option value="copy">Copy workspace</option><option value="plan">Plan only</option><option value="ask">Ask before writes</option><option value="edit">Edit project</option></select></label><label className="settings-field"><span>Approval</span><select value={options.approvalMode} onChange={(e) => setOptions((old) => ({ ...old, approvalMode: e.target.value as ApprovalMode }))}><option value="per-action">Approve each action</option><option value="per-task">Approve for this task</option></select></label></div>
    <div className="settings-bottom"><Button kind="outline" onClick={onMcp}>Configure local MCP</Button><span>Context is never silently reduced.</span></div>
    <div className="modal-actions"><Button kind="quiet" onClick={onClose}>Cancel</Button><Button kind="bright" onClick={onSave}>Apply to this session</Button></div>
  </Modal>;
}

function ApprovalModal({ approval, onChoice }: { approval: Approval; onChoice: (value: boolean) => void }) {
  return <Modal title={approval.name.replaceAll('_', ' ')} eyebrow="ACTION NEEDS YOUR REVIEW" wide onClose={() => onChoice(false)}>
    <p className="modal-copy">The agent requested an action under <b>{approval.mode === 'per-task' ? 'per-task' : 'per-action'} approval</b>. Review the exact arguments and selected workspace.</p>
    <div className="approval-context"><span>WORKSPACE</span><code>{approval.workspace}</code></div>
    <pre className="diff-view approval-preview">{JSON.stringify(approval.arguments, null, 2)}</pre>
    <div className="modal-actions"><Button kind="quiet" onClick={() => onChoice(false)}>Deny action</Button><Button kind="bright" onClick={() => onChoice(true)}>Approve {approval.mode === 'per-task' ? 'task' : 'action'}</Button></div>
  </Modal>;
}
