export type AccessMode = 'copy' | 'plan' | 'ask' | 'edit';
export type ApprovalMode = 'per-action' | 'per-task' | 'per-session' | 'auto';
export type ReasoningChoice = boolean | string | null;
export type HarnessProfile = 'standard' | 'small-model';
export type TaskIntent = 'auto' | 'discuss' | 'plan' | 'implement';
export type SkillSource = 'project' | 'user';
export type ReasoningCapability = {
  support: 'toggle' | 'levels' | 'unknown' | 'none';
  default: boolean | string | null;
  values: Array<boolean | string>;
};

export type RunOptions = {
  workspace: string;
  sessionId?: string;
  providerId: 'ollama' | 'llama.cpp';
  prompt: string;
  model: string;
  context: number;
  maxTokens: number;
  temperature: number;
  access: AccessMode;
  approvalMode: ApprovalMode;
  keepAlive: string;
  reasoning: ReasoningChoice;
  reasoningBudgetTokens: number | null;
  harnessProfile: HarnessProfile;
  taskIntent: TaskIntent;
  skillsEnabled: boolean;
  skillSources: SkillSource[];
  queuedPromptId?: string;
};

export type QueuedPrompt = { id: string; prompt: string; queued_at: number };

export type SessionLiveSnapshot = {
  active: boolean;
  sessionId: string;
  turnId?: string;
  workspace?: string;
  activityRevision?: number;
  textRevision?: number;
  runState?: Record<string, unknown>;
  activities?: ActivityRecord[];
  plan?: PlanItemSnapshot[];
  acceptanceCriteria?: string[];
  liveAssistant?: { content: string; thinking: string };
  conflict?: { recommended_source?: 'app' | 'project'; versions?: Array<{ source: 'app' | 'project'; updated_at?: number }> };
  savedTranscript?: {
    messages: Array<{ role: string; content?: string; thinking?: unknown }>;
    turns: Array<{ turn_id?: string; transcript_saved?: boolean }>;
    usage_events?: Array<Record<string, unknown>>;
  };
};

export type PlanItemSnapshot = { title?: string; text?: string; status?: string; source?: 'workbench' | 'agent'; group?: string };

export type WorkerCommand =
  | { command: 'ping' }
  | { command: 'models' }
  | { command: 'model_catalog' }
  | { command: 'model_info'; model: string }
  | { command: 'ollama_preload'; model: string; context: number; keepAlive: string }
  | { command: 'tool_catalog' }
  | { command: 'permission_rules_get' }
  | { command: 'permission_rules_set'; rules: Array<{ tool: string; decision: 'allow' | 'ask' | 'deny'; path_glob?: string; command_prefix?: string | string[]; workspace?: string }> }
  | { command: 'hf_search'; query: string }
  | { command: 'hf_repo_files'; repo: string; revision: string }
  | { command: 'hf_download_start'; repo: string; revision: string; files: string[] }
  | { command: 'hf_download_cancel' }
  | { command: 'gguf_register'; path: string; source?: { kind: string; repo?: string; revision?: string; file?: string } }
  | { command: 'llama_binary_set'; path: string }
  | { command: 'llama_status' }
  | { command: 'llama_model_load'; model: string; context: number; reasoning: ReasoningChoice }
  | { command: 'llama_model_cancel' }
  | { command: 'llama_model_stop' }
  | { command: 'ollama_safetensors_import'; directory: string; name: string }
  | { command: 'ollama_import_cancel' }
  | { command: 'system_snapshot' }
  | { command: 'workspace_files'; workspace: string; offset?: number; limit?: number }
  | { command: 'workspace_diff'; workspace: string }
  | { command: 'workspaces_list'; query?: string }
  | { command: 'workspace_record'; workspace: string }
  | { command: 'workspace_remove'; workspace: string }
  | { command: 'workspace_pin'; workspace: string; pinned: boolean }
  | { command: 'workspace_track_sessions'; workspace: string; track: boolean }
  | { command: 'sessions_list'; workspace?: string }
  | { command: 'session_live_snapshot'; sessionId: string; workspace: string; afterActivityRevision?: number; afterTextRevision?: number }
  | { command: 'session_new'; workspace: string; model: string; context: number; activityMode?: ActivityMode }
  | { command: 'session_activity_mode'; sessionId: string; activityMode: ActivityMode }
  | { command: 'session_run_settings'; sessionId: string; settings: { model: string; context: number; maxTokens: number; temperature: number; access: AccessMode; approvalMode: ApprovalMode; keepAlive: string; reasoning: ReasoningChoice; reasoningBudgetTokens: number | null; harnessProfile: HarnessProfile; taskIntent: TaskIntent; skillsEnabled: boolean; skillSources: SkillSource[] } }
  | { command: 'session_queue_prompt'; sessionId: string; workspace: string; prompt: string }
  | { command: 'session_steer'; sessionId: string; workspace: string; prompt: string }
  | { command: 'session_queue_remove'; sessionId: string; workspace: string; queuedPromptId: string }
  | { command: 'session_harness_profile'; sessionId: string; harnessProfile: HarnessProfile }
  | { command: 'session_recover'; sessionId: string; action: 'resume' | 'retry' | 'restore' }
  | { command: 'session_resume'; sessionId: string; workspace?: string; source?: 'app' | 'project' }
  | { command: 'mcp_config_get' }
  | { command: 'mcp_config_set'; config: unknown }
  | { command: 'run_start'; options: RunOptions }
  | { command: 'run_cancel' }
  | { command: 'run_stop_after_operation' }
  | { command: 'approval_reply'; actionId: string; approved: boolean }
  | { command: 'question_reply'; questionId: string; answer: string }
  | { command: 'copy_review'; sessionId: string }
  | { command: 'copy_apply'; sessionId: string; paths: string[] }
  | { command: 'shutdown' };

