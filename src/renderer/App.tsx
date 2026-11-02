import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import type { AccessMode, ActivityEventEnvelope, ActivityMode, ActivityRecord, AppUpdateState, ApprovalMode, HarnessProfile, ModelCatalog, ModelInfo, ProjectFile, QueuedPrompt, RunOptions, SessionLiveSnapshot, SessionSummary, SkillSource, TaskIntent, ToolCatalog, WorkerCommand, WorkerEvent, WorkspaceHistoryEntry } from '../shared/protocol';
import { applyToolCallProgress, nextRunPhase, restoredRunPhase, runStepProgress, shouldQueuePromptOnEnter, type ToolCallProgress } from '../shared/run-state';
import { addGenerationUsage, beginGeneration, emptyRunMetrics, endGeneration, estimateOutputTokens, liveOutputTokensPerSecond, outputTokensAreEstimated, recordFirstToken, recordInputEstimate, recordStreamedText, restoreRunMetrics, type RunMetrics } from '../shared/run-metrics';
import { buildModelLabels, buildTokenPresets, chooseDefaultModel, normalizeReasoningChoice, readRunTokenPreferences } from '../shared/model-controls';
import { featuredInstalledModels } from '../shared/model-recommendations';
import { normalizeGpuStats } from '../shared/resource-metrics';
import { appendTranscriptSegment, reconcileLiveAssistantMessage, restoreTranscriptMessages } from '../shared/transcript';
import { LocalModelOrbit } from './ModelOrbit';
import { ActivityFeed } from './ActivityFeed';
import { applyActivityEvent, mergeActivitySnapshot, shouldRefreshWorkspaceForActivity } from '../shared/activity';
import { DEFAULT_RUN_SHEET_LAYOUT, moveRunSheetPanel, restoreRunSheetLayout, resizeRunSheetPanel, type RunSheetLayout, type RunSheetPanel } from '../shared/run-sheet-layout';
import { nextHarnessProfile } from '../shared/harness-profile';
import { isNearTranscriptEnd } from '../shared/transcript-follow';
import { readVerificationEvidence, verificationEvidenceLabel, type VerificationEvidence } from '../shared/verification-evidence';
import { readPlanAcceptanceCriteria, restorePlanItems } from '../shared/plan-criteria';
import { parsePermissionCommandPrefix } from '../shared/permission-rules';

type ChatMessage = { role: 'user' | 'assistant'; content: string; turnId?: string; thinking?: string; streaming?: boolean; recoveredPartial?: boolean; steeringId?: string; steeringStatus?: 'pending' | 'delivered' | 'undelivered' };
type PlanItem = { title?: string; text?: string; status?: string; source?: 'workbench' | 'agent'; group?: string };
type PermissionRule = { tool: string; decision: 'allow' | 'ask' | 'deny'; path_glob?: string; command_prefix?: string | string[] };
type PermissionRuleDraft = { tool: string; decision: PermissionRule['decision']; scope: 'tool' | 'path' | 'command'; value: string };
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
  task_intent?: TaskIntent;
  working_workspace?: string;
  copy_manifest?: Record<string, string>;
  last_error?: { message: string; occurred_at: number };
  activity_mode?: ActivityMode;
  activity_events?: ActivityRecord[];
  queued_prompts?: QueuedPrompt[];
  session_approval_granted?: boolean;
  turns?: Array<{ turn_id?: string; prompt?: string; started_at?: number; finished_at?: number; status?: string; transcript_saved?: boolean }>;
  plan?: PlanItem[];
  usage_events?: Array<{ turn_id?: string; request_index?: number; first_token_seconds?: number; estimated_input_tokens?: number; usage?: Record<string, unknown> }>;
  recovery_issues?: string[];
  skills_enabled?: boolean;
  skill_sources?: SkillSource[];
  run_state?: Record<string, unknown> | null;
  task_checkpoint?: { current?: { user_updates?: Array<{ id?: string; turn_id?: string; instruction?: string; status?: string }> } };
};
type TraceRow = { id: string; title: string; description?: string; kind: 'tool' | 'status' | 'plan' | 'error'; time: number };
type Approval = { actionId: string; name: string; arguments: unknown; workspace: string; mode: ApprovalMode };
type AgentQuestion = { questionId: string; title: string; question: string; options: Array<{ label: string; description?: string }> };
type Notice = { tone: 'good' | 'warn' | 'bad'; text: string };
type TelemetryView = {
  cpu: number | null; ram: string; gpu: string; gpuUtil: number | null;
  vramUsed: number | null; vramTotal: number | null; vramPercent: number | null; gpuPower: number | null;
  loadedContext: number | null; contextMismatch: boolean; serviceRss: string; serviceCpu: number | null;
  runtimeWorkerCount: number; runtimeWorkerCpu: number | null; runtimeWorkerRss: string; runtimeGpuMemory: number | null;
  kvSlot: { contextTokens: number | null; contextLimit: number | null; cachedTokens: number | null; processing: boolean } | null;
};
type AppliedSettings = { model: string; context: number; maxOutput: number; reasoning: boolean | string | null; estimatedInput: number | null };

function normalizeTaskIntent(value: unknown): TaskIntent { return value === 'discuss' || value === 'plan' || value === 'implement' ? value : 'auto'; }

const initialOptions = {
  ...readRunTokenPreferences(localStorage.getItem('agent-run-token-preferences')),
  temperature: 0.2,
  keepAlive: '30m',
  access: 'ask' as AccessMode,
  approvalMode: 'per-action' as ApprovalMode,
  reasoning: null as boolean | string | null,
  harnessProfile: 'standard' as HarnessProfile,
  taskIntent: normalizeTaskIntent(localStorage.getItem('agent-task-intent')),
  skillsEnabled: localStorage.getItem('agent-skills-enabled') !== 'false',
  skillSources: (() => {
    try {
      const value = JSON.parse(localStorage.getItem('agent-skill-sources') || '["project","user"]');
      return Array.isArray(value) && value.length && value.every((source) => source === 'project' || source === 'user') ? value as SkillSource[] : ['project', 'user'] as SkillSource[];
    } catch { return ['project', 'user'] as SkillSource[]; }
  })(),
};

