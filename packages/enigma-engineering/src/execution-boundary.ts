import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

export interface ProcessBoundary {
  schema: 1;
  kind: 'seatbelt' | 'explicit-host';
  prefix: string[];
  denyReadPaths: string[];
  readOnlyPaths: string[];
}
const boundaries = new AsyncLocalStorage<ProcessBoundary>();
const environmentKey = 'ENIGMA_PROCESS_BOUNDARY';

export function processBoundary(): ProcessBoundary | undefined {
  const active = boundaries.getStore();
  if (active) return active;
  const encoded = process.env[environmentKey];
  if (!encoded) return undefined;
  const value = JSON.parse(encoded) as ProcessBoundary;
  if (value.schema !== 1 || !['seatbelt','explicit-host'].includes(value.kind) || !Array.isArray(value.prefix)
    || !Array.isArray(value.denyReadPaths) || !Array.isArray(value.readOnlyPaths)
    || [...value.prefix,...value.denyReadPaths,...value.readOnlyPaths].some(item => typeof item !== 'string' || item.includes('\0'))) throw new Error('Invalid host execution boundary');
  return value;
}

export async function withProcessBoundary<T>(boundary: ProcessBoundary, action: () => Promise<T>) { return boundaries.run(boundary,action); }

/** Only application-owned workers receive the boundary; model argv cannot grant a bypass. */
export function workerEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const boundary = processBoundary();
  return boundary ? { ...environment, [environmentKey]:JSON.stringify(boundary) } : environment;
}

export function guardedArgv(argv: string[], internalGit = false) {
  const boundary = processBoundary();
  return boundary && !internalGit ? [...boundary.prefix,...argv] : argv;
}

export function assertBoundaryPath(file: string, access: 'read' | 'write') {
  const boundary = processBoundary();
  if (!boundary) return;
  const canonical = (value: string) => { try { return realpathSync(value); } catch { return resolve(value); } };
  const target = canonical(file), inside = (root: string) => { const base=canonical(root); return target === base || target.startsWith(base+sep); };
  if (boundary.denyReadPaths.some(inside)) throw new Error('Native host denies access to this protected path');
  if (access === 'write' && boundary.readOnlyPaths.some(inside)) throw new Error('Native host marks this path read-only');
}
