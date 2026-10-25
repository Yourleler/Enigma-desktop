export type Access = 'read' | 'write';
export interface Repo {
  id: string;
  root: string;
  role: string;
  access: Access;
  dependsOn: string[];
}
export interface Check {
  id: string;
  repo: string;
  argv: string[];
  timeoutMs?: number;
  joint?: boolean;
}
export interface WorkspaceConfig {
  schema: 1;
  repos: Repo[];
  checks: Check[];
}
export interface FileVersion { hash: string; mode: number }
export interface RepoSnapshot {
  repo: Repo;
  head: string;
  branch: string;
  files: Record<string, FileVersion>;
  ignored?: string[];
}
export interface Checkpoint {
  schema: 1;
  id: string;
  label: string;
  createdAt: string;
  session?: string;
  entry?: string;
  repos: RepoSnapshot[];
  references: string[];
  plan?: { id: string; revision: number };
}
export interface ForkHandoff {
  sourceSession: string;
  requirements: string[];
  requests: number;
}
export interface ProcessResult {
  argv: string[];
  exitCode: number | null;
  signal: string | null;
  status: 'passed' | 'failed' | 'cancelled' | 'timeout' | 'unknown';
  output: string;
  durationMs: number;
  truncated: boolean;
  cleanup?: 'complete' | 'unknown';
}
export interface Observation {
  fingerprints: Record<string, string>;
  environment: string;
  configuration: string;
}
export interface Evidence {
  id: string;
  kind: 'check' | 'reading';
  createdAt: string;
  checkpoint?: string;
  fingerprints: Record<string, string>;
  environment: string;
  configuration?: string;
  validAtCapture?: boolean;
  data: unknown;
}
export interface OperationRecord {
  schema: 1;
  id: string;
  repo?: string;
  operation?: string;
  status: 'pending' | 'settled' | 'unknown' | 'failed' | 'rolled-back' | 'acknowledged';
  before?: RepoSnapshot;
  after?: RepoSnapshot;
  beforeWorkspace?: RepoSnapshot[];
  afterWorkspace?: RepoSnapshot[];
  scope?: 'repository' | 'workspace';
  changes?: { repo: string; file: string }[];
  error?: string;
  observation?: string;
  createdAt?: string;
}
