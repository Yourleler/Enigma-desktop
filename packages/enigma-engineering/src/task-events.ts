import { workerEnvironment } from './execution-boundary.js';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Workspace } from './workspace.js';
import type { Observation } from './types.js';
import { processIdentity } from './observer.js';
import { ensureDir, hash, id, readJson, writeJson, safeId, redact } from './storage.js';
import { BackgroundRuns } from './background.js';
import { ServiceManager } from './services.js';
import { runProcess } from './process.js';

export type WaitCondition = { kind: 'background'; run: string } | { kind: 'delegation'; task: string } | { kind: 'service'; service: string; state: 'ready' | 'stopped' }
  | { kind: 'github'; repo: string; run: number };
export interface WaitInput { label: string; condition: WaitCondition; task: string; entry?: string; timeoutMs?: number; pollMs?: number; resume?: boolean }
export interface WaitSpec extends WaitInput { schema: 1; id: string; root: string; createdAt: string; observation: Observation; timeoutMs: number; pollMs: number; fingerprint: string }
export interface WaitState { schema: 1; id: string; status: 'waiting' | 'completed' | 'failed' | 'cancelled' | 'timeout'; workerPid: number; workerIdentity?: string; updatedAt: string; polls: number; lastError?: string; result?: unknown }
export interface TaskEvent { schema: 1; id: string; watch: string; task: string; entry?: string; label: string; outcome: WaitState['status']; result: unknown; createdAt: string; observation: Observation; resume: boolean }

export async function evaluateWait(workspace: Workspace, condition: WaitCondition): Promise<{ done: boolean; failed?: boolean; result: unknown }> {
  if (condition.kind === 'delegation') {
    const task = await new (await import('./delegation.js')).Delegations(workspace).status(condition.task);
    return { done: task.terminal, failed: task.terminal && task.state.status !== 'completed', result: { id: task.spec.id, target: task.spec.target, status: task.status, goal: task.spec.goal, answer: task.state.answer, error: task.state.error, requests: task.state.requests, verification: task.state.verification } };
  }
  if (condition.kind === 'background') {
    const run = await new BackgroundRuns(workspace).status(condition.run);
    return { done: run.terminal, failed: run.terminal && run.state.status !== 'passed', result: { run: run.spec.id, label: run.spec.label, status: run.state.status, recordedStatus: run.recordedStatus, terminal: run.terminal, output: run.state.output, cleanup: run.state.cleanup } };
  }
  if (condition.kind === 'service') {
    const service = await new ServiceManager(workspace).status(condition.service);
    const failed = ['failed', 'configuration-changed', 'dependency-changed', 'source-changed'].includes(service.status) || service.status === 'unknown' && ('executionTerminal' in service && service.executionTerminal);
    return { done: failed || (condition.state === 'ready' ? service.ready : ['passed', 'failed', 'cancelled', 'timeout', 'not-started'].includes(service.status)), failed, result: service };
  }
  const response = await runProcess(['gh', 'api', `repos/${condition.repo}/actions/runs/${condition.run}`], workspace.root, { timeoutMs: 15000, limit: 64000 });
  if (response.status !== 'passed' || response.truncated) throw new Error(`GitHub run query failed: ${response.output.slice(0, 1000)}`);
  const run = JSON.parse(response.output) as { id: number; status: string; conclusion?: string; head_sha?: string; html_url?: string };
  if (run.id !== condition.run) throw new Error('GitHub run identity mismatch');
  return { done: run.status === 'completed', failed: run.conclusion !== 'success', result: { run: run.id, status: run.status, conclusion: run.conclusion, head: run.head_sha, url: run.html_url } };
}