export type WorkerEvent = {
  type: string;
  requestId?: string;
  [key: string]: unknown;
};

export type ActivityMode = 'compact' | 'sidebar' | 'inline';
export type ActivityRecord = {
  id: string;
  operationId?: string | null;
  turnId: string;
  sessionId: string;
  workspace?: string;
  kind: 'operation' | 'tool_preparation' | 'approval' | 'question' | 'plan' | 'context' | 'prompt' | 'error';
  taskMode?: 'discussion' | 'plan_only' | 'plan' | 'implement';
  questionId?: string;
  question?: string;
  title?: string;
  options?: Array<{ label: string; description?: string }>;
  answer?: string;
  name?: string;
  status: string;
  /** Latest resumable progress from a long-running structured operation. */
  progress?: { message: string; filesScanned?: number; bytesRead?: number; matches?: number; timestamp?: number };
  source?: 'workbench' | 'agent';
  approvalStatus?: 'waiting' | 'approved' | 'denied' | 'cancelled';
  approvalMode?: 'per-action' | 'per-task' | 'per-session';
  timestamp?: number;
  startedAt?: number;
  completedAt?: number;
  arguments?: unknown;
  output?: Record<string, string>;
  result?: string;
  affectedFiles?: string[];
  items?: Array<{ title?: string; text?: string; status?: string; source?: 'workbench' | 'agent'; group?: string }>;
  /** Concise task decisions, not private chain-of-thought. */
  decisions?: string[];
  /** Concise saved progress handoff emitted before a context-pressure write gate opens. */
  progressCheckpoint?: { verifiedFindings: string[]; completedWork: string[]; pendingWork: string[]; nextAction: string };
  acceptanceCriteria?: string[];
  omittedTurns?: number;
  omittedOperationGroups?: number;
  retainedTurns?: number;
  configuredContext?: number;
  inputBudget?: number;
  reason?: string;
  checkpointIncluded?: boolean;
  checkpointEstimate?: number;
  checkpointCompacted?: boolean;
  checkpointOmissions?: Record<string, number>;
  promptManifest?: Record<string, unknown>;
  /** Exact provider request fields captured immediately before dispatch. */
  providerRequest?: Record<string, unknown>;
  /** Provider-returned token and timing counters for this specific request. */
  providerUsage?: Record<string, unknown>;
  /** Safe streaming metadata; partial model arguments are deliberately never stored. */
  provider?: string;
  requestIndex?: number;
  callIndex?: number;
  argumentCharacters?: number;
};

