export type AccessMode = 'copy' | 'plan' | 'ask' | 'edit';
export type ApprovalMode = 'per-action' | 'per-task' | 'auto';
export type ReasoningChoice = boolean | string | null;
export type ReasoningCapability = {
  support: 'toggle' | 'levels' | 'unknown' | 'none';
  default: boolean | string | null;
  values: Array<boolean | string>;
};

export type RunOptions = {
  workspace: string;
  sessionId?: string;
  prompt: string;
  model: string;
  context: number;
  maxTokens: number;
  temperature: number;
  access: AccessMode;
  approvalMode: ApprovalMode;
  keepAlive: string;
  reasoning: ReasoningChoice;
};

export type WorkerCommand =
  | { command: 'ping' }
  | { command: 'models' }
  | { command: 'model_info'; model: string }
  | { command: 'system_snapshot' }
  | { command: 'workspace_files'; workspace: string }
  | { command: 'workspace_diff'; workspace: string }
  | { command: 'sessions_list'; workspace?: string }
  | { command: 'session_new'; workspace: string; model: string; context: number }
  | { command: 'session_resume'; sessionId: string }
  | { command: 'mcp_config_get' }
  | { command: 'mcp_config_set'; config: unknown }
  | { command: 'run_start'; options: RunOptions }
  | { command: 'run_cancel' }
  | { command: 'approval_reply'; actionId: string; approved: boolean }
  | { command: 'copy_review'; sessionId: string }
  | { command: 'copy_apply'; sessionId: string; paths: string[] }
  | { command: 'shutdown' };

export type WorkerEvent = {
  type: string;
  requestId?: string;
  [key: string]: unknown;
};

export type WorkerResponse = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type DesktopApi = {
  request: <T = unknown>(command: WorkerCommand) => Promise<T>;
  onEvent: (listener: (event: WorkerEvent) => void) => () => void;
  chooseWorkspace: () => Promise<string | null>;
  revealPath: (path: string) => Promise<void>;
  version: string;
};

export type ModelInfo = {
  model: string;
  context: number;
  max_output_tokens?: number | null;
  reasoning: ReasoningCapability;
};

export type SessionSummary = {
  session_id: string;
  workspace: string;
  model: string;
  updated_at: number;
};

export type ProjectFile = { path: string; size: number; text: boolean };

declare global {
  interface Window { agent: DesktopApi }
}
