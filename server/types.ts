export type TaskState =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';
export interface Repository {
  fullName: string;
  baseBranch: string;
  directory?: string;
  taskBranch?: string;
  baseSha?: string;
  configDigest?: string;
  prUrl?: string;
  prNumber?: number;
}
export interface Task {
  id: string;
  name: string;
  prompt: string;
  pendingPrompt: string;
  repositories: Repository[];
  model: string;
  effort?: string;
  permission: 'review' | 'workspace';
  network: boolean;
  state: TaskState;
  threadId?: string;
  turnId?: string;
  runtimeVersion?: string;
  workspace: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}
export interface RuntimeRecord {
  version: string;
  previous?: string;
  latest?: string;
  lastChecked?: string;
  lastUpdated?: string;
  error?: string;
}
export interface Settings {
  automaticUpdates: boolean;
  concurrency: number;
  channel: 'stable';
}
export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code: number; message: string };
}
export interface Approval {
  id: string | number;
  method: string;
  params: Record<string, any>;
}
export interface Model {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  inputModalities?: string[];
}
export const terminalStates: TaskState[] = ['completed', 'failed', 'interrupted', 'cancelled'];