export type ActivityEventEnvelope = {
  type: 'activity_event';
  activity: ActivityRecord | null;
  activityId?: string;
  activityPhase?: 'start' | 'progress';
  stream?: 'stdout' | 'stderr';
  chunk?: string;
  sessionId?: string;
  turnId?: string;
  timestamp?: number;
};

export type WorkerResponse = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type DesktopApi = {
  request: <T = unknown>(command: WorkerCommand) => Promise<T>;
  windowControl: (action: 'minimize' | 'maximize' | 'close') => Promise<void>;
  windowState: () => Promise<boolean>;
  onWindowState: (listener: (maximized: boolean) => void) => () => void;
  onEvent: (listener: (event: WorkerEvent) => void) => () => void;
  onCloseDecision: (listener: () => void) => () => void;
  resolveCloseChoice: (choice: 'keep' | 'hide' | 'cancel-close') => Promise<void>;
  chooseWorkspace: () => Promise<string | null>;
  chooseExternalDirectory: () => Promise<string | null>;
  chooseModelFile: () => Promise<string | null>;
  chooseLlamaBinary: () => Promise<string | null>;
  chooseModelDirectory: () => Promise<string | null>;
  revealPath: (path: string) => Promise<void>;
  openOllamaDownload: () => Promise<void>;
  updateState: () => Promise<AppUpdateState>;
  onUpdateState: (listener: (state: AppUpdateState) => void) => () => void;
  checkForUpdate: () => Promise<AppUpdateState>;
  installUpdate: () => Promise<{ installed: boolean; reason?: string }>;
  version: string;
};

export type AppUpdateState = {
  supported: boolean;
  status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
  currentVersion: string;
  releaseName?: string;
  error?: string;
};

export type ModelInfo = {
  model: string;
  family?: string | null;
  parameter_size?: string | null;
  quantization?: string | null;
  context: number | null;
  effective_context?: number | null;
  context_limit_known?: boolean;
  max_output_tokens?: number | null;
  reasoning: ReasoningCapability;
  capabilities?: string[];
  tool_support?: 'supported' | 'unsupported' | 'unknown';
  provider?: 'ollama' | 'llama.cpp';
};

export type ModelCatalog = { ollama: string[]; gguf: Array<{ id: string; label: string; provider: 'llama.cpp' }>; ollama_error: string | null };
export type ToolCatalog = {
  tools: Array<{ name: string; description: string; source: 'built-in' | 'mcp'; permission: string }>;
  integrations: Array<{ name: string; status: 'available' | 'configured' | 'not-installed' | 'planned'; detail: string }>;
  mcpServers: Array<{ name: string; status: 'configured' | 'connected' | 'error'; detail?: string }>;
};

export type SessionSummary = {
  session_id: string;
  workspace: string;
  model: string;
  provider_id?: 'ollama' | 'llama.cpp';
  model_id?: string;
  updated_at: number;
  workspace_id?: string;
  workspace_available?: boolean;
  sync_conflict?: boolean;
  recommended_source?: 'app' | 'project';
  sources?: Array<'app' | 'project'>;
  recovery_status?: string | null;
  uncertain_operation?: string | null;
  recovery_issue_count?: number;
};

export type WorkspaceHistoryEntry = {
  path: string;
  workspace_id?: string | null;
  pinned: boolean;
  available: boolean;
  first_opened_at?: number;
  last_opened_at?: number;
};

export type SessionConflict = {
  conflict: true;
  recommended_source: 'project';
  versions: Array<{ source: 'app' | 'project'; updated_at?: number }>;
};

export type ProjectFile = { path: string; size: number; text: boolean };
export type ProjectFilePage = { files: ProjectFile[]; offset: number; next_offset: number | null };

declare global {
  interface Window { agent: DesktopApi }
}