function shortPath(value?: string) {
  if (!value) return 'No project selected';
  const normalized = value.replaceAll('\\', '/').replace(/\/$/, '');
  return normalized.split('/').at(-1) || value;
}
function fmt(n?: number) { return n == null ? '—' : new Intl.NumberFormat().format(n); }
function secs(ms: number) { return `${Math.floor(ms / 1000)}s`; }
function tokenDelay(ms: number | null) { return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`; }
function workflowOutcomeLabel(value: unknown): string | null {
  const labels: Record<string, string> = {
    discussion: 'Discussion only', no_action: 'No project operation recorded', plan_only: 'Plan recorded · no edits', blocked: 'Blocked', response_missing: 'Final response missing', implementation_incomplete: 'Implementation not completed', implementation_unverified: 'Command may have changed files · inspect result', changed: 'Changes made · not verified',
    inspected: 'Changes inspected', command_completed: 'Command completed · not a test claim', command_failed: 'Command failed',
    cancelled: 'Cancelled', failed: 'Failed', interrupted: 'Interrupted', stopped: 'Stopped after operation',
  };
  return typeof value === 'string' ? labels[value] || value.replaceAll('_', ' ') : null;
}
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

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const unsubscribe = window.agent.onWindowState(setMaximized);
    void window.agent.windowState().then(setMaximized).catch(() => undefined);
    return unsubscribe;
  }, []);
  const run = (action: 'minimize' | 'maximize' | 'close') => {
    void window.agent.windowControl(action).catch((error) => console.error('Window control failed:', error));
  };
  return <div
    className={`window-control-hotspot${revealed ? ' is-revealed' : ''}`}
    onMouseEnter={() => setRevealed(true)}
    onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setRevealed(false); }}
    onFocus={() => setRevealed(true)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.matches(':hover')) setRevealed(false); }}
    tabIndex={0}
    role="group"
    aria-label="Window controls; focus or hover at the top-right edge to reveal"
  >
    <div className="window-control-buttons">
      <button type="button" onClick={() => run('minimize')} aria-label="Minimize window" title="Minimize">−</button>
      <button type="button" onClick={() => run('maximize')} aria-label={maximized ? 'Restore window' : 'Maximize window'} title={maximized ? 'Restore' : 'Maximize'}><span className={maximized ? 'restore-glyph' : ''}/></button>
      <button type="button" className="window-close" onClick={() => run('close')} aria-label="Close window" title="Close">×</button>
    </div>
  </div>;
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
  const [modelCatalogStatus, setModelCatalogStatus] = useState<'loading' | 'refreshing' | 'ready' | 'error'>('loading');
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const displayModelLabels = useMemo(() => buildModelLabels(models, modelLabels), [models, modelLabels]);
  const [model, setModel] = useState('');
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [workspace, setWorkspace] = useState(localStorage.getItem('agent-workspace') || '');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projectSessionHistoryStatus, setProjectSessionHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [homeSessions, setHomeSessions] = useState<SessionSummary[]>([]);
  const [sessionHistoryStatus, setSessionHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [workspaces, setWorkspaces] = useState<WorkspaceHistoryEntry[]>([]);
  const [workspaceHistoryStatus, setWorkspaceHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
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
  const [cancelChoicePending, setCancelChoicePending] = useState<'cancel' | 'finish' | null>(null);
  const [closeChoiceOpen, setCloseChoiceOpen] = useState(false);
  const [closeChoicePending, setCloseChoicePending] = useState<'keep' | 'hide' | 'cancel-close' | null>(null);
  const [trace, setTrace] = useState<TraceRow[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>([]);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [copyChanges, setCopyChanges] = useState<Array<{ path: string; action: string; conflict: boolean; reason: string }>>([]);
  const [selectedChanges, setSelectedChanges] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const [steeringSubmitting, setSteeringSubmitting] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [modelPreloading, setModelPreloading] = useState(false);
  const [connected, setConnected] = useState<'checking' | 'yes' | 'no'>('checking');
  const [running, setRunning] = useState(false);
  const [toolCallProgress, setToolCallProgress] = useState<ToolCallProgress[]>([]);
  const [phase, setPhase] = useState('Ready');
  const [workflowOutcome, setWorkflowOutcome] = useState<string | null>(null);
  const [verificationEvidence, setVerificationEvidence] = useState<VerificationEvidence | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [firstOperationSeconds, setFirstOperationSeconds] = useState<number | null>(null);
  const [firstFileWriteSeconds, setFirstFileWriteSeconds] = useState<number | null>(null);
  const [runMetrics, setRunMetrics] = useState<RunMetrics>(emptyRunMetrics);
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({});
  const [appliedSettings, setAppliedSettings] = useState<AppliedSettings | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [updateState, setUpdateState] = useState<AppUpdateState>({ supported: false, status: 'unsupported', currentVersion: window.agent.version });
  const [approval, setApproval] = useState<Approval | null>(null);
  const [agentQuestion, setAgentQuestion] = useState<AgentQuestion | null>(null);
  const [questionAnswering, setQuestionAnswering] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionRules, setPermissionRules] = useState<PermissionRuleDraft[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolCatalog, setToolCatalog] = useState<ToolCatalog | null>(null);
  const [toolCatalogLoading, setToolCatalogLoading] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
  const [downloadedModelDirectory, setDownloadedModelDirectory] = useState('');
  const [diffOpen, setDiffOpen] = useState(false);
  const [mcpJson, setMcpJson] = useState('{"mcpServers":{}}');
  const [options, setOptions] = useState(() => ({
    ...initialOptions,
    harnessProfile: localStorage.getItem('agent-harness-profile') === 'small-model' ? 'small-model' as HarnessProfile : 'standard' as HarnessProfile,
  }));
  const [view, setView] = useState<'landing' | 'project' | 'session'>('landing');
  const [projectTab, setProjectTab] = useState<'overview' | 'files' | 'sessions'>('overview');
  const endRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const assistantSegmentBreakRef = useRef(false);
  const activeTurnIdRef = useRef('');
  const liveSnapshotCursorRef = useRef({ sessionId: '', activityRevision: 0, textRevision: 0, busy: false });
  const workspaceHistoryRequestId = useRef(0);
  const projectSessionRequestId = useRef(0);
  const projectFileRequestId = useRef(0);
  const navigationRequestId = useRef(0);
  const modelCatalogLoaded = useRef(false);
  const modelCatalogRequestId = useRef(0);

  const notify = useCallback((text: string, tone: Notice['tone'] = 'good') => {
    setNotice({ text, tone });
    window.setTimeout(() => setNotice((current) => current?.text === text ? null : current), 4500);
  }, []);

  const request = useCallback(async <T,>(command: WorkerCommand): Promise<T> => window.agent.request<T>(command), []);

  const refreshModels = useCallback(async (quiet = false) => {
    const requestId = ++modelCatalogRequestId.current;
    if (!quiet) { setConnected('checking'); setModelCatalogStatus(modelCatalogLoaded.current ? 'refreshing' : 'loading'); }
    try {
      const catalog = await request<ModelCatalog>({ command: 'model_catalog' });
      if (requestId !== modelCatalogRequestId.current) return;
      const rows = [...new Set([...catalog.ollama, ...catalog.gguf.map((entry) => entry.id)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
      setModels(rows);
      setModelLabels(Object.fromEntries(catalog.gguf.map((entry) => [entry.id, entry.label])));
      modelCatalogLoaded.current = true;
      setModelCatalogStatus('ready');
      setConnected(catalog.ollama_error ? 'no' : 'yes');
      setModel((current) => chooseDefaultModel(rows, current));
      if (!quiet && catalog.ollama_error && !catalog.gguf.length) notify(`Ollama is not reachable: ${catalog.ollama_error}`, 'bad');
      else if (!quiet && !catalog.ollama_error && !rows.length) notify('Ollama is connected, but no models are installed.', 'warn');
    } catch (error) {
      if (requestId !== modelCatalogRequestId.current) return;
      setConnected('no');
      setModelCatalogStatus('error');
      if (!quiet) notify(`Ollama is not reachable: ${(error as Error).message}`, 'bad');
    }
  }, [notify, request]);

  const refreshProjectSessions = useCallback(async (root: string) => {
    const requestId = ++projectSessionRequestId.current;
    setProjectSessionHistoryStatus('loading');
    try {
      const rows = await request<SessionSummary[]>({ command: 'sessions_list', workspace: root });
      if (requestId !== projectSessionRequestId.current) return;
      setSessions(rows);
      setProjectSessionHistoryStatus('ready');
    } catch (error) {
      if (requestId !== projectSessionRequestId.current) return;
      setProjectSessionHistoryStatus('error');
      throw error;
    }
  }, [request]);

  const refreshWorkspace = useCallback(async (root: string) => {
    // File access is the essential project operation. A session-index failure
    // must not make the workspace look unavailable or discard refreshed files.
    const requestId = ++projectFileRequestId.current;
    const fileRows = await request<ProjectFile[]>({ command: 'workspace_files', workspace: root });
    if (requestId !== projectFileRequestId.current) return;
    setFiles(fileRows);
    void refreshProjectSessions(root).catch((error) => notify(`Project files loaded, but saved sessions could not be refreshed: ${(error as Error).message}`, 'warn'));
  }, [notify, refreshProjectSessions, request]);

  const refreshWorkspaceHistory = useCallback(async (query = '') => {
    const requestId = ++workspaceHistoryRequestId.current;
    setWorkspaceHistoryStatus('loading');
    try {
      const rows = await request<WorkspaceHistoryEntry[]>({ command: 'workspaces_list', query });
      if (requestId === workspaceHistoryRequestId.current) {
        setWorkspaces(rows);
        setWorkspaceHistoryStatus('ready');
      }
    } catch (error) {
      if (requestId !== workspaceHistoryRequestId.current) return;
      setWorkspaceHistoryStatus('error');
      throw error;
    }
  }, [request]);

  const refreshHome = useCallback(async () => {
    setSessionHistoryStatus('loading');
    const [historyResult, sessionsResult] = await Promise.allSettled([
      refreshWorkspaceHistory(''),
      request<SessionSummary[]>({ command: 'sessions_list' }),
    ]);
    if (sessionsResult.status === 'fulfilled') {
      setHomeSessions(sessionsResult.value);
      setSessionHistoryStatus('ready');
    } else setSessionHistoryStatus('error');
    const failures = [historyResult, sessionsResult].filter((result) => result.status === 'rejected');
    if (failures.length) throw new Error(failures.map((result) => result.status === 'rejected' ? String(result.reason) : '').join('; '));
  }, [refreshWorkspaceHistory, request]);

  const showProject = useCallback(async (root: string) => {
    const navigationId = ++navigationRequestId.current;
    const fileRequestId = ++projectFileRequestId.current;
    try {
      const filesResult = await request<ProjectFile[]>({ command: 'workspace_files', workspace: root });
      if (navigationId !== navigationRequestId.current || fileRequestId !== projectFileRequestId.current) return;
      setWorkspace(root);
      localStorage.setItem('agent-workspace', root);
      setFiles(filesResult);
      setSessions([]);
      setProjectSessionHistoryStatus('loading');
      const sessionRequestId = ++projectSessionRequestId.current;
      setSession(null);
      setMessages([]);
      setWorkflowOutcome(null);
      setVerificationEvidence(null);
      setView('project');
      setProjectTab('overview');
      void request<SessionSummary[]>({ command: 'sessions_list', workspace: root }).then((rows) => {
        if (sessionRequestId !== projectSessionRequestId.current) return;
        setSessions(rows);
        setProjectSessionHistoryStatus('ready');
      }).catch((error) => {
        if (sessionRequestId !== projectSessionRequestId.current) return;
        setProjectSessionHistoryStatus('error');
        notify(`Project opened, but saved sessions could not be loaded: ${(error as Error).message}`, 'warn');
      });
      try {
        await request({ command: 'workspace_record', workspace: root });
        await refreshWorkspaceHistory('');
      } catch (historyError) {
        setWorkspaceHistoryStatus('error');
        notify(`Project opened, but workspace history could not be saved or refreshed: ${(historyError as Error).message}`, 'warn');
      }
    } catch (error) { notify(`Could not open project: ${(error as Error).message}`, 'bad'); }
  }, [notify, refreshWorkspaceHistory, request]);

  const loadSession = useCallback(async (id: string, selectedWorkspace = workspace, source?: 'app' | 'project') => {
    const navigationId = ++navigationRequestId.current;
    try {
      const response = await request<Session | { conflict: true; recommended_source: 'project'; versions: Array<{ source: 'app' | 'project'; updated_at?: number }> }>({ command: 'session_resume', sessionId: id, workspace: selectedWorkspace || undefined, source });
      if (navigationId !== navigationRequestId.current) return;
      if ('conflict' in response && response.conflict) {
        setSessionConflict({ id, workspace: selectedWorkspace, versions: response.versions });
        return;
      }
      const loaded = response as Session;
      setSessionConflict(null);
      setPhase(restoredRunPhase(loaded.run_state?.status));
      setFirstOperationSeconds(typeof loaded.run_state?.first_operation_seconds === 'number' ? loaded.run_state.first_operation_seconds : null);
      setFirstFileWriteSeconds(typeof loaded.run_state?.first_file_write_seconds === 'number' ? loaded.run_state.first_file_write_seconds : null);
      setWorkflowOutcome(typeof loaded.run_state?.workflow_outcome === 'string' ? loaded.run_state.workflow_outcome : loaded.run_state?.status === 'interrupted' ? 'interrupted' : null);
      setVerificationEvidence(readVerificationEvidence(loaded.run_state?.verification));
      const root = loaded.workspace;
      const sessionRequestId = ++projectSessionRequestId.current;
      const fileRequestId = ++projectFileRequestId.current;
      setModel(loaded.model);
      const rows: ChatMessage[] = restoreTranscriptMessages(loaded.messages, loaded.turns);
      for (const update of loaded.task_checkpoint?.current?.user_updates || []) {
        if (!update.id || !update.instruction || !['pending', 'undelivered'].includes(String(update.status))) continue;
        if (rows.some((row) => row.steeringId === update.id)) continue;
        rows.push({ role: 'user', content: update.instruction, turnId: update.turn_id,
          steeringId: update.id, steeringStatus: update.status === 'undelivered' ? 'undelivered' : 'pending' });
      }
      setWorkspace(root);
      setFiles([]);
      localStorage.setItem('agent-workspace', root);
      setSession(loaded);
      if (loaded.recovery_issues?.length) {
        notify(`Session recovery found ${loaded.recovery_issues.length} unreadable journal record(s). Saved snapshots and raw journal files were preserved; review recovery details before retrying interrupted work.`, 'warn');
      }
      const partial = typeof loaded.run_state?.partial_content === 'string' ? loaded.run_state.partial_content : '';
      const partialThinking = typeof loaded.run_state?.partial_thinking === 'string' ? loaded.run_state.partial_thinking : '';
      if (loaded.run_state?.status === 'interrupted') {
        const interruptedTurnId = typeof loaded.run_state.turn_id === 'string' ? loaded.run_state.turn_id : undefined;
        if (typeof loaded.run_state.prompt === 'string') {
          const alreadyPresent = interruptedTurnId
            ? rows.some((row) => row.role === 'user' && row.turnId === interruptedTurnId)
            : rows.at(-1)?.role === 'user' && rows.at(-1)?.content === loaded.run_state.prompt;
          if (!alreadyPresent) rows.push({ role: 'user', content: loaded.run_state.prompt, turnId: interruptedTurnId });
        }
        if (partial || partialThinking) rows.push({ role: 'assistant', content: partial, thinking: partialThinking, turnId: interruptedTurnId, recoveredPartial: true });
      }
      setMessages(rows);
      setActivities(Array.isArray(loaded.activity_events) ? loaded.activity_events : []);
      setPlan(restorePlanItems(loaded.plan, loaded.activity_events, loaded.turns?.at(-1)?.turn_id) as PlanItem[]);
      setAcceptanceCriteria(readPlanAcceptanceCriteria(loaded.activity_events));
      const latestTurnId = loaded.turns?.at(-1)?.turn_id;
      setRunMetrics(restoreRunMetrics((loaded.usage_events || []).filter((row) => !latestTurnId || row.turn_id === latestTurnId)));
      const nextMode: ActivityMode = loaded.activity_mode === 'sidebar' || loaded.activity_mode === 'inline' ? loaded.activity_mode : 'compact';
      setActivityMode(nextMode);
      sessionStorage.setItem('agent-activity-mode', nextMode);
      const recoveryTrace: TraceRow[] = (loaded.recovery_issues || []).map((description, index) => ({
        id: `recovery-issue-${id}-${index}`, title: 'Session journal needs review', description, kind: 'error', time: Date.now(),
      }));
      if (loaded.last_error) recoveryTrace.unshift({ id: `last-error-${loaded.last_error.occurred_at}`, title: 'Previous run failed', description: loaded.last_error.message, kind: 'error', time: loaded.last_error.occurred_at * 1000 });
      setTrace(recoveryTrace);
      setOptions({
        context: loaded.context || modelInfo?.context || 8192,
        maxTokens: loaded.max_tokens || 4096,
        temperature: loaded.temperature ?? 0.2,
        keepAlive: loaded.keep_alive || '30m',
        access: loaded.access || 'ask',
        approvalMode: loaded.approval_mode === 'per-task' || loaded.approval_mode === 'per-session' ? loaded.approval_mode : 'per-action',
        reasoning: loaded.reasoning ?? null,
        harnessProfile: loaded.harness_profile === 'small-model' ? 'small-model' : (localStorage.getItem('agent-harness-profile') === 'small-model' ? 'small-model' : 'standard'),
        taskIntent: normalizeTaskIntent(loaded.task_intent ?? localStorage.getItem('agent-task-intent')),
        skillsEnabled: loaded.skills_enabled ?? initialOptions.skillsEnabled,
        skillSources: Array.isArray(loaded.skill_sources) && loaded.skill_sources.every((source) => source === 'project' || source === 'user') ? loaded.skill_sources : initialOptions.skillSources,
      });
      setView('session');
      setRecoverySession(loaded.run_state?.status === 'interrupted' ? loaded : null);
      setProjectSessionHistoryStatus('loading');
      void request<ProjectFile[]>({ command: 'workspace_files', workspace: root }).then((rows) => {
        if (fileRequestId !== projectFileRequestId.current || navigationId !== navigationRequestId.current) return;
        setFiles(rows);
      }).catch((error) => {
        if (fileRequestId !== projectFileRequestId.current || navigationId !== navigationRequestId.current) return;
        notify(`Session restored, but the project file list could not be loaded: ${(error as Error).message}`, 'warn');
      });
      void request<SessionSummary[]>({ command: 'sessions_list', workspace: root }).then((rows) => {
        if (sessionRequestId !== projectSessionRequestId.current) return;
        setSessions(rows);
        setProjectSessionHistoryStatus('ready');
      }).catch((error) => {
        if (sessionRequestId !== projectSessionRequestId.current) return;
        setProjectSessionHistoryStatus('error');
        notify(`Session restored, but the project session list could not be refreshed: ${(error as Error).message}`, 'warn');
      });
      await refreshWorkspaceHistory('');
    } catch (error) { notify(`Could not resume session: ${(error as Error).message}`, 'bad'); }
  }, [modelInfo?.context, notify, refreshWorkspaceHistory, request, workspace]);

  async function recoverInterruptedRun(action: 'resume' | 'retry' | 'restore') {
    if (!recoverySession) return;
    const recovered = await request<{ state: Session; prompt?: string; action: string }>({ command: 'session_recover', sessionId: recoverySession.session_id, action });
    setRecoverySession(null);
    setSession(recovered.state);
    setWorkflowOutcome(typeof recovered.state.run_state?.workflow_outcome === 'string' ? recovered.state.run_state.workflow_outcome : null);
    setVerificationEvidence(readVerificationEvidence(recovered.state.run_state?.verification));
    const restored: ChatMessage[] = restoreTranscriptMessages(recovered.state.messages, recovered.state.turns);
    for (const update of recovered.state.task_checkpoint?.current?.user_updates || []) {
      if (!update.id || !update.instruction || !['pending', 'undelivered'].includes(String(update.status))) continue;
      if (restored.some((row) => row.steeringId === update.id)) continue;
      restored.push({ role: 'user', content: update.instruction, turnId: update.turn_id,
        steeringId: update.id, steeringStatus: update.status === 'undelivered' ? 'undelivered' : 'pending' });
    }
    const partial = typeof recovered.state.run_state?.partial_content === 'string' ? recovered.state.run_state.partial_content : '';
    const partialThinking = typeof recovered.state.run_state?.partial_thinking === 'string' ? recovered.state.run_state.partial_thinking : '';
    if (action !== 'restore' && recovered.prompt) restored.push({ role: 'user', content: recovered.prompt });
    if (partial || partialThinking) restored.push({ role: 'assistant', content: partial, thinking: partialThinking, turnId: typeof recovered.state.run_state?.turn_id === 'string' ? recovered.state.run_state.turn_id : undefined, recoveredPartial: true });
    setMessages(restored);
    setActivities(Array.isArray(recovered.state.activity_events) ? recovered.state.activity_events : []);
    setPlan(restorePlanItems(recovered.state.plan, recovered.state.activity_events,
      typeof recovered.state.run_state?.turn_id === 'string' ? recovered.state.run_state.turn_id : recovered.state.turns?.at(-1)?.turn_id) as PlanItem[]);
    setAcceptanceCriteria(readPlanAcceptanceCriteria(recovered.state.activity_events));
    if (action === 'restore' || !recovered.prompt) return;
    const settings = (recovered.state.run_state?.settings || {}) as Record<string, unknown>;
    const run: RunOptions = {
      workspace: recovered.state.workspace, sessionId: recovered.state.session_id,
      providerId: recovered.state.provider_id === 'llama.cpp' ? 'llama.cpp' : 'ollama',
      prompt: recovered.prompt, model: String(settings.model || recovered.state.model),
      context: Number(settings.context || recovered.state.context),
      maxTokens: Number(settings.max_tokens || recovered.state.max_tokens || 4096),
      temperature: Number(recovered.state.temperature ?? 0.2),
      access: recovered.state.access || 'ask', approvalMode: recovered.state.approval_mode === 'per-task' || recovered.state.approval_mode === 'per-session' ? recovered.state.approval_mode : 'per-action',
      keepAlive: recovered.state.keep_alive || '30m',
      reasoning: (settings.reasoning ?? recovered.state.reasoning ?? null) as boolean | string | null,
      harnessProfile: settings.harness_profile === 'small-model' || recovered.state.harness_profile === 'small-model' ? 'small-model' : 'standard',
      taskIntent: normalizeTaskIntent(settings.task_intent ?? recovered.state.task_intent),
      skillsEnabled: typeof settings.skills_enabled === 'boolean' ? settings.skills_enabled : (recovered.state.skills_enabled ?? initialOptions.skillsEnabled),
      skillSources: Array.isArray(settings.skill_sources) && settings.skill_sources.every((source) => source === 'project' || source === 'user') ? settings.skill_sources as SkillSource[] : (recovered.state.skill_sources || initialOptions.skillSources),
    };
    setPrompt(''); setRunning(true); setPhase('Recovering interrupted task'); setStartedAt(Date.now()); setElapsed(0);
    try { await request({ command: 'run_start', options: run }); }
    catch (error) { setRunning(false); setPhase('Recovery failed'); setWorkflowOutcome('failed'); notify(`Could not continue the interrupted task: ${(error as Error).message}`, 'bad'); }
  }

  useEffect(() => {
    const unsubscribeUpdate = window.agent.onUpdateState(setUpdateState);
    void window.agent.updateState().then(setUpdateState).catch(() => undefined);
    void refreshModels();
    void refreshHome().catch((error) => notify(`Could not load saved workspace history: ${(error as Error).message}`, 'warn'));
    void request({ command: 'ping' }).then(() => setInstalled(true)).catch(() => setInstalled(false));
    const unsubscribe = window.agent.onEvent((event) => {
      if ((event.type === 'text' || event.type === 'thinking') && typeof event.textRevision === 'number') {
        const cursor = liveSnapshotCursorRef.current;
        if ((typeof event.sessionId === 'string' && cursor.sessionId && event.sessionId !== cursor.sessionId)
            || (typeof event.turnId === 'string' && activeTurnIdRef.current && event.turnId !== activeTurnIdRef.current)
            || event.textRevision <= cursor.textRevision) return;
        cursor.textRevision = event.textRevision;
      }
      if (event.type === 'phase' && typeof event.textRevision === 'number') {
        const cursor = liveSnapshotCursorRef.current;
        const sameSession = !event.sessionId || !cursor.sessionId || event.sessionId === cursor.sessionId;
        const sameTurn = typeof event.turnId !== 'string' || !activeTurnIdRef.current || event.turnId === activeTurnIdRef.current;
        if (sameSession && sameTurn) {
          cursor.textRevision = Math.max(cursor.textRevision, event.textRevision);
        }
      }
      if (event.type === 'service_ready') {
        setInstalled(true);
        const warnings = Array.isArray(event.warnings) ? event.warnings.filter((warning): warning is string => typeof warning === 'string') : [];
        for (const warning of warnings) notify(warning, 'warn');
      }
      if (event.type === 'service_error' || event.type === 'service_exit') {
        setInstalled(false);
        setModelPreloading(false);
        if (event.type === 'service_exit') {
          setToolCallProgress([]);
          setWorkflowOutcome('interrupted');
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
      if (event.type === 'ollama_preload_started') {
        setModelPreloading(true);
        notify(`Preloading ${shortModel(String(event.model || model))} at ${fmt(Number(event.context))} context.`, 'warn');
      }
      if (event.type === 'ollama_preload_complete') {
        setModelPreloading(false);
        const elapsed = Number(event.elapsed_seconds);
        const load = Number(event.load_duration_seconds);
        const timing = Number.isFinite(elapsed) ? ` · ${elapsed.toFixed(1)}s warm-up${Number.isFinite(load) ? ` / ${load.toFixed(1)}s Ollama load` : ''}` : '';
        notify(`${shortModel(String(event.model || model))} is warm and ready${timing}.`, 'good');
      }
      if (event.type === 'ollama_preload_skipped') {
        setModelPreloading(false);
        if (event.status === 'already_loaded') notify(`${shortModel(String(event.model))} is already loaded at the selected context.`, 'good');
        else notify(String(event.reason || 'Model preload was skipped to preserve the currently loaded model.'), 'warn');
      }
      if (event.type === 'ollama_preload_error') {
        setModelPreloading(false);
        notify(String(event.error || 'Model preload failed.'), 'bad');
      }
      if (event.type === 'activity_event') {
        const activityEvent = event as unknown as ActivityEventEnvelope;
        setActivities((current) => applyActivityEvent(current, activityEvent));
        const activity = activityEvent.activity;
        if (activity?.kind === 'question') {
          const questionId = String(activity.questionId || activity.id);
          if (activity.status === 'awaiting_user') {
            const options = Array.isArray(activity.options) ? activity.options.filter((option): option is { label: string; description?: string } =>
              typeof option === 'object' && option !== null && typeof option.label === 'string') : [];
            setAgentQuestion({ questionId, title: String(activity.title || 'The agent needs input'),
              question: String(activity.question || ''), options });
          } else {
            setAgentQuestion((current) => current?.questionId === questionId ? null : current);
            setQuestionAnswering(false);
          }
        }
        // Plan updates are delivered through the same durable activity event stream
        // used by the chat cards and Activity Trace, rather than as a second UI-only event.
        if (activityEvent.activity?.kind === 'plan' && Array.isArray(activityEvent.activity.items)) {
          setPlan(activityEvent.activity.items as PlanItem[]);
          if (Array.isArray(activityEvent.activity.acceptanceCriteria)) setAcceptanceCriteria(activityEvent.activity.acceptanceCriteria);
        }
        if (activityEvent.activity && shouldRefreshWorkspaceForActivity(activityEvent.activity)) {
          const root = activityEvent.activity.workspace || workspace;
          if (root && root === workspace) void refreshWorkspace(root).catch((error) => notify(`Workspace files could not refresh after ${activityEvent.activity?.name || 'the operation'}: ${(error as Error).message}`, 'warn'));
        }
      }
      if (event.type === 'run_started' && typeof event.turnId === 'string') {
        activeTurnIdRef.current = event.turnId;
        liveSnapshotCursorRef.current = { sessionId: String(event.sessionId || ''), activityRevision: 0, textRevision: 0, busy: false };
        setToolCallProgress([]);
        setMessages((current) => {
          let index = current.length - 1;
          while (index >= 0 && (current[index].role !== 'user' || current[index].turnId)) index -= 1;
          if (index < 0) return current;
          const next = current.slice();
          next[index] = { ...next[index], turnId: event.turnId as string };
          return next;
        });
      }
      if (event.type === 'steering_update' && typeof event.updateId === 'string' && typeof event.prompt === 'string') {
        const updateId = event.updateId;
        const capturedSessionId = liveSnapshotCursorRef.current.sessionId;
        if (typeof event.sessionId === 'string' && capturedSessionId && event.sessionId !== capturedSessionId) return;
        const accepted = event.status === 'accepted';
        const status = event.status === 'delivered' ? 'delivered' : event.status === 'undelivered' ? 'undelivered' : 'pending';
        const turnId = typeof event.turnId === 'string' ? event.turnId : undefined;
        setMessages((current) => {
          const existing = current.findIndex((row) => row.steeringId === updateId);
          if (existing >= 0) return current.map((row, index) => index === existing ? { ...row, steeringStatus: status } : row);
          return accepted ? [...current, { role: 'user', content: event.prompt as string, turnId, steeringId: updateId, steeringStatus: status }] : current;
        });
      }
      if (event.type === 'session_queue_update' && Array.isArray(event.queuedPrompts)) {
        const sessionId = String(event.sessionId || '');
        const queuedPrompts = event.queuedPrompts.filter((row): row is QueuedPrompt =>
          typeof row === 'object' && row !== null && typeof row.id === 'string'
          && typeof row.prompt === 'string' && typeof row.queued_at === 'number');
        setSession((current) => current?.session_id === sessionId ? { ...current, queued_prompts: queuedPrompts } : current);
      }
      if (event.type === 'session_approval_state' && typeof event.sessionId === 'string' && typeof event.approved === 'boolean') {
        const sessionId = event.sessionId;
        const approved = event.approved;
        setSession((current) => {
          if (!current || current.session_id !== sessionId) return current;
          return { ...current, session_approval_granted: approved };
        });
      }
      if (event.type === 'tool_call_progress') {
        setToolCallProgress((current) => applyToolCallProgress(current, event));
      }
      if (event.type === 'tool_batch') {
        assistantSegmentBreakRef.current = true;
        setToolCallProgress([]);
        setMessages((current) => current.map((row) => row.streaming ? { ...row, streaming: false } : row));
      }
      if (event.type === 'session_mirror_error') {
        const appSaved = event.appSaved !== false;
        const projectSaved = event.projectSaved === true;
        const message = `Session save status · app ${appSaved ? 'saved' : 'FAILED'} · project ${projectSaved ? 'saved' : 'FAILED'}: ${String(event.error || 'storage unavailable')}`;
        notify(message, appSaved && projectSaved ? 'good' : appSaved ? 'warn' : 'bad');
      }
      if (event.type === 'checkpoint_journal_error') {
        const appSaved = event.appSaved === true;
        const projectSaved = event.projectSaved === true;
        notify(`Live recovery journal · app ${appSaved ? 'saved' : 'FAILED'} · project ${projectSaved ? 'saved' : 'FAILED'}: ${String(event.error || 'storage unavailable')}`, appSaved || projectSaved ? 'warn' : 'bad');
      }
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
      if (event.type === 'activity_event' && typeof event.firstOperationSeconds === 'number') {
        setFirstOperationSeconds((current) => current ?? event.firstOperationSeconds as number);
      }
      if (event.type === 'activity_event' && typeof event.firstFileWriteSeconds === 'number') {
        setFirstFileWriteSeconds((current) => current ?? event.firstFileWriteSeconds as number);
      }
      if (event.type === 'request_dispatched' || event.type === 'request_headers'
          || event.type === 'request_complete' || event.type === 'request_error') {
        setPhase((current) => nextRunPhase(current, event));
      }
      if (event.type === 'text') {
        const chunk = String(event.text || '');
        const addSegmentBreak = assistantSegmentBreakRef.current;
        assistantSegmentBreakRef.current = false;
        setRunMetrics((current) => recordStreamedText(current, chunk));
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role === 'assistant' && last.streaming) {
            return [...current.slice(0, -1), { ...last, content: appendTranscriptSegment(last.content, chunk, addSegmentBreak) }];
          }
          return [...current, { role: 'assistant', content: chunk, turnId: activeTurnIdRef.current || undefined, streaming: true }];
        });
      }
      if (event.type === 'thinking') {
        const chunk = String(event.text || '');
        const addSegmentBreak = assistantSegmentBreakRef.current;
        assistantSegmentBreakRef.current = false;
        setRunMetrics((current) => recordStreamedText(current, chunk));
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role === 'assistant' && last.streaming) {
            const thinking = last.thinking || '';
            return [...current.slice(0, -1), { ...last, thinking: appendTranscriptSegment(thinking, chunk, addSegmentBreak) }];
          }
          return [...current, { role: 'assistant', content: '', thinking: chunk, turnId: activeTurnIdRef.current || undefined, streaming: true }];
        });
      }
      if (event.type === 'plan') {
        const items = Array.isArray(event.items) ? event.items as PlanItem[] : [];
        setPlan(items);
        if (Array.isArray(event.acceptanceCriteria)) setAcceptanceCriteria(event.acceptanceCriteria.filter((item): item is string => typeof item === 'string'));
      }
      if (event.type === 'approval_request') {
        setApproval({ actionId: String(event.actionId), name: String(event.name), arguments: event.arguments, workspace: String(event.workspace), mode: event.mode === 'per-session' ? 'per-session' : event.mode === 'per-task' ? 'per-task' : 'per-action' });
      }
      if (['cancelled', 'error', 'stopped_after_operation', 'generation_complete'].includes(String(event.type))) {
        setAgentQuestion(null);
        setQuestionAnswering(false);
      }
      if (event.type === 'session_saved') {
        const root = String(event.workspace || workspace);
        // A late save event from a previous workspace must not replace the
        // currently displayed project's session list.
        if (root && root === workspace) void refreshProjectSessions(root).catch(() => undefined);
        void refreshWorkspaceHistory('').catch(() => undefined);
      }
      if (event.type === 'generation_complete') {
        setPhase((current) => nextRunPhase(current, event));
      }
      if (event.type === 'generation_usage') setRunMetrics((current) => {
        const withFirstToken = typeof event.first_token_seconds === 'number'
          ? recordFirstToken(current, event.first_token_seconds)
          : current;
        return addGenerationUsage(withFirstToken, event.usage);
      });
      if (event.type === 'inference_settings') {
        const estimatedInput = Number(event.estimated_input_tokens);
        setAppliedSettings({ model: String(event.model), context: Number(event.requested_context), maxOutput: Number(event.max_output_tokens), reasoning: event.reasoning_override == null ? null : event.reasoning_override as boolean | string, estimatedInput: Number.isFinite(estimatedInput) ? estimatedInput : null });
        setRunMetrics((current) => recordInputEstimate(current, event.estimated_input_tokens));
      }
      if (event.type === 'complete') {
        setToolCallProgress([]);
        setApproval(null);
        setRunning(false); setPhase((current) => nextRunPhase(current, event));
        setWorkflowOutcome(typeof event.workflowOutcome === 'string' ? event.workflowOutcome : 'discussion');
        const evidence = readVerificationEvidence(event.verification);
        setVerificationEvidence(evidence);
        const verification = event.verification;
        const verificationStatus = verification && typeof verification === 'object' && 'status' in verification ? String(verification.status) : 'unknown';
        if (event.implementationRequested && verificationStatus === 'command_failed') {
          notify('An approved command failed and may have left partial project changes. Inspect the workspace before retrying.', 'warn');
        } else if (event.implementationRequested && evidence?.contract?.approved_command_results?.includes('uncertain')) {
          notify('An approved command stopped or timed out; it may have left partial project changes. Review the command output and workspace.', 'warn');
        } else if (event.implementationRequested && event.projectChanged && evidence?.contract?.post_change_inspection !== 'completed') {
          notify('Changes were made, but no successful post-change inspection was recorded. Treat this result as unverified.', 'warn');
        } else if (event.implementationRequested && evidence?.contract?.command_side_effects_possible && evidence.contract.post_command_inspection !== 'completed') {
          notify('An approved command may have changed project files, but no later inspection was recorded. Review the workspace before continuing.', 'warn');
        } else if (event.implementationRequested && event.workflowOutcome === 'implementation_unverified') {
          notify('The implementation result is unverified: project changes were not observed through structured file tools.', 'warn');
        }
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        setRunMetrics((current) => endGeneration(current));
        setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
      }
      if (event.type === 'cancelled') {
        setToolCallProgress([]);
        setWorkflowOutcome('cancelled');
        setApproval(null); setRunning(false); setPhase((current) => nextRunPhase(current, event)); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        setRunMetrics((current) => endGeneration(current));
        notify('This request was cancelled. Runtime processes and model state were left alone.', 'warn');
      }
      if (event.type === 'stopped_after_operation') {
        setWorkflowOutcome('stopped');
        setApproval(null); setRunning(false); setPhase('Stopped after active operation'); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setRunMetrics((current) => endGeneration(current));
        notify('The active operation was saved. No further model or tool calls were started.', 'warn');
      }
      if (event.type === 'error') {
        setToolCallProgress([]);
        setWorkflowOutcome(typeof event.workflowOutcome === 'string' ? event.workflowOutcome : 'failed');
        setVerificationEvidence(readVerificationEvidence(event.verification));
        setApproval(null);
        setRunning(false); setPhase((current) => nextRunPhase(current, event)); setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setTrace((current) => [...current, { id: crypto.randomUUID(), title: 'Run failed', description: String(event.error || 'The task failed.'), kind: 'error', time: Date.now() }]);
        setRunMetrics((current) => endGeneration(current));
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        notify(String(event.error || 'The task failed.'), 'bad');
      }
      if (event.type === 'run_idle') {
        setToolCallProgress([]);
        setApproval(null);
        setRunning(false);
        setOptions((current) => current.approvalMode === 'auto' ? { ...current, approvalMode: 'per-action' } : current);
        setRunMetrics((current) => endGeneration(current));
        setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
        setPhase((current) => nextRunPhase(current, event));
      }
      if (event.type === 'mcp_status') notify(String(event.text), event.text && (String(event.text).startsWith('MCP unavailable') || String(event.text).startsWith('MCP schema warning')) ? 'warn' : 'good');
      if (event.type === 'load_warn') notify(String(event.text), 'warn');
      if (event.type === 'context_limit') notify(String(event.error), 'bad');
    });
    const unsubscribeClose = window.agent.onCloseDecision(() => setCloseChoiceOpen(true));
    return () => { unsubscribe(); unsubscribeClose(); unsubscribeUpdate(); };
  }, [notify, refreshHome, refreshModels, refreshProjectSessions, refreshWorkspaceHistory, request, workspace]);

  useEffect(() => {
    if (view !== 'landing') return;
    const timer = window.setInterval(() => void refreshModels(true), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshModels, view]);

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
    }).catch(() => { if (current) setModelInfo(null); });
    return () => { current = false; };
  }, [model, request]);

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

  useEffect(() => {
    const sessionId = session?.session_id;
    const capturedWorkspace = session?.workspace || workspace;
    if (!running || !sessionId || !capturedWorkspace) return;
    let live = true;
    const reconcile = async () => {
      const cursor = liveSnapshotCursorRef.current;
      if (!live || cursor.busy) return;
      cursor.busy = true;
      try {
        const sameSession = cursor.sessionId === sessionId;
        const snapshot = await request<SessionLiveSnapshot>({
          command: 'session_live_snapshot', sessionId, workspace: capturedWorkspace,
          afterActivityRevision: sameSession ? cursor.activityRevision : 0,
          afterTextRevision: sameSession ? cursor.textRevision : 0,
        });
        if (!live || session?.session_id !== sessionId) return;
        const normalizePath = (value: string) => value.replace(/[\\/]+$/, '').toLocaleLowerCase();
        if (snapshot.sessionId !== sessionId || !snapshot.workspace
            || normalizePath(snapshot.workspace) !== normalizePath(capturedWorkspace)) return;
        if (snapshot.turnId && activeTurnIdRef.current && snapshot.turnId !== activeTurnIdRef.current) return;
        if (snapshot.conflict) {
          setSessionConflict({ id: sessionId, workspace: capturedWorkspace, versions: snapshot.conflict.versions || [] });
          setRunning(false);
          setPhase('Run ended · session copies need review');
          notify('The run ended, but the saved session copies diverged. Choose which copy to restore before continuing.', 'warn');
          return;
        }
        liveSnapshotCursorRef.current = {
          sessionId,
          activityRevision: Number.isFinite(snapshot.activityRevision) ? Number(snapshot.activityRevision) : cursor.activityRevision,
          textRevision: Number.isFinite(snapshot.textRevision) ? Number(snapshot.textRevision) : cursor.textRevision,
          busy: false,
        };
        if (snapshot.turnId) activeTurnIdRef.current = snapshot.turnId;
        if (Array.isArray(snapshot.activities)) setActivities((current) => mergeActivitySnapshot(current, snapshot.activities!));
        if (Array.isArray(snapshot.plan)) setPlan(snapshot.plan as PlanItem[]);
        if (Array.isArray(snapshot.acceptanceCriteria)) setAcceptanceCriteria(snapshot.acceptanceCriteria.filter((item): item is string => typeof item === 'string'));
        if (snapshot.liveAssistant && (snapshot.liveAssistant.content || snapshot.liveAssistant.thinking) && snapshot.turnId) {
          setMessages((current) => reconcileLiveAssistantMessage(current, snapshot.turnId!, snapshot.liveAssistant!));
        }
        const state = snapshot.runState || {};
        if (snapshot.savedTranscript && typeof state.status === 'string' && state.status !== 'running') {
          const saved = snapshot.savedTranscript;
          setMessages(restoreTranscriptMessages(saved.messages, saved.turns));
          const rows = snapshot.activities || [];
          setActivities(rows);
          setPlan(restorePlanItems(snapshot.plan, rows, snapshot.turnId) as PlanItem[]);
          setAcceptanceCriteria(snapshot.acceptanceCriteria || []);
          setWorkflowOutcome(typeof state.workflow_outcome === 'string' ? state.workflow_outcome : null);
          setVerificationEvidence(readVerificationEvidence(state.verification));
          const latestTurnId = snapshot.turnId;
          setRunMetrics(restoreRunMetrics((saved.usage_events || []).filter((row) => !latestTurnId || row.turn_id === latestTurnId)));
        }
        if (typeof state.started_at === 'number' && Number.isFinite(state.started_at)) {
          setStartedAt(state.started_at * 1000);
          setElapsed(Math.max(0, Date.now() - state.started_at * 1000));
        }
        if (typeof state.first_operation_seconds === 'number' && Number.isFinite(state.first_operation_seconds)) {
          setFirstOperationSeconds((current) => current ?? state.first_operation_seconds as number);
        }
        if (typeof state.first_file_write_seconds === 'number' && Number.isFinite(state.first_file_write_seconds)) {
          setFirstFileWriteSeconds((current) => current ?? state.first_file_write_seconds as number);
        }
        const phases: Record<string, string> = {
          waiting_response_headers: 'Waiting for response headers', waiting: 'Waiting for first token',
          reasoning: 'Reasoning', generating: 'Generating', processing_response: 'Processing response',
          working: 'Working', finishing: 'Finishing turn',
        };
        if (typeof state.phase === 'string' && phases[state.phase]) setPhase(phases[state.phase]);
        if (typeof state.request_first_token_seconds === 'number') setRunMetrics((current) => recordFirstToken(current, state.request_first_token_seconds));
        if (typeof state.status === 'string' && state.status !== 'running') {
          setRunning(false);
          setPhase(restoredRunPhase(state.status));
          setMessages((current) => current.map((row) => ({ ...row, streaming: false })));
          setRunMetrics((current) => endGeneration(current));
        }
      } catch {
        // Transient IPC and checkpoint errors are retried on the next poll; they
        // must never turn a slow but active model request into a failed run.
      } finally {
        if (live) liveSnapshotCursorRef.current.busy = false;
      }
    };
    void reconcile();
    const interval = window.setInterval(() => void reconcile(), 1500);
    return () => { live = false; window.clearInterval(interval); };
  }, [request, running, session?.session_id, session?.workspace, workspace]);

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
      runtimeWorkerCount: typeof snapshot.runtime_worker_count === 'number' ? snapshot.runtime_worker_count : 0,
      runtimeWorkerCpu: typeof snapshot.runtime_worker_cpu_percent === 'number' ? Math.round(snapshot.runtime_worker_cpu_percent) : null,
      runtimeWorkerRss: typeof snapshot.runtime_worker_rss_bytes === 'number' ? `${(snapshot.runtime_worker_rss_bytes / 1024 ** 3).toFixed(2)} GB` : '—',
      runtimeGpuMemory: typeof snapshot.runtime_gpu_memory_mib === 'number' ? snapshot.runtime_gpu_memory_mib : null,
    };
  }, [model, options.context, snapshot]);

  async function chooseWorkspace() {
    const selected = await window.agent.chooseWorkspace();
    if (selected) await showProject(selected);
  }

  async function preloadSelectedModel(selectedModel = model) {
    if (!selectedModel || selectedModel.startsWith('gguf::') || running || modelPreloading) return;
    try {
      await request({
        command: 'ollama_preload', model: selectedModel, context: options.context, keepAlive: options.keepAlive,
      });
    } catch (error) { notify(`Could not preload model: ${(error as Error).message}`, 'bad'); }
  }

  function selectModel(selectedModel: string) {
    setModel(selectedModel);
    setOptions((old) => old.reasoning === null ? old : { ...old, reasoning: null });
    if (selectedModel && !selectedModel.startsWith('gguf::')) void preloadSelectedModel(selectedModel);
  }

  async function newSession(selectedActivityMode?: ActivityMode) {
    if (!workspace) { await chooseWorkspace(); return; }
    if (!selectedActivityMode && askActivityChoice) { setActivityChoiceOpen(true); return; }
    try {
      const selectedModel = model;
      if (!selectedModel) { notify('Add or install a local model from Model Library before starting a session.', 'warn'); setModelLibraryOpen(true); return; }
      await request<ModelInfo>({ command: 'model_info', model: selectedModel });
      const tokenPreferences = readRunTokenPreferences(localStorage.getItem('agent-run-token-preferences'));
      const chosenMode = selectedActivityMode || activityDefault;
      const created = await request<Session>({ command: 'session_new', workspace, model: selectedModel, context: tokenPreferences.context, activityMode: chosenMode });
      setSession(created); setMessages([]); setTrace([]); setPlan([]); setAcceptanceCriteria([]); setWorkflowOutcome(null); setVerificationEvidence(null); setPrompt(''); setElapsed(0); setPhase('Ready'); setView('session');
      setActivities([]); setActivityMode(chosenMode); sessionStorage.setItem('agent-activity-mode', chosenMode);
      setRunMetrics(emptyRunMetrics());
      setFirstOperationSeconds(null);
      setFirstFileWriteSeconds(null);
      setOptions((old) => ({ ...old, context: created.context, maxTokens: tokenPreferences.maxTokens, approvalMode: 'per-action', reasoning: null }));
      void refreshWorkspace(workspace);
      window.setTimeout(() => promptRef.current?.focus(), 60);
    } catch (error) { notify(`Could not start a session: ${(error as Error).message}`, 'bad'); }
  }

  async function startRun(queuedPrompt?: QueuedPrompt) {
    if (modelPreloading) { notify('Wait for the selected model to finish preloading before starting this task.', 'warn'); return; }
    const task = queuedPrompt?.prompt.trim() || prompt.trim();
    if (running || !session || !workspace || !model || !task) return;
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
    assistantSegmentBreakRef.current = false;
    const run: RunOptions = {
      workspace, sessionId: session.session_id, prompt: task, model, providerId: model.startsWith('gguf::') ? 'llama.cpp' : 'ollama',
      context: options.context, maxTokens: options.maxTokens, temperature: options.temperature,
      access: options.access, approvalMode: options.approvalMode, keepAlive: options.keepAlive,
      reasoning: normalizeReasoningChoice(options.reasoning, modelInfo?.reasoning ?? null),
      harnessProfile: options.harnessProfile,
      taskIntent: options.taskIntent,
      skillsEnabled: options.skillsEnabled, skillSources: options.skillSources,
      ...(queuedPrompt ? { queuedPromptId: queuedPrompt.id } : {}),
    };
    if (options.approvalMode === 'auto') setOptions((current) => ({ ...current, approvalMode: 'per-action' }));
    setMessages((current) => [...current, { role: 'user', content: task }]);
    // Keep the current checklist and criteria visible until the sidecar publishes
    // the captured task's authoritative plan. Same-task continuations do not emit
    // a new seed plan.
    setTrace([]); setWorkflowOutcome(null); setVerificationEvidence(null); setPrompt(''); setRunning(true); setPhase('Connecting to Ollama');
    setStartedAt(Date.now()); setElapsed(0); setRunMetrics(emptyRunMetrics()); setFirstOperationSeconds(null); setFirstFileWriteSeconds(null);
    try { await request({ command: 'run_start', options: run }); }
    catch (error) {
      setRunning(false); setPhase('Run failed'); setWorkflowOutcome('failed'); setPrompt(task);
      setMessages((current) => current.at(-1)?.role === 'user' && current.at(-1)?.content === task && !current.at(-1)?.turnId
        ? current.slice(0, -1) : current);
      notify((error as Error).message, 'bad');
    }
  }

  async function queueFollowupPrompt() {
    if (!running || queueSubmitting || !session || !workspace || !prompt.trim()) return;
    setQueueSubmitting(true);
    try {
      const result = await request<{ queuedPrompts: QueuedPrompt[] }>({
        command: 'session_queue_prompt', sessionId: session.session_id, workspace, prompt: prompt.trim(),
      });
      setSession((current) => current?.session_id === session.session_id ? { ...current, queued_prompts: result.queuedPrompts } : current);
      setPrompt('');
      notify('Follow-up saved for this session. It will not interrupt the active run.');
    } catch (error) { notify(`Could not save follow-up: ${(error as Error).message}`, 'bad'); }
    finally { setQueueSubmitting(false); }
  }

  async function steerActiveTask() {
    if (!running || steeringSubmitting || !session || !workspace || !prompt.trim()) return;
    setSteeringSubmitting(true);
    try {
      await request({ command: 'session_steer', sessionId: session.session_id, workspace, prompt: prompt.trim() });
      setPrompt('');
    } catch (error) { notify(`Could not steer the active task: ${(error as Error).message}`, 'bad'); }
    finally { setSteeringSubmitting(false); }
  }

  async function removeQueuedPrompt(queuedPromptId: string) {
    if (!session || !workspace) return;
    try {
      const result = await request<{ queuedPrompts: QueuedPrompt[] }>({
        command: 'session_queue_remove', sessionId: session.session_id, workspace, queuedPromptId,
      });
      setSession((current) => current?.session_id === session.session_id ? { ...current, queued_prompts: result.queuedPrompts } : current);
    } catch (error) { notify(`Could not remove queued follow-up: ${(error as Error).message}`, 'bad'); }
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
    if (action === 'continue') { setCancelChoiceOpen(false); return; }
    setCancelChoicePending(action);
    try {
      if (action === 'cancel') {
        const result = await request<{ cancelled: boolean }>({ command: 'run_cancel' });
        if (result.cancelled) setPhase('Cancelling request');
        else notify('The run had already ended; there was nothing left to cancel.', 'warn');
      } else {
        const result = await request<{ requested: boolean }>({ command: 'run_stop_after_operation' });
        if (result.requested) setPhase('Finishing active operation');
        else notify('The run had already ended; there is no active operation to finish.', 'warn');
      }
      setCancelChoiceOpen(false);
    } catch (error) { notify(`Could not update the run: ${(error as Error).message}`, 'bad'); }
    finally { setCancelChoicePending(null); }
  }

  async function answerApproval(approved: boolean) {
    if (!approval) return;
    const action = approval;
    setApproval(null);
    try {
      const accepted = await request<boolean>({ command: 'approval_reply', actionId: action.actionId, approved });
      if (!accepted) {
        setApproval(action);
        notify('The approval request is no longer active or could not be saved; no action was approved.', 'warn');
      }
    } catch (error) { setApproval(action); notify((error as Error).message, 'bad'); }
  }

  async function answerAgentQuestion(answer: string) {
    if (!agentQuestion || !answer.trim() || questionAnswering) return;
    setQuestionAnswering(true);
    try {
      const result = await request<{ answered: boolean }>({ command: 'question_reply', questionId: agentQuestion.questionId, answer: answer.trim() });
      if (!result.answered) {
        setQuestionAnswering(false);
        setAgentQuestion((current) => current?.questionId === agentQuestion.questionId ? null : current);
        notify('That question is no longer waiting for an answer.', 'warn');
      }
    } catch (error) {
      setQuestionAnswering(false);
      notify(`Could not send your answer: ${(error as Error).message}`, 'bad');
    }
  }

  async function chooseCloseAction(choice: 'keep' | 'hide' | 'cancel-close') {
    setCloseChoicePending(choice);
    try {
      await window.agent.resolveCloseChoice(choice);
      setCloseChoiceOpen(false);
    } catch (error) {
      notify(`The close choice was not completed: ${(error as Error).message}`, 'bad');
    } finally { setCloseChoicePending(null); }
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

  async function openTools() {
    setToolsOpen(true); setToolCatalogLoading(true);
    try { setToolCatalog(await request<ToolCatalog>({ command: 'tool_catalog' })); }
    catch (error) { notify(`Could not load tool capabilities: ${(error as Error).message}`, 'bad'); }
    finally { setToolCatalogLoading(false); }
  }

  async function openPermissions() {
    setPermissionsLoading(true);
    try {
      if (!toolCatalog) {
        try { setToolCatalog(await request<ToolCatalog>({ command: 'tool_catalog' })); }
        catch { /* Wildcard and built-in rules remain editable if capability discovery is offline. */ }
      }
      const rules = await request<PermissionRule[]>({ command: 'permission_rules_get' });
      setPermissionRules(rules.map((rule) => ({
        tool: rule.tool, decision: rule.decision,
        scope: rule.path_glob ? 'path' : rule.command_prefix ? 'command' : 'tool',
        value: rule.path_glob || (Array.isArray(rule.command_prefix) ? JSON.stringify(rule.command_prefix) : rule.command_prefix || ''),
      })));
      setPermissionsOpen(true);
    } catch (error) { notify(`Could not load tool permissions: ${(error as Error).message}`, 'bad'); }
    finally { setPermissionsLoading(false); }
  }

  async function savePermissionRules() {
    if (running) { notify('Permission rules cannot change during an active run.', 'warn'); return; }
    try {
      const rules: PermissionRule[] = permissionRules.map((draft) => {
        const base: PermissionRule = { tool: draft.tool, decision: draft.decision };
        if (draft.scope === 'path') {
          if (!draft.value.trim()) throw new Error(`Rule ${draft.tool} needs a project-relative path pattern.`);
          base.path_glob = draft.value.trim();
        }
        if (draft.scope === 'command') {
          base.command_prefix = parsePermissionCommandPrefix(draft.tool as '*' | 'run_command' | 'run_shell', draft.value);
        }
        return base;
      });
      await request({ command: 'permission_rules_set', rules });
      setPermissionsOpen(false); notify('Tool permission rules saved. Deny rules override allow and auto-approval.');
    } catch (error) { notify(`Could not save tool permissions: ${(error as Error).message}`, 'bad'); }
  }

  async function saveMcp() {
    try {
      const config = JSON.parse(mcpJson) as unknown;
      await request({ command: 'mcp_config_set', config }); setMcpOpen(false); notify('Local MCP configuration saved.');
    } catch (error) { notify(`Could not save MCP settings: ${(error as Error).message}`, 'bad'); }
  }

  async function saveSettings() {
    if (running) { notify('Run settings cannot be applied to the saved session while its task is active.', 'warn'); return; }
    if (!Number.isSafeInteger(options.context) || options.context < 1024 || !Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.temperature < 0 || options.temperature > 2) {
      notify('Context and output must be exact whole numbers (context at least 1,024, output at least 1); temperature must be between 0 and 2.', 'bad'); return;
    }
    localStorage.setItem('agent-activity-default', activityDefault);
    localStorage.setItem('agent-ask-activity', String(askActivityChoice));
    localStorage.setItem('agent-harness-profile', options.harnessProfile);
    localStorage.setItem('agent-task-intent', options.taskIntent);
    localStorage.setItem('agent-skills-enabled', String(options.skillsEnabled));
    localStorage.setItem('agent-skill-sources', JSON.stringify(options.skillSources));
    localStorage.setItem('agent-run-token-preferences', JSON.stringify({ context: options.context, maxTokens: options.maxTokens }));
    sessionStorage.setItem('agent-activity-mode', activityMode);
    setSettingsOpen(false);
    if (session) {
      try {
        const saved = await request<Session>({ command: 'session_run_settings', sessionId: session.session_id, settings: {
          model, context: options.context, maxTokens: options.maxTokens, temperature: options.temperature,
          access: options.access, approvalMode: options.approvalMode, keepAlive: options.keepAlive,
          reasoning: options.reasoning, harnessProfile: options.harnessProfile,
          taskIntent: options.taskIntent,
          skillsEnabled: options.skillsEnabled, skillSources: options.skillSources,
        } });
        const activitySaved = await request<{ app_saved: boolean; project_saved: boolean }>({ command: 'session_activity_mode', sessionId: session.session_id, activityMode });
        setSession({ ...saved, activity_mode: activityMode });
        if (!activitySaved.app_saved || !activitySaved.project_saved) notify('Run settings were saved, but one activity-view mirror did not save.', 'warn');
      } catch (error) { notify(`App defaults were saved, but the selected session settings were not: ${(error as Error).message}`, 'warn'); }
    }
  }

  function enter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void startRun(); }
  }

  const readyToRun = installed && connected === 'yes' && !!workspace && !!session && !!model && !!prompt.trim() && !running && !modelPreloading;

  return <div className="app-shell">
    <WindowControls />
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
        <label><small>LOCAL MODEL</small><select value={model} onChange={(e) => selectModel(e.target.value)} disabled={running || modelPreloading}>
          {!models.length && <option value="">{modelCatalogStatus === 'loading' || modelCatalogStatus === 'refreshing' ? 'Syncing model inventory…' : modelCatalogStatus === 'error' ? 'Model inventory unavailable' : 'No local models'}</option>}{models.map((name) => <option value={name} key={name}>{displayModelLabels[name] || shortModel(name)}</option>)}
        </select></label><button className="model-preload-button" type="button" onClick={() => void preloadSelectedModel()} disabled={running || modelPreloading || !model || model.startsWith('gguf::')} title="Preload the selected Ollama model without changing reasoning or token settings">{modelPreloading ? 'WARMING…' : 'PRELOAD'}</button>
      </div>
      <div className={`connection-pill no-drag ${model.startsWith('gguf::') ? (snapshot.llama && (snapshot.llama as Record<string, unknown>).running ? 'yes' : 'no') : connected}`}><span className="connection-light"/>{model.startsWith('gguf::') ? snapshot.llama && (snapshot.llama as Record<string, unknown>).running ? 'GGUF LOADED' : 'GGUF NOT LOADED' : connected === 'yes' ? 'OLLAMA READY' : connected === 'no' ? 'OLLAMA OFFLINE' : 'CHECKING'}</div>
      <Button kind="quiet" className="top-settings no-drag" onClick={() => setModelLibraryOpen(true)}>Model library</Button>
      <Button kind="quiet" className="top-settings no-drag" onClick={() => setSettingsOpen(true)}>Settings <span className="keycap">CTRL ,</span></Button>
    </header>

    <main className="main-stage">
      {view === 'landing' && <Landing
        workspaces={workspaces} workspaceSearch={workspaceSearch} workspaceHistoryStatus={workspaceHistoryStatus} sessions={homeSessions} sessionHistoryStatus={sessionHistoryStatus} onOpenSession={(id, root) => void loadSession(id, root)} models={models} modelLabels={displayModelLabels} modelCatalogStatus={modelCatalogStatus} model={model} modelPreloading={modelPreloading} context={options.context}
        connected={connected} telemetry={telemetry} onChoose={chooseWorkspace} onOpen={showProject}
        onModel={selectModel} onRefresh={() => { void refreshHome().catch((error) => notify(`Could not refresh saved history: ${(error as Error).message}`, 'warn')); void refreshModels(); }}
        onModelInfo={(name) => request<ModelInfo>({ command: 'model_info', model: name })}
        onSearch={(value) => { setWorkspaceSearch(value); void refreshWorkspaceHistory(value).catch(() => undefined); }}
        onPin={(root, pinned) => void request({ command: 'workspace_pin', workspace: root, pinned }).then(() => refreshWorkspaceHistory(workspaceSearch)).catch((error) => notify((error as Error).message, 'warn'))}
        onRemove={(root) => void request({ command: 'workspace_remove', workspace: root }).then(() => refreshWorkspaceHistory(workspaceSearch)).catch((error) => notify((error as Error).message, 'warn'))}
        onLibrary={() => setModelLibraryOpen(true)}
        onInstallOllama={() => void window.agent.openOllamaDownload().catch((error) => notify(`Could not open Ollama setup: ${(error as Error).message}`, 'bad'))}
      />}
      {view === 'project' && <ProjectHome
        root={workspace} tab={projectTab} setTab={setProjectTab} files={availableFiles} sessions={currentSessions} sessionHistoryStatus={projectSessionHistoryStatus}
        onNew={() => void newSession()} onOpenSession={(id) => void loadSession(id, workspace)} onFiles={() => void refreshWorkspace(workspace)}
        onRefreshSessions={() => void refreshProjectSessions(workspace).catch((error) => notify(`Saved sessions could not be refreshed: ${(error as Error).message}`, 'warn'))}
        onDiff={showDiff} onMcp={openMcp} onTools={openTools} running={running}
        onHome={() => { setView('landing'); void refreshHome().catch((error) => notify(`Could not refresh saved workspace history: ${(error as Error).message}`, 'warn')); }}
      />}
      {view === 'session' && <SessionRoom
        root={workspace} session={session} messages={messages} activities={activities} activityMode={activityMode} plan={plan} acceptanceCriteria={acceptanceCriteria} phase={phase} workflowOutcome={workflowOutcome} verificationEvidence={verificationEvidence} toolCallProgress={toolCallProgress}
        elapsed={elapsed} running={running} prompt={prompt} setPrompt={setPrompt} promptRef={promptRef}
        queuedPrompts={session?.queued_prompts || []} onQueue={queueFollowupPrompt} onSteer={steerActiveTask} onRemoveQueued={removeQueuedPrompt} queueSubmitting={queueSubmitting} steeringSubmitting={steeringSubmitting}
        options={options} setOptions={setOptions} files={availableFiles} telemetry={telemetry}
        runMetrics={runMetrics} firstOperationSeconds={firstOperationSeconds} firstFileWriteSeconds={firstFileWriteSeconds} onRun={() => void startRun()} onRunQueued={(item) => void startRun(item)} onCancel={cancelRun} onSettings={() => setSettingsOpen(true)} onBack={() => { if (!running) setView('project'); }}
        onDiff={showDiff} onMcp={openMcp} onTools={openTools} onEnter={enter} endRef={endRef} model={model} modelInfo={modelInfo} appliedSettings={appliedSettings} onToggleHarnessProfile={() => void toggleHarnessProfile()}
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
    {settingsOpen && <SettingsModal model={model} modelLabel={displayModelLabels[model] || shortModel(model)} modelInfo={modelInfo} options={options} setOptions={setOptions} activityDefault={activityDefault} setActivityDefault={setActivityDefault} activityMode={activityMode} setActivityMode={setActivityMode} askActivityChoice={askActivityChoice} setAskActivityChoice={setAskActivityChoice} hasSession={!!session} running={running} updateState={updateState} onCheckUpdate={() => void window.agent.checkForUpdate().then(setUpdateState).catch((error) => setUpdateState((state) => ({ ...state, status: 'error', error: (error as Error).message })))} onInstallUpdate={() => void window.agent.installUpdate().then((result) => { if (!result.installed) notify(result.reason || 'Update installation is unavailable.', 'warn'); }).catch((error) => notify(`Could not apply update: ${(error as Error).message}`, 'bad'))} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onMcp={openMcp} onPermissions={() => void openPermissions()} />}
    {permissionsOpen && <PermissionRulesModal rules={permissionRules} setRules={setPermissionRules} tools={toolCatalog?.tools || []} loading={permissionsLoading} running={running} onClose={() => setPermissionsOpen(false)} onSave={savePermissionRules} />}
    {modelLibraryOpen && <ModelLibraryModal model={model} models={models} modelLabels={displayModelLabels} context={options.context} reasoning={options.reasoning} downloadedDirectory={downloadedModelDirectory} onModel={selectModel} onRefresh={refreshModels} onClose={() => setModelLibraryOpen(false)} notify={notify}/>}
    {mcpOpen && <Modal title="MCP connections" eyebrow="EXTEND THE TOOLSET" onClose={() => setMcpOpen(false)}>
      <p className="modal-copy">Connect local stdio or remote Streamable HTTP servers. Tool calls require approval by default; matching persistent permission rules can allow, ask, or deny them. Use HTTPS for remote servers; reference credentials as <code>${'{ENV:VARIABLE_NAME}'}</code> so secrets stay out of this file. MCP servers can access whatever their own process/account permits.</p>
      <textarea className="code-editor mcp-editor" value={mcpJson} onChange={(e) => setMcpJson(e.target.value)} spellCheck={false}/>
      <div className="modal-actions"><Button kind="quiet" onClick={() => setMcpOpen(false)}>Cancel</Button><Button kind="bright" onClick={() => void saveMcp()}>Save connections</Button></div>
    </Modal>}
    {toolsOpen && <Modal title="Tools and integrations" eyebrow="CAPABILITY DIRECTORY" onClose={() => setToolsOpen(false)}>
      <p className="tool-catalog-intro">This directory reports actual built-in and configured tools. Local MCP is the extension path for additional services; model support and permission still apply.</p>
      {toolCatalogLoading && <div className="empty-state">Loading installed capabilities…</div>}
      {toolCatalog && <>
        <div className="tool-catalog-grid">{toolCatalog.integrations.map((item) => <article className="tool-catalog-card" key={item.name}><span className={`tool-status status-${item.status}`}>{item.status}</span><strong>{item.name}</strong><small>{item.detail}</small></article>)}</div>
        <div className="section-heading tool-catalog-heading"><div><span className="section-number">01</span><h2>Available tools · {toolCatalog.tools.length}</h2></div><Button kind="outline" onClick={openMcp}>Configure MCP</Button></div>
        <div className="tool-directory">{toolCatalog.tools.map((item) => <div className="tool-directory-row" key={`${item.source}:${item.name}`}><code>{item.name}</code><span>{item.description}</span><small>{item.source} · {item.permission}</small></div>)}{!toolCatalog.tools.length && <div className="empty-state">No connected tools are available yet.</div>}</div>
        {toolCatalog.mcpServers.length > 0 && <div className="tool-server-list"><b>Configured MCP servers</b>{toolCatalog.mcpServers.map((server) => <span key={server.name}><code>{server.name}</code><i className={`tool-status status-${server.status}`}>{server.status}</i>{server.detail && <small>{server.detail}</small>}</span>)}</div>}
      </>}
      <div className="modal-actions"><Button kind="quiet" onClick={() => setToolsOpen(false)}>Close</Button><Button kind="bright" onClick={openMcp}>Manage integrations</Button></div>
    </Modal>}
    {approval && <ApprovalModal approval={approval} onChoice={(yes) => void answerApproval(yes)} onCancelRun={() => void cancelRun()} />}
    {agentQuestion && <AgentQuestionModal question={agentQuestion} disabled={questionAnswering} onAnswer={(answer) => void answerAgentQuestion(answer)} onCancelRun={() => void cancelRun()} />}
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
      {(() => {
        const runState = recoverySession.run_state;
        const savedOperations = runState?.uncertain_operations;
        const operations = Array.isArray(savedOperations)
          ? savedOperations.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          : typeof runState?.uncertain_operation === 'object' && runState.uncertain_operation !== null
            ? [runState.uncertain_operation as Record<string, unknown>]
            : [];
        return operations.length > 0 && <div className="approval-context"><span>REVIEW BEFORE RETRYING · {operations.length} OPERATION{operations.length === 1 ? '' : 'S'}</span>{operations.map((operation, index) => <code key={String(operation.operationId ?? index)}>{JSON.stringify(operation)}</code>)}</div>;
      })()}
      <div className="activity-mode-choices"><button className="activity-mode-choice recommended" onClick={() => void recoverInterruptedRun('resume').catch((error) => notify(`Recovery failed: ${(error as Error).message}`, 'bad'))}><b>Continue from safe checkpoint</b><small>Inspect any uncertain effect before proposing another action.</small></button><button className="activity-mode-choice" onClick={() => void recoverInterruptedRun('retry').catch((error) => notify(`Recovery failed: ${(error as Error).message}`, 'bad'))}><b>Retry interrupted task</b><small>The model is explicitly warned to inspect before repeating uncertain work.</small></button><button className="activity-mode-choice" onClick={() => void recoverInterruptedRun('restore').catch((error) => notify(`Recovery failed: ${(error as Error).message}`, 'bad'))}><b>Restore history only</b><small>Keep the transcript and activity without continuing the task.</small></button></div>
    </Modal>}
    {cancelChoiceOpen && <Modal title="What should happen to this run?" eyebrow="RUN IS ACTIVE" dismissible={false} onClose={() => undefined}>
      <p className="modal-copy">Choose how to stop. Received text and completed tool results are saved before the run ends.</p>
      <div className="activity-mode-choices"><button className="activity-mode-choice" disabled={cancelChoicePending !== null} onClick={() => void chooseCancelAction('continue')}><b>Keep it running</b><small>Close this prompt and let the current task continue.</small></button><button className="activity-mode-choice danger-choice" disabled={cancelChoicePending !== null} onClick={() => void chooseCancelAction('cancel')}><b>{cancelChoicePending === 'cancel' ? 'Sending cancel…' : 'Cancel now'}</b><small>Interrupt the current request and save output already received.</small></button><button className="activity-mode-choice recommended" disabled={cancelChoicePending !== null} onClick={() => void chooseCancelAction('finish')}><b>{cancelChoicePending === 'finish' ? 'Finishing active operation…' : 'Finish the active operation, then stop'}</b><small>Save the current tool result and stop before the next model or tool call.</small></button></div>
    </Modal>}
    {closeChoiceOpen && <Modal title="A task is still running" eyebrow="CLOSE WORKBENCH" dismissible={false} onClose={() => undefined}>
      <p className="modal-copy">The task is still active. Choose whether to keep the window open, hide it while work continues, or cancel and close.</p>
      <div className="activity-mode-choices"><button className="activity-mode-choice" disabled={closeChoicePending !== null} onClick={() => void chooseCloseAction('keep')}><b>{closeChoicePending === 'keep' ? 'Returning to the task…' : 'Keep the app open'}</b><small>Return to the live task.</small></button><button className="activity-mode-choice recommended" disabled={closeChoicePending !== null} onClick={() => void chooseCloseAction('hide')}><b>{closeChoicePending === 'hide' ? 'Hiding to background…' : 'Hide to background and continue'}</b><small>The workbench keeps running in the system tray.</small></button><button className="activity-mode-choice danger-choice" disabled={closeChoicePending !== null} onClick={() => void chooseCloseAction('cancel-close')}><b>{closeChoicePending === 'cancel-close' ? 'Saving and closing…' : 'Cancel the run and close'}</b><small>Wait for the current request to stop and save its received output.</small></button></div>
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

function Landing({ workspaces, workspaceSearch, workspaceHistoryStatus, sessions, sessionHistoryStatus, onOpenSession, models, modelLabels, modelCatalogStatus, model, modelPreloading, context, connected, telemetry, onChoose, onOpen, onModel, onModelInfo, onRefresh, onSearch, onPin, onRemove, onLibrary, onInstallOllama }: {
  workspaces: WorkspaceHistoryEntry[]; workspaceSearch: string; workspaceHistoryStatus: 'loading' | 'ready' | 'error'; sessions: SessionSummary[]; sessionHistoryStatus: 'loading' | 'ready' | 'error'; models: string[]; modelLabels: Record<string, string>; modelCatalogStatus: 'loading' | 'refreshing' | 'ready' | 'error'; model: string; modelPreloading: boolean; context: number; connected: string;
  onOpenSession: (id: string, workspace: string) => void;
  telemetry: TelemetryView;
  onChoose: () => void; onOpen: (root: string) => void; onModel: (name: string) => void; onModelInfo: (name: string) => Promise<ModelInfo>; onRefresh: () => void;
  onSearch: (value: string) => void; onPin: (root: string, pinned: boolean) => void; onRemove: (root: string) => void; onLibrary: () => void; onInstallOllama: () => void;
}) {
  const installedCount = modelCatalogStatus === 'loading' || modelCatalogStatus === 'refreshing' ? 'SYNC' : modelCatalogStatus === 'error' && !models.length ? '—' : String(models.length).padStart(2, '0');
  return <section className="landing-view">
    <div className="landing-grid">
      <div className="landing-copy">
        <div className="eyebrow-line"><span className="eyebrow-mark"/> PRIVATE DEVELOPMENT / LOCAL FIRST</div>
        <h1>Give the model<br/><span>room to work.</span></h1>
        <p className="landing-description">A development desk for patient local agents. Keep the full project in view, see what the model is doing, and decide what reaches your files.</p>
        <div className="launch-actions"><Button kind="bright" onClick={onChoose}><Icon name="folder"/> Open a project <Icon name="arrow"/></Button><span className="launch-note"><kbd>CTRL</kbd> <b>+</b> <kbd>O</kbd> to switch workspaces</span></div>
        <div className="landing-stats"><div><small>INSTALLED MODELS</small><strong>{installedCount}{modelCatalogStatus === 'error' && models.length ? '*' : ''}</strong></div><div><small>ACTIVE CONTEXT</small><strong>{fmt(context)} <i>tokens</i></strong></div><div><small>LOCAL ENGINE</small><strong className={connected === 'yes' ? 'text-mint' : connected === 'no' ? 'text-rose' : ''}>{connected === 'yes' ? 'ONLINE' : connected === 'no' ? 'OFFLINE' : 'CHECKING'}</strong></div></div>
        {modelCatalogStatus === 'error' && models.length > 0 && <small className="catalog-stale-note">Showing the last synced inventory; refresh failed.</small>}
      </div>
      <div className="landing-visual" aria-label="Installed local models arranged around the local AI workspace">
        <LocalModelOrbit models={models} labels={modelLabels} selectedModel={model} status={modelCatalogStatus} onModelInfo={onModelInfo} />
        <div className="visual-core"><span>LOCAL</span><strong>AI</strong><small>WORKS IN YOUR SPACE</small></div>
        <div className="orbit-label label-tl"><i/> PRIVATE BY DEFAULT</div><div className="orbit-label label-br"><i/> NO REMOTE ROUTING</div>
        <div className="visual-coordinate">[LOCATION REMOVED]<br/>[LOCATION REMOVED]</div>
      </div>
    </div>
    {workspaceHistoryStatus === 'ready' && !workspaceSearch && !workspaces.length && <section className="first-run-guide" aria-label="First run setup">
      <div><span className="eyebrow-line">QUICK SETUP / NO MODEL LOAD ON LAUNCH</span><h2>Ready your first workspace</h2><p>The app bundles its agent service. Connect a runtime, select or add a local model, then open a project. A model starts only when you explicitly run or preload it.</p></div>
      <div className="first-run-steps"><span className={connected === 'yes' ? 'step-ready' : ''}><b>01</b><strong>{connected === 'yes' ? 'Runtime connected' : 'Connect a runtime'}</strong><small>{connected === 'yes' ? 'Ollama is reachable' : 'Ollama or local GGUF server'}</small></span><span className={modelCatalogStatus === 'ready' && models.length ? 'step-ready' : ''}><b>02</b><strong>{modelCatalogStatus === 'loading' || modelCatalogStatus === 'refreshing' ? 'Syncing local models' : modelCatalogStatus === 'error' ? 'Model inventory unavailable' : models.length ? `${models.length} model${models.length === 1 ? '' : 's'} available` : 'Choose a model'}</strong><small>{modelCatalogStatus === 'ready' && !models.length ? 'Browse installed or add one' : modelCatalogStatus === 'loading' || modelCatalogStatus === 'refreshing' ? 'Waiting for the local catalog' : 'Your installed models remain unchanged'}</small></span><button onClick={onChoose}><b>03</b><strong>Open a project</strong><small>Keep files and sessions scoped</small></button></div>
    </section>}
    <div className="landing-lower">
      <div className="landing-column">
        <div className="section-heading"><div><span className="section-number">01</span><h2>Recent workspaces</h2></div><button onClick={onRefresh}><Icon name="refresh"/> Refresh</button></div>
        <input className="workspace-history-search" value={workspaceSearch} onChange={(event) => onSearch(event.target.value)} placeholder="Search workspace history…" aria-label="Search workspace history"/>
        {workspaceHistoryStatus === 'error' && workspaces.length > 0 && <small className="workspace-history-stale" role="status">Refresh failed; showing the last saved workspace history.</small>}
        {workspaceHistoryStatus === 'loading' && !workspaces.length ? <div className="empty-inline" role="status"><span className="empty-art"><Icon name="folder"/></span><span><b>Loading saved workspace history…</b><small>Recent projects remain saved while the app reconnects.</small></span></div> : workspaces.length ? <div className="project-tiles workspace-history-list">{workspaces.map((entry) => <div key={`${entry.path}-${entry.first_opened_at}`} className={`workspace-history-row ${entry.available ? '' : 'unavailable'}`}>
          <button className="project-tile-main" disabled={!entry.available} onClick={() => onOpen(entry.path)}><span className="tile-glyph"><Icon name="folder"/></span><span><strong>{shortPath(entry.path)}{entry.pinned ? ' · PINNED' : ''}</strong><small>{entry.path}</small><em>{entry.available ? 'AVAILABLE' : 'FOLDER UNAVAILABLE'}</em></span><Icon name="arrow"/></button>
          <button className="workspace-history-action" title={entry.pinned ? 'Unpin workspace' : 'Pin workspace'} onClick={() => onPin(entry.path, !entry.pinned)}>{entry.pinned ? 'Unpin' : 'Pin'}</button>
          <button className="workspace-history-action remove" title="Remove from workspace history" onClick={() => onRemove(entry.path)}>Remove</button>
        </div>)}</div> : <div className="empty-inline" role={workspaceHistoryStatus === 'error' ? 'alert' : undefined}><span className="empty-art"><Icon name="folder"/></span><span><b>{workspaceHistoryStatus === 'error' ? 'Saved workspace history could not be loaded.' : workspaceSearch ? 'No workspaces match this search.' : 'No workspace has been opened here yet.'}</b><small>{workspaceHistoryStatus === 'error' ? 'Your history has not been removed. Refresh to try again.' : 'Open a project folder to add it to persistent local history.'}</small></span></div>}
      </div>
      <div className="landing-column home-sessions-column">
        <div className="section-heading"><div><span className="section-number">02</span><h2>Recent sessions</h2></div><span className="source-status">{sessionHistoryStatus === 'loading' ? 'SYNCING' : sessionHistoryStatus === 'error' ? 'LAST SYNC FAILED' : `${sessions.length} SAVED`}</span></div>
        {sessionHistoryStatus === 'loading' && !sessions.length ? <div className="empty-inline" role="status"><span><b>Loading saved sessions…</b><small>Session history remains in the app library and project folders.</small></span></div> : sessions.length ? <div className="home-session-list">{sessions.map((row) => {
          const relocatedWorkspace = row.workspace_id ? workspaces.find((entry) => entry.available && entry.workspace_id === row.workspace_id)?.path : undefined;
          const sessionWorkspace = relocatedWorkspace || row.workspace;
          const canResume = row.workspace_available !== false || Boolean(relocatedWorkspace);
          return <div className={`home-session-row${canResume ? '' : ' unavailable'}`} key={row.session_id}>
            <button disabled={!canResume} onClick={() => onOpenSession(row.session_id, sessionWorkspace)} title={canResume ? `Resume in ${sessionWorkspace}` : 'The project folder is unavailable. The saved session remains in the app library.'}>
              <strong>{row.model_id || shortModel(row.model)}</strong><small>{sessionWorkspace}</small><em>{new Date(row.updated_at * 1000).toLocaleString()} · {row.session_id.slice(0, 8)}</em>
            </button>
            <span className={row.sync_conflict || row.uncertain_operation || (row.recovery_issue_count || 0) > 0 || !canResume || ['interrupted', 'failed', 'cancelled', 'stopped'].includes(row.recovery_status || '') ? 'session-history-warning' : 'session-history-ready'}>{row.sync_conflict ? `SYNC CONFLICT · ${row.recommended_source || 'choose copy'}` : row.uncertain_operation ? 'REVIEW PARTIAL OPERATION' : (row.recovery_issue_count || 0) > 0 ? 'REVIEW RECOVERY' : !canResume ? 'PROJECT UNAVAILABLE' : (row.recovery_status || 'ready').toUpperCase()}</span>
          </div>;
        })}</div> : <div className="empty-inline" role={sessionHistoryStatus === 'error' ? 'alert' : undefined}><span><b>{sessionHistoryStatus === 'error' ? 'Saved sessions could not be loaded.' : 'No saved sessions yet.'}</b><small>{sessionHistoryStatus === 'error' ? 'Your session history was not cleared. Refresh to try again.' : 'Start a task in a project and its saved session will appear here.'}</small></span></div>}
      </div>
      <div className="landing-column engine-column">
        <div className="section-heading"><div><span className="section-number">03</span><h2>Inference source</h2></div><span className={`source-status ${connected}`}>{connected === 'yes' ? 'REACHABLE' : connected === 'no' ? 'OFFLINE' : 'CHECKING'}</span></div>
        <label className="model-picker-card"><span className="picker-symbol"><Icon name="spark"/></span><span className="picker-content"><small>LOCAL MODEL</small><select value={model} disabled={modelPreloading} onChange={(e) => onModel(e.target.value)}>{!models.length && <option value="">{modelCatalogStatus === 'loading' || modelCatalogStatus === 'refreshing' ? 'Syncing model inventory…' : modelCatalogStatus === 'error' ? 'Model inventory unavailable' : 'No installed models'}</option>}{models.map((name) => <option key={name} value={name}>{modelLabels[name] || shortModel(name)}</option>)}</select><span>{modelPreloading ? 'Model warming; selection returns when ready.' : modelCatalogStatus === 'error' ? 'The last successful inventory is retained; refresh to reconnect.' : 'Choose Ollama models or add Hugging Face GGUF files.'}</span></span><Icon name="chevron"/></label>
        <Button kind="outline" onClick={onLibrary}>Browse Hugging Face / add local models</Button>
        {connected === 'no' && <div className="setup-help" role="status"><b>Ollama is not responding</b><span>Use the official Windows installer, then check the connection again. Existing model data is not changed.</span><div><Button kind="outline" onClick={onInstallOllama}>Open Ollama setup</Button><button onClick={onRefresh}>Check connection</button></div></div>}
        {connected === 'yes' && modelCatalogStatus === 'ready' && models.length === 0 && <div className="setup-help"><b>No local models found</b><span>Add an Ollama model or download a Hugging Face GGUF to get started.</span><div><Button kind="outline" onClick={onLibrary}>Add a model</Button></div></div>}
        <div className="engine-foot"><span><Icon name="cpu"/> {telemetry.serviceCpu == null ? 'SERVICE READY' : `SERVICE ${telemetry.serviceCpu}% CPU`}</span><span><Icon name="memory"/> {telemetry.serviceRss} SIDECAR</span><span>{sessionHistoryStatus === 'loading' ? 'SYNCING SESSIONS' : sessionHistoryStatus === 'error' ? `${sessions.length} SAVED SESSIONS · LAST SYNC FAILED` : `${sessions.length} SAVED SESSIONS`}</span></div>
      </div>
    </div>
  </section>;
}

function ProjectHome({ root, tab, setTab, files, sessions, sessionHistoryStatus, onNew, onOpenSession, onFiles, onRefreshSessions, onDiff, onMcp, onTools, onHome, running }: {
  root: string; tab: 'overview' | 'files' | 'sessions'; setTab: (value: 'overview' | 'files' | 'sessions') => void;
  files: ProjectFile[]; sessions: SessionSummary[]; sessionHistoryStatus: 'loading' | 'ready' | 'error'; onNew: () => void; onOpenSession: (id: string) => void;
  onFiles: () => void; onRefreshSessions: () => void; onDiff: () => void; onMcp: () => void; onTools: () => void; onHome: () => void; running: boolean;
}) {
  const textFiles = files.filter((row) => row.text).length;
  return <section className="project-view">
    <div className="project-identity">
      <div className="project-monogram">{shortPath(root).slice(0, 2).toUpperCase()}</div>
      <div className="project-title"><span className="eyebrow-line"><span className="eyebrow-mark"/> ACTIVE PROJECT</span><h1>{shortPath(root)}</h1><p title={root}>{root}</p></div>
      <div className="project-identity-actions"><Button kind="quiet" onClick={onHome}><Icon name="arrow"/> Home</Button><Button kind="outline" onClick={onTools}>Tools &amp; abilities</Button><Button kind="outline" onClick={onMcp}>MCP connections</Button><Button kind="outline" onClick={onDiff}>Review Git changes</Button><Button kind="bright" disabled={running} onClick={onNew}><Icon name="plus"/> Start a task</Button></div>
    </div>
    <nav className="project-tabs">{(['overview', 'files', 'sessions'] as const).map((item, index) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); if (item === 'files') onFiles(); }}><span>0{index + 1}</span>{item}</button>)}</nav>
    {tab === 'overview' && <div className="project-overview">
      <div className="overview-main">
        <div className="overview-welcome"><span className="eyebrow-line">WORKING DIRECTORY / VERIFIED</span><h2>Pick up where<br/>the work is.</h2><p>Built-in file tools stay within this project. Approved commands and MCP tools may access other locations under your Windows account; approval is not OS sandboxing. Session history stays associated with this folder.</p><Button kind="bright" onClick={onNew}><Icon name="plus"/> Create a new task</Button></div>
        <div className="workspace-facts"><div><small>VISIBLE FILES</small><strong>{fmt(files.length)}</strong></div><div><small>TEXT FILES</small><strong>{fmt(textFiles)}</strong></div><div><small>SAVED SESSIONS</small><strong>{fmt(sessions.length)}</strong></div></div>
      </div>
      <div className="recent-session-card"><div className="section-heading"><div><span className="section-number">03</span><h2>Recent sessions</h2></div><button onClick={() => setTab('sessions')}>All sessions <Icon name="arrow"/></button></div>
        {sessions.slice(0, 5).map((row, index) => <button className="session-tile" key={row.session_id} onClick={() => onOpenSession(row.session_id)}><span className="session-index">{String(index + 1).padStart(2, '0')}</span><span><strong>Session {row.session_id.slice(-8)}</strong><small>{row.model}</small>{row.sync_conflict && <small className="session-conflict-note">Copies differ · project version recommended</small>}</span><time>{new Date(row.updated_at * 1000).toLocaleDateString()}</time><Icon name="arrow"/></button>)}
        {!sessions.length && <div className="empty-inline compact" role={sessionHistoryStatus === 'error' ? 'alert' : sessionHistoryStatus === 'loading' ? 'status' : undefined}><span><b>{sessionHistoryStatus === 'loading' ? 'Loading saved sessions…' : sessionHistoryStatus === 'error' ? 'Saved sessions could not be loaded.' : 'No sessions for this folder yet.'}</b><small>{sessionHistoryStatus === 'error' ? 'Your project is open and its files remain available. Session history was not cleared.' : sessionHistoryStatus === 'loading' ? 'The project is open while its session history syncs.' : 'Your first task will create a resumable session.'}</small></span>{sessionHistoryStatus === 'error' && <button onClick={onRefreshSessions}>Retry</button>}</div>}
      </div>
      <div className="project-capabilities"><div><Icon name="branch"/><span><b>File boundary</b><small>Built-in file tools stay under this root.</small></span></div><div><Icon name="terminal"/><span><b>Host command access</b><small>Approval is consent, not OS containment.</small></span></div><div><Icon name="clock"/><span><b>Local history</b><small>Sessions can be resumed at any time.</small></span></div></div>
    </div>}
    {tab === 'files' && <div className="project-file-list"><div className="section-heading"><div><span className="section-number">04</span><h2>Indexed project files</h2></div><span>{files.length} entries</span></div>{files.map((file) => <div className="file-row" key={file.path}><span className={`file-glyph ${file.text ? 'text-file' : ''}`}>{file.text ? 'Aa' : '▧'}</span><code>{file.path}</code><small>{file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}</small></div>)}</div>}
    {tab === 'sessions' && <div className="project-file-list"><div className="section-heading"><div><span className="section-number">05</span><h2>Saved sessions</h2></div><span>{sessionHistoryStatus === 'loading' ? 'Syncing…' : sessionHistoryStatus === 'error' ? 'History unavailable' : `${sessions.length} sessions`}</span></div>{sessions.map((row) => <button className="session-tile full-session" key={row.session_id} onClick={() => onOpenSession(row.session_id)}><span className="session-index"><Icon name="clock"/></span><span><strong>Session {row.session_id}</strong><small>{row.model}</small>{row.sync_conflict && <small className="session-conflict-note">Copies differ · project version recommended</small>}</span><time>{new Date(row.updated_at * 1000).toLocaleString()}</time><Icon name="arrow"/></button>)}{sessionHistoryStatus !== 'ready' || !sessions.length ? <div className="empty-inline" role={sessionHistoryStatus === 'error' ? 'alert' : sessionHistoryStatus === 'loading' ? 'status' : undefined}><span><b>{sessionHistoryStatus === 'loading' ? 'Loading saved sessions…' : sessionHistoryStatus === 'error' ? 'Saved sessions could not be loaded.' : 'No saved sessions yet.'}</b><small>{sessionHistoryStatus === 'error' ? 'History remains preserved. Retry the session list without leaving this project.' : sessionHistoryStatus === 'loading' ? 'Session history is syncing independently of project files.' : 'Start a task to create the first session.'}</small></span>{sessionHistoryStatus === 'error' && <button onClick={onRefreshSessions}>Retry</button>}</div> : null}</div>}
  </section>;
}

function SessionRoom({ root, session, messages, activities, activityMode, plan, acceptanceCriteria, phase, workflowOutcome, verificationEvidence, toolCallProgress, elapsed, running, prompt, setPrompt, promptRef, queuedPrompts, onQueue, onSteer, onRemoveQueued, queueSubmitting, steeringSubmitting, options, setOptions, files, telemetry, runMetrics, firstOperationSeconds, firstFileWriteSeconds, appliedSettings, onRun, onRunQueued, onCancel, onSettings, onBack, onDiff, onMcp, onTools, onEnter, endRef, model, modelInfo, onToggleHarnessProfile }: {
  root: string; session: Session | null; messages: ChatMessage[]; activities: ActivityRecord[]; activityMode: ActivityMode; plan: PlanItem[]; acceptanceCriteria: string[];
  phase: string; elapsed: number; running: boolean; prompt: string; setPrompt: (value: string) => void;
  queuedPrompts: QueuedPrompt[]; onQueue: () => void; onSteer: () => void; onRemoveQueued: (id: string) => void; queueSubmitting: boolean; steeringSubmitting: boolean;
  toolCallProgress: ToolCallProgress[];
  workflowOutcome: string | null; verificationEvidence: VerificationEvidence | null; promptRef: React.RefObject<HTMLTextAreaElement | null>; options: typeof initialOptions;
  setOptions: React.Dispatch<React.SetStateAction<typeof initialOptions>>; files: ProjectFile[];
  telemetry: TelemetryView;
  runMetrics: RunMetrics; firstOperationSeconds: number | null; firstFileWriteSeconds: number | null; appliedSettings: AppliedSettings | null;
  onRun: () => void; onRunQueued: (prompt: QueuedPrompt) => void; onCancel: () => void; onSettings: () => void; onBack: () => void; onDiff: () => void; onMcp: () => void; onTools: () => void;
  onEnter: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; endRef: React.RefObject<HTMLDivElement | null>; model: string; modelInfo: ModelInfo | null; onToggleHarnessProfile: () => void;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [followTranscript, setFollowTranscript] = useState(true);
  const followTranscriptRef = useRef(true);
  const activitiesByTurn = useMemo(() => {
    const grouped = new Map<string, ActivityRecord[]>();
    for (const activity of activities) {
      if (!activity.turnId) continue;
      const rows = grouped.get(activity.turnId) || [];
      rows.push(activity);
      grouped.set(activity.turnId, rows);
    }
    return grouped;
  }, [activities]);
  const planTaskMode = [...activities].reverse().find((activity) => activity.kind === 'plan' && activity.taskMode)?.taskMode;
  const activeTurnId = [...messages].reverse().find((message) => message.role === 'user')?.turnId;
  const latestActiveActivity = [...activities].reverse().find((activity) => activity.turnId === activeTurnId
    && ['operation', 'tool_preparation', 'approval', 'question', 'context', 'error'].includes(activity.kind));
  const promptCacheComplete = runMetrics.usageResponses > 0
    && runMetrics.promptTokenReports === runMetrics.usageResponses
    && runMetrics.cachedPromptReports === runMetrics.usageResponses;
  const [sheetLayout, setSheetLayout] = useState<RunSheetLayout>(() => {
    try { return restoreRunSheetLayout(JSON.parse(localStorage.getItem('agent-run-sheet-layout') || 'null')); }
    catch { return DEFAULT_RUN_SHEET_LAYOUT; }
  });
  useEffect(() => { localStorage.setItem('agent-run-sheet-layout', JSON.stringify(sheetLayout)); }, [sheetLayout]);
  useEffect(() => {
    if (!followTranscriptRef.current || !transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, activities, toolCallProgress, followTranscript]);
  useEffect(() => { followTranscriptRef.current = true; setFollowTranscript(true); }, [session?.session_id]);
  const updateTranscriptFollow = () => {
    const element = transcriptRef.current;
    if (!element) return;
    const shouldFollow = isNearTranscriptEnd(element);
    followTranscriptRef.current = shouldFollow;
    setFollowTranscript(shouldFollow);
  };
  const movePanel = (panel: RunSheetPanel, direction: -1 | 1) => setSheetLayout((layout) => moveRunSheetPanel(layout, panel, direction));
  const resizePanel = (panel: RunSheetPanel, direction: -1 | 1) => setSheetLayout((layout) => resizeRunSheetPanel(layout, panel, direction));
  const panelStyle = (panel: RunSheetPanel) => ({ order: sheetLayout.order.indexOf(panel) + 1, height: `${sheetLayout.heights[panel]}px` });
  const steps = ['Ready', 'Waiting for first token', 'Generating', phase === 'Turn complete' ? 'Turn complete' : 'Finishing turn'];
  const currentStep = runStepProgress(phase, running);
  return <section className="session-view">
    <div className="session-commandline"><button className="crumb-back" onClick={onBack}>PROJECT / {shortPath(root).toUpperCase()}</button><span className="crumb-slash">/</span><span className="session-crumb">SESSION {session?.session_id.slice(-8).toUpperCase()}</span><span className="commandline-spacer"/><button className="inline-command" onClick={onTools}>TOOLS</button><button className="inline-command" onClick={onMcp}>MCP</button><button className="inline-command" onClick={onDiff}>CHANGES</button><span className={`phase-chip ${running ? 'is-running' : ''}`}><i/>{running ? phase.toUpperCase() : phase.toUpperCase()}</span><span className="run-elapsed"><Icon name="clock"/> {running ? secs(elapsed) : '—'}</span></div>
    <div className="task-route" aria-label="Task execution phases">{steps.map((step, index) => <div className={`route-step ${index < currentStep ? 'done' : ''} ${index === currentStep ? 'current' : ''}`} key={step}><span className="route-node">{index < currentStep ? <Icon name="check"/> : `0${index + 1}`}</span><span>{step === 'Waiting for first token' ? 'Prefill / waiting' : step}</span></div>)}</div>
    {running && <div className="active-run-status" role="status" aria-live="polite"><span className="stream-pulse"/><strong>{phase}</strong><span>{latestActiveActivity ? `${latestActiveActivity.name?.replaceAll('_', ' ') || latestActiveActivity.kind} · ${latestActiveActivity.status.replaceAll('_', ' ')}` : toolCallProgress.length ? 'Structured tool request is being prepared; it has not been dispatched yet.' : phase === 'Reasoning' ? 'The model is still reasoning. No file or command operation is dispatched until a complete structured tool call arrives.' : 'The request is active; live file, command, and plan events will appear here and in the worksheet.'}</span><small>{secs(elapsed)} elapsed{runMetrics.estimatedInputTokens !== null ? ` · ~${fmt(runMetrics.estimatedInputTokens)} estimated input tokens` : ''}</small></div>}
    {workflowOutcome && <div className={`workflow-outcome outcome-${workflowOutcome}`} role="status"><span>OBSERVED OUTCOME</span><strong>{workflowOutcomeLabel(workflowOutcome)}</strong><small>{workflowOutcome === 'no_action' ? 'No structured plan or project operation was recorded. If you expected implementation, choose Implement in the intent control and resend the request; access and approval rules still apply.' : workflowOutcome === 'command_completed' ? 'Command exit was successful; this does not alone prove tests passed.' : workflowOutcome === 'changed' ? 'Project changes exist without a recorded post-change inspection.' : workflowOutcome === 'inspected' ? 'A post-change inspection completed; semantic correctness is not implied.' : workflowOutcome === 'implementation_incomplete' ? 'The agent stopped after repeating a state with no new observable progress. Review the saved plan, checkpoint, and workspace before resuming.' : workflowOutcome === 'response_missing' ? 'The model returned no user-visible completion after a follow-up. Saved tool effects are preserved; review them before resuming.' : workflowOutcome === 'implementation_unverified' ? 'A command may have changed files, but the host did not observe a structured project change. Review the inspection evidence.' : 'Based on the host-observed tools and terminal status.'}</small>{verificationEvidenceLabel(verificationEvidence) && <small className="verification-evidence">{verificationEvidenceLabel(verificationEvidence)}</small>}</div>}
    <div className="session-main-grid">
      <section className="transcript-plane" aria-label="Conversation transcript">
        {!messages.length ? <div className="transcript-empty"><div className="empty-symbol"><Icon name="spark"/></div><span className="eyebrow-line">NEW WORK UNIT / {shortPath(root).toUpperCase()}</span><h2>What should we<br/>work through?</h2><p>The model sees selected, relevant project files as needed. You control any action that can change the workspace.</p><div className="starter-prompts"><button onClick={() => setPrompt('Inspect this project and explain its architecture and how to run it.')}>Map the project <Icon name="arrow"/></button><button onClick={() => setPrompt('Review this project for the highest-priority bug and propose a fix.')}>Find a bug <Icon name="arrow"/></button><button onClick={() => setPrompt('Add a focused feature to this project and verify it with the existing tests.')}>Build a feature <Icon name="arrow"/></button></div></div> : <div className="message-list" ref={transcriptRef} onScroll={updateTranscriptFollow}>{messages.map((message, index) => <Fragment key={`${message.turnId || 'legacy'}-${message.steeringId || index}-${message.role}`}><article className={`message-card message-${message.role}`}>
          <div className="message-meta"><span className={`speaker-mark ${message.role}`}>{message.role === 'user' ? 'YOU' : <Icon name="spark"/>}</span><strong>{message.role === 'user' ? message.steeringId ? 'Task update' : 'Task brief' : 'Local agent'}</strong><span>{message.recoveredPartial ? 'PARTIAL · INTERRUPTED' : message.steeringStatus === 'pending' ? running ? 'WAITING FOR SAFE BOUNDARY' : 'NOT DELIVERED' : message.steeringStatus === 'delivered' ? 'DELIVERED TO ACTIVE TASK' : message.steeringStatus === 'undelivered' ? 'NOT APPLIED' : message.role === 'user' ? 'INPUT' : message.streaming ? 'LIVE OUTPUT' : 'RESPONSE'}</span>{message.streaming && <i className="stream-pulse"/>}</div>
          <div className="message-content"><Markdown content={message.content}/></div>{(message.steeringStatus === 'pending' || message.steeringStatus === 'undelivered') && !running && <button className="activity-show-more" type="button" onClick={() => setPrompt(message.content)}>Use this update as a follow-up</button>}
          {message.thinking && <details className="reasoning-trace"><summary>Model reasoning · {message.thinking.length.toLocaleString()} characters</summary><div>{message.thinking}</div></details>}
        </article>{message.role === 'user' && message.turnId && messages.findIndex((row) => row.role === 'user' && row.turnId === message.turnId) === index && <ActivityFeed entries={activitiesByTurn.get(message.turnId) || []} mode={activityMode} surface="chat"/>}</Fragment>)}<div ref={endRef}/>{!followTranscript && <button className="jump-latest" onClick={() => { followTranscriptRef.current = true; setFollowTranscript(true); if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight; }} aria-label="Jump to latest message">↓ Latest</button>}</div>}
        <div className="composer-shell">
          <div className="composer-profile"><span className={`profile-chip access-${options.access}`}>{options.access.toUpperCase()}</span><span className="profile-chip approval-chip">{options.approvalMode === 'auto' ? 'AUTO APPROVE · THIS RUN' : options.approvalMode === 'per-session' ? session?.session_approval_granted ? 'SESSION APPROVED' : 'APPROVAL · THIS CHAT' : options.approvalMode === 'per-task' ? 'PER TASK' : 'PER ACTION'}</span><span className="profile-chip capability-chip" title="Capability reported by the selected local runtime; support metadata may be unknown">TOOLS {modelInfo?.tool_support === 'supported' ? 'SUPPORTED' : modelInfo?.tool_support === 'unsupported' ? 'UNSUPPORTED' : 'UNKNOWN'}</span><label className="profile-chip intent-chip" title="Task intent guides the agent; file access and approval remain separate">INTENT <select aria-label="Task intent" value={options.taskIntent} disabled={running} onChange={(event) => { const taskIntent = event.target.value as TaskIntent; setOptions((current) => ({ ...current, taskIntent })); localStorage.setItem('agent-task-intent', taskIntent); }}><option value="auto">AUTO</option><option value="discuss">DISCUSS</option><option value="plan">PLAN</option><option value="implement">IMPLEMENT</option></select></label><button className={`profile-toggle ${options.harnessProfile === 'small-model' ? 'is-active' : ''}`} type="button" aria-pressed={options.harnessProfile === 'small-model'} title="Changes agent workflow guidance only; model settings and token limits stay unchanged" onClick={onToggleHarnessProfile} disabled={running}>Small-model {options.harnessProfile === 'small-model' ? 'on' : 'off'}</button><span className="profile-hint">{fmt(options.context)} context · {fmt(options.maxTokens)} output</span><button onClick={onSettings}>Adjust run</button></div>
          <textarea ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={running ? (event) => { if (shouldQueuePromptOnEnter(event.key, event.shiftKey, event.nativeEvent.isComposing)) { event.preventDefault(); onSteer(); } } : onEnter} placeholder={running ? 'Steer the current task at its next safe boundary…' : 'Describe the work. Use Shift + Enter to add detail…'} rows={3} aria-label={running ? 'Steer the active task; delivery occurs at the next safe boundary' : 'Task prompt'} aria-describedby={running ? 'follow-up-help' : undefined}/>
          <div className="composer-bottom"><span id={running ? 'follow-up-help' : undefined}>{running ? <><kbd>ENTER</kbd> to steer this task <b>·</b> <kbd>SHIFT ENTER</kbd> for a new line <b>·</b> queue next is separate</> : <><kbd>ENTER</kbd> to run <b>·</b> <kbd>SHIFT ENTER</kbd> for a new line <b>·</b> reasoning {options.reasoning == null ? 'model default' : String(options.reasoning)}</>}</span>{running ? <><Button kind="bright" onClick={onSteer} disabled={!prompt.trim() || steeringSubmitting}><Icon name={steeringSubmitting ? 'clock' : 'arrow'}/>{steeringSubmitting ? 'Sending' : 'Steer current task'}</Button><Button kind="outline" onClick={onQueue} disabled={!prompt.trim() || queueSubmitting}><Icon name={queueSubmitting ? 'clock' : 'plus'}/>{queueSubmitting ? 'Saving…' : 'Queue next'}</Button><Button kind="danger" onClick={onCancel}><Icon name="stop"/> Cancel request</Button></> : <Button kind="bright" onClick={onRun} disabled={!prompt.trim()}><Icon name="play"/> Run task</Button>}</div>
          {queuedPrompts.length > 0 && <section className="queued-prompt-list" aria-label="Saved follow-up prompts"><div className="queued-prompt-heading"><b>FOLLOW-UPS</b><span>{queuedPrompts.length} saved · starts only when selected</span></div>{queuedPrompts.map((item, index) => <article className="queued-prompt-row" key={item.id}><div><small>#{index + 1} · {new Date(item.queued_at * 1000).toLocaleString()}</small><p>{item.prompt}</p></div><div className="queued-prompt-actions"><Button kind="bright" disabled={running} onClick={() => onRunQueued(item)}><Icon name="play"/> Start next</Button><Button kind="quiet" onClick={() => onRemoveQueued(item.id)}>Remove</Button></div></article>)}</section>}
        </div>
      </section>
      <aside className="run-sheet">
        <div className="run-sheet-heading"><div><span className="eyebrow-line">LIVE WORK SHEET</span><h2>Task signals</h2></div><Button kind="outline" className="sheet-inspect" onClick={onDiff}><Icon name="branch"/> Inspect changes</Button><span className={`run-lamp ${running ? 'active' : ''}`}/></div>
        <section className="sheet-panel" style={panelStyle('signals')} aria-label="Run signals and generation metrics">
          <div className="sheet-panel-heading"><span>MODEL &amp; GENERATION</span><SheetPanelControls panel="signals" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div>
          <div className="signal-matrix"><div className={`signal-card signal-wide ${telemetry.contextMismatch ? 'signal-warning' : ''}`}><small>MODEL / CONTEXT</small><strong title={model}>{shortModel(model)}</strong><span>{telemetry.loadedContext ? `RUNTIME ${fmt(telemetry.loadedContext)} / ${fmt(options.context)} REQUESTED TOKENS` : `${fmt(options.context)} REQUESTED · NOT CURRENTLY LOADED`}</span></div><div className="signal-card"><small>REQUEST SENT</small><strong>{appliedSettings && appliedSettings.model === model ? `${fmt(appliedSettings.context)} / ${fmt(appliedSettings.maxOutput)}` : '—'}</strong><span>CONTEXT / OUTPUT TOKENS</span></div><div className="signal-card"><small>REASONING OVERRIDE</small><strong>{appliedSettings && appliedSettings.model === model ? appliedSettings.reasoning == null ? 'DEFAULT' : String(appliedSettings.reasoning).toUpperCase() : '—'}</strong><span>EXACT SELECTED VALUE</span></div><div className="signal-card"><small>ELAPSED</small><strong>{running ? secs(elapsed) : '—'}</strong><span>{running ? phase.toUpperCase() : 'NO ACTIVE RUN'}</span></div><div className="signal-card" title="Elapsed time from task start to the first structured tool call other than update_plan. Reads and searches count; this does not mean files were changed."><small>FIRST TOOL</small><strong>{firstOperationSeconds == null ? running ? 'WAITING' : '—' : tokenDelay(firstOperationSeconds * 1000)}</strong><span>FROM TASK START</span></div><div className="signal-card" title="Elapsed time until the first successful structured write_file, append_file, edit_file, or apply_patch result. Commands are not counted because their file effects are not fully attributable."><small>FIRST FILE WRITE</small><strong>{firstFileWriteSeconds == null ? running ? 'NONE YET' : '—' : tokenDelay(firstFileWriteSeconds * 1000)}</strong><span>SUCCESSFUL STRUCTURED WRITE</span></div><div className="signal-card"><small>FILES IN VIEW</small><strong>{files.length}</strong><span>INDEXED / IGNORE AWARE</span></div></div>
          <div className="run-metrics" aria-label="Model generation and prompt-cache statistics"><div><small>FIRST TOKEN</small><strong>{tokenDelay(runMetrics.firstTokenMs)}</strong></div><div title={outputTokensAreEstimated(runMetrics) ? 'Live estimate from streamed text; replaced by the provider’s exact rate after generation.' : 'Exact rate reported by the provider.'}><small>OUTPUT / SEC{outputTokensAreEstimated(runMetrics) ? ' · LIVE' : ''}</small><strong>{liveOutputTokensPerSecond(runMetrics)?.toFixed(1).replace(/^/, outputTokensAreEstimated(runMetrics) ? '~' : '') ?? '—'}</strong></div><div title={outputTokensAreEstimated(runMetrics) ? 'Live estimate from streamed text; replaced by the provider’s exact token count after generation.' : 'Exact output token count reported by the provider.'}><small>OUTPUT TOKENS{outputTokensAreEstimated(runMetrics) ? ' · LIVE' : ''}</small><strong>{outputTokensAreEstimated(runMetrics) ? '~' : ''}{fmt(estimateOutputTokens(runMetrics))}</strong></div><div title={promptCacheComplete ? `Provider-reported prompt reuse: ${fmt(runMetrics.cachedPromptTokens)} of ${fmt(runMetrics.promptTokens)} prompt tokens.` : `Prompt-cache counters reported for ${runMetrics.cachedPromptReports} of ${runMetrics.usageResponses} responses; no missing values are treated as zero.`}><small>PROMPT REUSE{runMetrics.cachedPromptReports > 0 && !promptCacheComplete ? ' · PARTIAL' : ''}</small><strong>{promptCacheComplete && runMetrics.promptTokens ? `${Math.round(runMetrics.cachedPromptTokens / runMetrics.promptTokens * 100)}%` : runMetrics.cachedPromptReports ? `${runMetrics.cachedPromptReports}/${runMetrics.usageResponses} REPORTED` : 'UNKNOWN'}</strong></div></div>
          <div className="kv-cache-panel" aria-label="KV cache, prompt input, and reuse details">
            <div className="kv-cache-heading"><span>PROMPT REUSE &amp; KV TELEMETRY</span><small>{model.startsWith('gguf::') ? 'LLAMA.CPP' : 'OLLAMA'}</small></div>
            <div className="kv-cache-grid">
              <div><small>LAST REQUEST INPUT TOKENS</small><strong>{runMetrics.lastRequestPromptTokens !== null ? fmt(runMetrics.lastRequestPromptTokens) : runMetrics.estimatedInputTokens !== null ? `~${fmt(runMetrics.estimatedInputTokens)} estimate` : 'Not reported yet'}</strong></div>
              <div><small>PROMPT TOKENS · THIS RUN</small><strong>{runMetrics.promptTokens ? fmt(runMetrics.promptTokens) : 'Not reported yet'}</strong></div>
              <div><small>CACHED PROMPT TOKENS · THIS RUN</small><strong>{promptCacheComplete && runMetrics.promptTokens ? `${fmt(runMetrics.cachedPromptTokens)} / ${fmt(runMetrics.promptTokens)} · ${Math.round(runMetrics.cachedPromptTokens / runMetrics.promptTokens * 100)}%` : runMetrics.cachedPromptReports ? `${fmt(runMetrics.cachedPromptTokens)} cached · ${runMetrics.cachedPromptReports}/${runMetrics.usageResponses} responses reported` : 'Provider did not report yet'}</strong></div>
              <div><small>UNCACHED PROMPT TOKENS · THIS RUN</small><strong>{promptCacheComplete ? fmt(Math.max(0, runMetrics.promptTokens - runMetrics.cachedPromptTokens)) : 'Unavailable until all responses report counts'}</strong></div>
              <div><small>PROMPT EVAL TIME · THIS RUN</small><strong>{runMetrics.promptEvalNanoseconds ? `${(runMetrics.promptEvalNanoseconds / 1e9).toFixed(2)} s` : 'Not reported'}</strong></div>
              <div><small>MODEL LOAD TIME · THIS RUN</small><strong>{runMetrics.modelLoadNanoseconds ? `${(runMetrics.modelLoadNanoseconds / 1e9).toFixed(2)} s` : 'Not reported'}</strong></div>
              <div><small>CACHED PROMPT TOKENS · CURRENT SLOT</small><strong>{telemetry.kvSlot?.cachedTokens != null ? fmt(telemetry.kvSlot.cachedTokens) : model.startsWith('gguf::') ? 'Not reported by slot' : 'Not exposed by Ollama'}</strong></div>
              <div><small>SLOT CONTEXT TOKENS</small><strong>{telemetry.kvSlot ? `${telemetry.kvSlot.processing ? 'ACTIVE' : 'RETAINED'} · ${fmt(telemetry.kvSlot.contextTokens ?? undefined)} / ${fmt(telemetry.kvSlot.contextLimit ?? undefined)}` : model.startsWith('gguf::') ? 'Slot telemetry unavailable' : 'Not exposed by Ollama'}</strong></div>
              <div><small>KV ALLOCATION BYTES</small><strong>Not exposed by runtime</strong></div>
              <div><small>KV CACHE TYPE / PRECISION</small><strong>Not exposed by runtime</strong></div>
            </div>
            <p>Prompt-prefix reuse counters are provider-reported and may be unavailable or partial; missing counters are never displayed as zero. KV allocation/precision are separate metrics and are shown as unavailable unless the runtime exposes them. VRAM is device-wide, not KV-cache memory.</p>
          </div>
          {telemetry.contextMismatch && <p className="context-warning" role="status">Ollama reports a smaller runtime context than requested. Available memory may limit allocation.</p>}
        </section>
        <div className="sheet-section sheet-panel" style={panelStyle('plan')}>
          <div className="sheet-heading"><h3>Plan</h3><span>{plan.length ? `${plan.length} steps · ${planTaskMode === 'plan_only' ? 'plan only' : planTaskMode || (options.taskIntent === 'implement' ? 'implement' : options.taskIntent)} · ${plan.every((item) => item.source === 'workbench') ? 'starter' : 'live'}` : 'Awaiting agent'}</span><SheetPanelControls panel="plan" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div>
          {plan.length ? <ol className="plan-list">{plan.map((item, index) => <li key={`${index}-${item.title || item.text}`}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.group && <small className="plan-group">{item.group}</small>}{item.title || item.text || 'Work item'}{item.title && item.text && item.title !== 'Requested outcome' && <small className="plan-detail">{item.text}</small>}</b><small>{item.status || 'pending'}</small></li>)}</ol> : <p className="sheet-empty">A checklist appears immediately for plan/build tasks and can be refined by the agent.</p>}
          <div className="plan-acceptance"><h4>Acceptance criteria <span>{acceptanceCriteria.length ? `${acceptanceCriteria.length} agent-defined` : 'awaiting task refinement'}</span></h4>{acceptanceCriteria.length ? <ul>{acceptanceCriteria.map((criterion, index) => <li key={`${index}-${criterion}`}>{criterion}</li>)}</ul> : <p>The agent can add concrete completion checks after inspecting the task and project.</p>}</div>
        </div>
        <div className="sheet-section trace-section sheet-panel" style={panelStyle('activity')}><div className="sheet-heading"><h3>Activity trace</h3><span>{activities.length} events</span><SheetPanelControls panel="activity" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div>{toolCallProgress.length > 0 && <div className="tool-call-progress tool-call-progress-sidebar" role="status" aria-live="polite"><span className="stream-pulse"/><strong>Preparing · not dispatched</strong>{toolCallProgress.map((item) => <span key={`${item.requestIndex}-${item.callIndex}`}>{item.toolName || `Tool ${item.callIndex + 1}`} · {item.argumentCharacters.toLocaleString()} chars</span>)}</div>}<ActivityFeed entries={activities} mode={activityMode} surface="sidebar"/></div>
        <div className="resource-summary sheet-panel" style={panelStyle('resources')}>
          <div className="resource-heading"><span>RESOURCE / SYSTEM</span><SheetPanelControls panel="resources" layout={sheetLayout} onMove={movePanel} onResize={resizePanel}/></div>
          <div className="resource-heading"><span>SIDECAR {telemetry.serviceRss}</span></div>
          <div className="resource-grid">
            <div className="resource-tile"><small>CPU</small><strong>{telemetry.cpu == null ? '—' : `${telemetry.cpu}%`}</strong><div className="meter"><i style={{ width: `${Math.min(100, telemetry.cpu ?? 0)}%` }}/></div></div>
            <div className="resource-tile"><small>RAM</small><strong>{telemetry.ram}</strong><div className="meter"><i style={{ width: `${memoryPct(telemetry.ram)}%` }}/></div></div>
            <div className="resource-tile"><small>GPU LOAD</small><strong>{telemetry.gpuUtil == null ? '—' : `${telemetry.gpuUtil}%`}</strong><div className="meter"><i style={{ width: `${Math.min(100, telemetry.gpuUtil ?? 0)}%` }}/></div></div>
            <div className="resource-tile"><small>VRAM · {telemetry.gpu}</small><strong>{telemetry.vramUsed == null ? '—' : fmt(telemetry.vramUsed)} / {telemetry.vramTotal == null ? '—' : fmt(telemetry.vramTotal)} MiB</strong><div className="meter"><i style={{ width: `${telemetry.vramPercent ?? 0}%` }}/></div></div>
            <div className="resource-tile"><small>GPU POWER</small><strong>{telemetry.gpuPower == null ? '—' : `${telemetry.gpuPower.toFixed(2)} W`}</strong><span>BOARD DRAW</span></div>
            <div className="resource-tile"><small>OLLAMA / LLAMA WORKERS</small><strong>{telemetry.runtimeWorkerCount ? `${telemetry.runtimeWorkerCpu == null ? '—' : `${telemetry.runtimeWorkerCpu}% CPU`} · ${telemetry.runtimeWorkerRss} RAM` : 'Not detected'}</strong><span>SHARED RUNTIME PROCESSES</span></div>
            <div className="resource-tile"><small>RUNTIME GPU MEMORY</small><strong>{telemetry.runtimeGpuMemory == null ? 'Unavailable' : `${fmt(telemetry.runtimeGpuMemory)} MiB`}</strong><span>PROCESS VRAM · NOT MODEL-SPECIFIC</span></div>
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
  const featuredModels = featuredInstalledModels(models);
  return <Modal title="Model library" eyebrow="LOCAL RUNTIMES / HUGGING FACE" wide onClose={onClose}>
    <p className="modal-copy">Ollama models stay available as installed. Search Hugging Face, pin a revision, and download only the files you select. GGUF inference uses an explicitly configured llama.cpp server; the app never loads a model on launch.</p>
    <div className="library-runtime-card"><div><small>LLAMA.CPP SERVER</small><strong>{configuredBinary ? configuredBinary.split(/[\\/]/).at(-1) : 'Not configured'}</strong><span>{runtimeRunning ? `APP-OWNED · ${fmt(Number(runtime.effective_context ?? runtime.context))} ${runtime.effective_context == null ? 'configured' : 'effective'} context` : 'No app-owned GGUF server active'}</span></div><Button kind="outline" onClick={() => void chooseServer()}>{configuredBinary ? 'Change executable' : 'Choose executable'}</Button></div>
    <div className="library-toolbar"><Button kind="outline" onClick={() => void addLocalGguf()}>Add local GGUF</Button><Button kind="outline" onClick={() => void onRefresh()}>Refresh installed models</Button>{isGguf && <><Button kind="bright" disabled={busy} onClick={() => void loadSelectedGguf()}>{runtimeRunning ? 'Reload selected settings' : 'Load selected GGUF'}</Button>{runtimeRunning && <Button kind="danger" onClick={() => void window.agent.request({ command: 'llama_model_stop' }).then(() => { setRuntime((value) => ({ ...value, running: false })); notify('Stopped the app-owned llama.cpp server.'); })}>Stop app-owned model</Button>}</>}</div>
    <div className="library-current"><span>SELECTED MODEL</span><code>{modelLabels[model] || shortModel(model)}</code><span>Context {fmt(context)} · reasoning {reasoning == null ? 'default' : String(reasoning)}</span></div>
    {featuredModels.length > 0 && <section className="featured-model-picks" aria-label="Recommended installed local models"><div className="featured-model-heading"><b>YOUR RECOMMENDED LOCAL PICKS</b><span>Exact installed tags · selecting does not load or download</span></div><div className="featured-model-grid">{featuredModels.map((row) => <button type="button" className={`featured-model-card ${model === row.id ? 'selected' : ''}`} key={row.id} onClick={() => onModel(row.id)}><span><b>{row.label}</b><small>{row.note}</small></span><code>{row.id}</code></button>)}</div></section>}
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

function SettingsModal({ model, modelLabel, modelInfo, options, setOptions, activityDefault, setActivityDefault, activityMode, setActivityMode, askActivityChoice, setAskActivityChoice, hasSession, running, updateState, onCheckUpdate, onInstallUpdate, onClose, onSave, onMcp, onPermissions }: {
  model: string; modelLabel: string; modelInfo: ModelInfo | null; options: typeof initialOptions; setOptions: React.Dispatch<React.SetStateAction<typeof initialOptions>>;
  activityDefault: ActivityMode; setActivityDefault: (mode: ActivityMode) => void; activityMode: ActivityMode; setActivityMode: (mode: ActivityMode) => void;
  askActivityChoice: boolean; setAskActivityChoice: (ask: boolean) => void; hasSession: boolean; running: boolean;
  updateState: AppUpdateState; onCheckUpdate: () => void; onInstallUpdate: () => void;
  onClose: () => void; onSave: () => void; onMcp: () => void; onPermissions: () => void;
}) {
  const tokenPresets = buildTokenPresets({ contextLimit: modelInfo?.context ?? null, contextLimitKnown: modelInfo?.context_limit_known ?? false, outputLimit: modelInfo?.max_output_tokens ?? null });
  const reasoning = modelInfo?.reasoning;
  const reasoningValues: Array<boolean | string | null> = [null, ...(reasoning?.support === 'toggle' || reasoning?.support === 'levels' ? reasoning.values : [])];
  const selectedReasoningIndex = Math.max(0, reasoningValues.findIndex((value) => value === options.reasoning));
  const field = (label: string, value: number, key: 'context' | 'maxTokens' | 'temperature') => <label className="settings-field"><span>{label}</span><input type="number" value={value} min={key === 'context' ? 1024 : 1} max={key === 'temperature' ? 2 : undefined} step={key === 'temperature' ? 0.1 : 1} onChange={(e) => setOptions((old) => ({ ...old, [key]: key === 'temperature' ? Number(e.target.value) : Number.parseInt(e.target.value || '0', 10) }))}/></label>;
  return <Modal title="Run configuration" eyebrow="MODEL / EXECUTION" onClose={onClose}>
    <div className="setting-model-strip"><span className="picker-symbol"><Icon name="spark"/></span><span><small>SELECTED MODEL</small><strong title={model}>{modelLabel}</strong><i>{reasoning?.support === 'levels' || reasoning?.support === 'toggle' ? 'Reasoning values reported by runtime' : 'Reasoning controls unavailable; model default is preserved'}</i></span></div>
    <div className="settings-fields"><label className="settings-field"><span>Context window preset{tokenPresets.contextLimitKnown ? '' : ' · model maximum unknown'}</span><select value={tokenPresets.context.some((preset) => preset.value === options.context) ? String(options.context) : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setOptions((old) => ({ ...old, context: Number(e.target.value) })); }}><option value="custom">Custom value</option>{tokenPresets.context.map((preset) => <option key={preset.value} value={preset.value} disabled={preset.disabled}>{preset.label}{preset.disabled ? ' · exceeds model limit' : ''}</option>)}</select></label>{field('Context tokens · custom', options.context, 'context')}{<label className="settings-field"><span>Maximum output preset{tokenPresets.outputLimitKnown ? '' : ' · provider maximum unknown'}</span><select value={tokenPresets.output.some((preset) => preset.value === options.maxTokens) ? String(options.maxTokens) : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setOptions((old) => ({ ...old, maxTokens: Number(e.target.value) })); }}><option value="custom">Custom value</option>{tokenPresets.output.map((preset) => <option key={preset.value} value={preset.value} disabled={preset.disabled}>{preset.label}{preset.disabled ? ' · exceeds supported limit' : ''}</option>)}</select></label>}{field('Maximum output tokens · custom', options.maxTokens, 'maxTokens')}{field('Temperature', options.temperature, 'temperature')}</div>
    <small className="token-controls-note">Preset values are shortcuts, not a maximum. Custom context and output values are preserved as entered and are not silently lowered.</small>
    <label className="settings-field"><span>Reasoning</span><select value={String(selectedReasoningIndex)} onChange={(e) => { const value = reasoningValues[Number(e.target.value)] ?? null; setOptions((old) => ({ ...old, reasoning: normalizeReasoningChoice(value, reasoning ?? null) })); }}><option value="0">Model default</option>{reasoningValues.slice(1).map((value, index) => <option key={`${typeof value}-${String(value)}-${index}`} value={index + 1}>{typeof value === 'boolean' ? value ? 'On' : 'Off' : value}</option>)}</select><small>{reasoning ? `Model default: ${String(reasoning.default ?? 'not reported')}` : 'The model did not report reasoning controls; no override will be sent.'}</small></label>
    <div className="context-facts"><span>Advertised maximum <b>{modelInfo?.context_limit_known ? fmt(modelInfo.context ?? undefined) : 'Unknown'}</b></span><span>Runtime context <b>{modelInfo?.effective_context ? fmt(modelInfo.effective_context) : modelInfo?.provider === 'llama.cpp' ? 'Not loaded / allocation unverified' : 'Shown in the task signal panel'}</b></span></div>
    <label className="settings-field"><span>Keep model warm after a request</span><select value={options.keepAlive} onChange={(e) => setOptions((old) => ({ ...old, keepAlive: e.target.value }))}><option value="30m">30 minutes</option><option value="10m">10 minutes</option><option value="5m">5 minutes</option><option value="0">Unload when idle (Ollama setting)</option></select></label>
    <label className="settings-field"><span>Task intent</span><select value={options.taskIntent} onChange={(e) => setOptions((old) => ({ ...old, taskIntent: e.target.value as TaskIntent }))}><option value="auto">Automatic</option><option value="discuss">Discuss / investigate</option><option value="plan">Plan only</option><option value="implement">Implement</option></select><small>Automatic continues an agent's Plan phase into implementation and inspection. A plan explicitly requested without implementation is tracked separately. Choose Plan only or Discuss for a guaranteed non-mutating run. Implement seeds a visible checklist. File access and approval still independently limit changes.</small>{options.taskIntent === 'implement' && options.access === 'plan' && <small className="auto-approve-warning">Read-only File access prevents implementation edits. Choose Ask before writes or another access mode to let the agent change files.</small>}</label>
    <div className="settings-fields select-fields"><label className="settings-field"><span>File access</span><select value={options.access} onChange={(e) => setOptions((old) => ({ ...old, access: e.target.value as AccessMode }))}><option value="copy">Copy workspace</option><option value="plan">Read only</option><option value="ask">Ask before writes</option><option value="edit">Edit project</option></select></label><label className="settings-field"><span>Approval</span><select value={options.approvalMode} onChange={(e) => setOptions((old) => ({ ...old, approvalMode: e.target.value as ApprovalMode }))}><option value="per-action">Approve each action</option><option value="per-task">Approve for this task</option><option value="per-session">Approve for this chat session</option><option value="auto">Auto-approve actions · this run</option></select>{options.approvalMode === 'per-session' && <small className="auto-approve-warning">The first approved action grants later actions in this saved chat session, including future turns. Switch back to per-action to revoke. Persistent deny and ask rules still apply.</small>}{options.approvalMode === 'auto' && <small className="auto-approve-warning">Skips action prompts for this run. Commands and MCP still run with your Windows account permissions; this setting does not sandbox them to the selected project.</small>}</label></div>
    <label className="settings-field"><span>Harness workflow</span><select value={options.harnessProfile} onChange={(e) => setOptions((old) => ({ ...old, harnessProfile: e.target.value as HarnessProfile }))}><option value="standard">Standard</option><option value="small-model">Small-model workflow</option></select><small>Small-model workflow adapts tool-step size to the task, groups independent reads when useful, and inspects results while continuing the full request. It sets no fixed action or runtime limit and does not change model, context, output tokens, reasoning, temperature, access, or approvals.</small></label>
    <label className="activity-choice-toggle"><input type="checkbox" checked={options.skillsEnabled} onChange={(event) => setOptions((old) => ({ ...old, skillsEnabled: event.target.checked }))}/><span><b>Allow reusable skills for this app and session</b><small>When enabled, the model may load a relevant skill through its tool. Skill text is untrusted guidance and does not grant permissions.</small></span></label>
    <div className="settings-field"><span>Skill sources</span><div className="skill-source-choices"><label><input type="checkbox" checked={options.skillSources.includes('project')} disabled={options.skillSources.length === 1 && options.skillSources.includes('project')} onChange={(event) => setOptions((old) => ({ ...old, skillSources: event.target.checked ? [...new Set([...old.skillSources, 'project' as SkillSource])] : old.skillSources.filter((source) => source !== 'project') }))}/><span>Selected project and Git ancestors</span></label><label><input type="checkbox" checked={options.skillSources.includes('user')} disabled={options.skillSources.length === 1 && options.skillSources.includes('user')} onChange={(event) => setOptions((old) => ({ ...old, skillSources: event.target.checked ? [...new Set([...old.skillSources, 'user' as SkillSource])] : old.skillSources.filter((source) => source !== 'user') }))}/><span>User skill folders</span></label></div><small>The selected sources are captured per run. Workbench does not read or change Codex/OpenCode skill settings.</small></div>
    <section className="update-settings" aria-label="Application updates"><div><span className="eyebrow-line">APPLICATION / {updateState.currentVersion}</span><b>{updateState.status === 'downloaded' ? `${updateState.releaseName || 'Update'} is ready` : updateState.status === 'downloading' || updateState.status === 'available' ? 'Downloading update' : updateState.status === 'checking' ? 'Checking GitHub releases…' : updateState.status === 'not-available' ? 'You’re up to date' : updateState.status === 'error' ? 'Update check failed' : updateState.supported ? 'Automatic updates enabled' : 'Updates unavailable in this build'}</b><small>{updateState.error || (updateState.status === 'downloaded' ? 'Restart to apply it. Updates are never installed during an active task.' : updateState.supported ? 'Checks public GitHub releases and downloads in the background. Install is always user-controlled.' : 'Automatic updates are configured for installed Windows x64 builds.')}</small></div><div>{updateState.status === 'downloaded' ? <Button kind="bright" disabled={running} onClick={onInstallUpdate}>{running ? 'Finish active task to update' : 'Restart and update'}</Button> : <Button kind="outline" disabled={!updateState.supported || running || updateState.status === 'checking' || updateState.status === 'downloading'} onClick={onCheckUpdate}>{running ? 'Available when task ends' : updateState.status === 'checking' ? 'Checking…' : 'Check for updates'}</Button>}</div></section>
    <div className="settings-fields select-fields"><label className="settings-field"><span>App-wide activity default</span><select value={activityDefault} onChange={(event) => setActivityDefault(event.target.value as ActivityMode)}><option value="compact">Compact cards · expandable</option><option value="sidebar">Activity sidebar only</option><option value="inline">Full inline output</option></select></label>{hasSession && <label className="settings-field"><span>This session activity view</span><select value={activityMode} onChange={(event) => setActivityMode(event.target.value as ActivityMode)}><option value="compact">Compact cards · expandable</option><option value="sidebar">Activity sidebar only</option><option value="inline">Full inline output</option></select></label>}</div>
    <label className="activity-choice-toggle"><input type="checkbox" checked={askActivityChoice} onChange={(event) => setAskActivityChoice(event.target.checked)}/><span><b>Choose an activity view for each new session</b><small>When off, new sessions use the app-wide default.</small></span></label>
    <div className="settings-bottom"><Button kind="outline" onClick={onMcp}>Configure local MCP</Button><Button kind="outline" onClick={onPermissions}>Tool permissions</Button><span>Context is never silently reduced.</span></div>
    <div className="modal-actions"><Button kind="quiet" onClick={onClose}>Cancel</Button><Button kind="bright" disabled={running} onClick={onSave}>{hasSession ? 'Apply to this session' : 'Save app defaults'}</Button></div>
  </Modal>;
}

function PermissionRulesModal({ rules, setRules, tools, loading, running, onClose, onSave }: {
  rules: PermissionRuleDraft[]; setRules: React.Dispatch<React.SetStateAction<PermissionRuleDraft[]>>;
  tools: ToolCatalog['tools']; loading: boolean; running: boolean; onClose: () => void; onSave: () => void;
}) {
  const toolNames = [...new Set(['run_command', 'run_shell', ...tools.map((tool) => tool.name)])].sort();
  const update = (index: number, values: Partial<PermissionRuleDraft>) => setRules((current) => current.map((rule, row) => row === index ? { ...rule, ...values } : rule));
  return <Modal title="Tool permission rules" eyebrow="PERSISTENT ACCESS POLICY" wide onClose={onClose}>
    <p className="modal-copy">Rules apply across sessions. Without a matching rule, the current run approval mode applies. A matching <b>deny</b> is a hard block; <b>ask</b> always opens the approval prompt, even during auto-approval; and <b>allow</b> skips that prompt. Deny takes precedence over ask and allow. Path patterns match project-relative tool targets. Commands and MCP servers still run with your Windows account permissions; these rules are not OS containment.</p>
    {loading && <div className="empty-state">Loading saved rules…</div>}
    <div className="permission-rule-list">
      {rules.map((rule, index) => <div className="permission-rule-row" key={`${index}:${rule.tool}`}>
        <label className="settings-field"><span>Tool</span><select value={rule.tool} onChange={(event) => { const tool = event.target.value; update(index, { tool, ...((rule.scope === 'command' && !['*', 'run_command', 'run_shell'].includes(tool)) || (rule.scope === 'path' && ['run_command', 'run_shell'].includes(tool)) ? { scope: 'tool' as const, value: '' } : {}) }); }}><option value="*">All tools</option>{toolNames.map((name) => <option value={name} key={name}>{name}</option>)}</select></label>
        <label className="settings-field"><span>Decision</span><select value={rule.decision} onChange={(event) => update(index, { decision: event.target.value as PermissionRuleDraft['decision'] })}><option value="allow">Allow</option><option value="ask">Ask every time</option><option value="deny">Deny</option></select></label>
        <label className="settings-field"><span>Match scope</span><select value={rule.scope} onChange={(event) => update(index, { scope: event.target.value as PermissionRuleDraft['scope'], value: '' })}><option value="tool">Every call to this tool</option><option value="path" disabled={['run_command', 'run_shell'].includes(rule.tool)}>Project path glob</option><option value="command" disabled={!['*', 'run_command', 'run_shell'].includes(rule.tool)}>Command prefix</option></select></label>
        {rule.scope !== 'tool' && <label className="settings-field permission-rule-scope"><span>{rule.scope === 'path' ? 'Relative path pattern' : 'Command prefix'}</span><input value={rule.value} placeholder={rule.scope === 'path' ? 'src/generated/**' : rule.tool === 'run_shell' ? 'python -m pytest' : '["python", "-m", "pytest"]'} onChange={(event) => update(index, { value: event.target.value })}/><small>{rule.scope === 'path' ? 'For multi-file patches, deny/ask matches any affected path; allow applies only when every target matches.' : rule.tool === 'run_shell' ? 'Matches the beginning of the PowerShell command.' : rule.tool === '*' ? 'Wildcard command rules use JSON argv tokens and match both run_command and run_shell.' : 'Use a JSON array of exact argv prefix tokens.'}</small></label>}
        <Button kind="quiet" onClick={() => setRules((current) => current.filter((_, row) => row !== index))}>Remove</Button>
      </div>)}
      {!rules.length && <div className="empty-state">No persistent overrides. Actions continue to use the run’s selected approval mode.</div>}
    </div>
    <div className="permission-rule-actions"><Button kind="outline" disabled={running} onClick={() => setRules((current) => [...current, { tool: 'run_command', decision: 'ask', scope: 'tool', value: '' }])}>Add rule</Button><span>{rules.length} saved override{rules.length === 1 ? '' : 's'}</span></div>
    <div className="modal-actions"><Button kind="quiet" onClick={onClose}>Cancel</Button><Button kind="bright" disabled={running || loading} onClick={onSave}>{running ? 'Unavailable during a run' : 'Save permission rules'}</Button></div>
  </Modal>;
}

function ApprovalModal({ approval, onChoice, onCancelRun }: { approval: Approval; onChoice: (value: boolean) => void; onCancelRun: () => void }) {
  const hostExecution = approval.name === 'run_command' || approval.name === 'run_shell' || approval.name.startsWith('mcp__');
  return <Modal title={approval.name.replaceAll('_', ' ')} eyebrow="ACTION NEEDS YOUR REVIEW" wide dismissible={false} onClose={() => undefined}>
    <p className="modal-copy">The agent requested an action under <b>{approval.mode === 'per-session' ? 'chat-session' : approval.mode === 'per-task' ? 'per-task' : 'per-action'} approval</b>. Review the exact arguments and selected workspace, then choose an action.{approval.mode === 'per-session' ? ' Approving runs this action and grants later actions in this saved chat session.' : ''}</p>
    <div className="approval-context"><span>WORKSPACE</span><code>{approval.workspace}</code></div>
    {hostExecution && <div className="execution-boundary-warning"><b>Runs with your Windows account permissions</b><span>The selected folder is the working directory. It is not an OS security boundary: this command or MCP server may access other files and services your account can reach.</span></div>}
    <pre className="diff-view approval-preview">{JSON.stringify(approval.arguments, null, 2)}</pre>
    <div className="modal-actions"><Button kind="quiet" onClick={onCancelRun}>Cancel task</Button><Button kind="outline" onClick={() => onChoice(false)}>Deny action</Button><Button kind="bright" onClick={() => onChoice(true)}>{approval.mode === 'per-session' ? 'Approve action + session' : approval.mode === 'per-task' ? 'Approve task' : 'Approve action'}</Button></div>
  </Modal>;
}

function AgentQuestionModal({ question, disabled, onAnswer, onCancelRun }: {
  question: AgentQuestion; disabled: boolean; onAnswer: (answer: string) => void; onCancelRun: () => void;
}) {
  const [answer, setAnswer] = useState('');
  useEffect(() => setAnswer(''), [question.questionId]);
  return <Modal title={question.title} eyebrow="AGENT QUESTION · RUN PAUSED" wide dismissible={false} onClose={() => undefined}>
    <p className="modal-copy">The agent paused because this choice changes the work. Select an option or enter your own answer. This is separate from action approval.</p>
    <div className="agent-question-prompt">{question.question}</div>
    {question.options.length > 0 && <div className="activity-mode-choices">{question.options.map((option, index) => <button key={`${question.questionId}-${index}`} className="activity-mode-choice" disabled={disabled} onClick={() => onAnswer(option.label)}><b>{option.label}</b>{option.description && <small>{option.description}</small>}</button>)}</div>}
    <label className="settings-field agent-question-field"><span>Your answer</span><textarea value={answer} disabled={disabled} onChange={(event) => setAnswer(event.target.value)} placeholder="Type a response…"/></label>
    <div className="modal-actions"><Button kind="quiet" disabled={disabled} onClick={onCancelRun}>Cancel task…</Button><Button kind="bright" disabled={disabled || !answer.trim()} onClick={() => onAnswer(answer)}>{disabled ? 'Sending answer…' : 'Send answer'}</Button></div>
  </Modal>;
}