export class TaskEvents {
  constructor(readonly workspace: Workspace) {}
  async directory(watch: string) { return await ensureDir(join(await ensureDir(join(this.workspace.data, 'waits')), safeId(watch))); }
  async start(input: WaitInput) {
    safeId(input.task); if (input.entry) safeId(input.entry);
    if (!input.label?.trim() || input.label.length > 200 || !input.condition) throw new Error('Invalid wait input');
    if (input.condition.kind === 'delegation') await new (await import('./delegation.js')).Delegations(this.workspace).status(input.condition.task, input.task);
    else if (input.condition.kind === 'background') await new BackgroundRuns(this.workspace).status(input.condition.run, input.task);
    else if (input.condition.kind === 'service') await new ServiceManager(this.workspace).status(input.condition.service);
    else if (input.condition.kind !== 'github' || !/^[\w.-]+\/[\w.-]+$/.test(input.condition.repo) || !Number.isSafeInteger(input.condition.run) || input.condition.run < 1) throw new Error('Invalid wait condition');
    const timeoutMs = input.timeoutMs ?? 3_600_000, pollMs = input.pollMs ?? 3000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86_400_000 || !Number.isSafeInteger(pollMs) || pollMs < 250 || pollMs > 60000) throw new Error('Invalid wait budget');
    const watches = await this.list(input.task); if (watches.filter(watch => watch.state.status === 'waiting').length >= 16) throw new Error('Active wait limit reached');
    const base = { ...input, schema: 1 as const, id: id('wait'), root: this.workspace.root, createdAt: new Date().toISOString(), observation: await this.workspace.observe(), timeoutMs, pollMs };
    const spec: WaitSpec = { ...base, fingerprint: hash(JSON.stringify(base)) }, directory = await this.directory(spec.id);
    await writeJson(join(directory, 'input.json'), spec);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./wait-worker.js', import.meta.url)), join(directory, 'input.json')], { cwd: this.workspace.root, detached: true, stdio: 'ignore', env: workerEnvironment(process.env) });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    return spec;
  }
  async status(watch: string, task?: string) {
    const directory = await this.directory(watch), spec = await readJson<WaitSpec>(join(directory, 'input.json'));
    const { fingerprint, ...base } = spec;
    if (spec.schema !== 1 || spec.id !== watch || spec.root !== this.workspace.root || hash(JSON.stringify(base)) !== fingerprint) throw new Error('Invalid wait specification');
    if (task && spec.task !== task) throw new Error('Wait belongs to another task');
    let state: WaitState;
    try { state = await readJson<WaitState>(join(directory, 'state.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { spec, state: { schema: 1 as const, id: watch, status: 'waiting' as const, workerPid: 0, updatedAt: spec.createdAt, polls: 0 }, worker: { state: 'unknown' as const } }; }
    if (state.schema !== 1 || state.id !== watch || !['waiting', 'completed', 'failed', 'cancelled', 'timeout'].includes(state.status)) throw new Error('Invalid wait observation');
    const worker = await processIdentity(state.workerPid);
    return { spec, state, worker, workerCurrent: worker.state === 'alive' && state.workerIdentity === worker.identity, observationFresh: Date.now() - Date.parse(state.updatedAt) < Math.max(spec.pollMs * 3, 20000) };
  }
  async list(task?: string) {
    const directory = await ensureDir(join(this.workspace.data, 'waits')), results = [];
    for (const watch of await readdir(directory)) try { const value = await this.status(watch, task); results.push(value); } catch (error) { if (!String(error).includes('another task') && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return results;
  }
  async cancel(watch: string, task?: string) {
    const value = await this.status(watch, task); if (value.state.status === 'waiting') await writeJson(join(await this.directory(watch), 'control.json'), { id: watch, fingerprint: value.spec.fingerprint, action: 'cancel' }); return value;
  }
  async events(task?: string) {
    const directory = await ensureDir(join(this.workspace.data, 'events')), events = [];
    for (const file of await readdir(directory)) if (file.endsWith('.json')) {
      const event = await readJson<TaskEvent>(join(directory, file));
      if (event.schema !== 1 || event.id + '.json' !== file) throw new Error('Invalid task event');
      if (!task || event.task === task) events.push(event);
    }
    return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async delivery(event: TaskEvent) {
    const path = join(await ensureDir(join(this.workspace.data, 'deliveries')), `${safeId(event.task)}-${safeId(event.id)}.json`);
    try { return await readJson<{ state: string; note?: string }>(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return undefined; }
  }
  async markDelivery(event: TaskEvent, state: 'prepared' | 'enqueued' | 'suppressed', note?: string) {
    const directory = await ensureDir(join(this.workspace.data, 'deliveries'));
    await writeJson(join(directory, `${safeId(event.task)}-${safeId(event.id)}.json`), { state, note: note ? redact(note, this.workspace.secrets) : undefined, at: new Date().toISOString(), event: event.id });
  }
}
