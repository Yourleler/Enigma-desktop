import { workerEnvironment } from './execution-boundary.js';
import { spawn } from 'node:child_process';
import { readdir, realpath, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { Workspace } from './workspace.js';
import { processIdentity } from './observer.js';
import { ensureDir, hash, id, readJson, safeId, writeJson, redact } from './storage.js';

export interface BackgroundInput { repo: string; argv: string[]; label: string; task?: string; maxRuntimeMs?: number; envRefs?: Record<string, string>; kind?: 'command' | 'service'; portPrefix?: string }
export interface BackgroundSpec extends BackgroundInput { schema: 1; id: string; root: string; cwd: string; createdAt: string; maxRuntimeMs: number; fingerprint: string }
export interface BackgroundState {
  schema: 1; id: string; fingerprint: string; status: 'starting' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timeout' | 'unknown';
  observedAt: string; workerPid: number; workerIdentity?: string; childPid?: number; childIdentity?: string;
  exitCode?: number | null; signal?: string | null; output: string; outputBytes: number; truncated: boolean; cleanup?: 'complete' | 'unknown'; error?: string;
  port?: number;
}
export class BackgroundRuns {
  constructor(readonly workspace: Workspace, private readonly probeIdentity = processIdentity) {}
  async directory(run: string) { return await ensureDir(join(await ensureDir(join(this.workspace.data, 'background')), safeId(run))); }
  async start(input: BackgroundInput, environment: Record<string, string> = {}) {
    return await this.workspace.exclusive(async () => {
      const repo = this.workspace.repo(input.repo); if (repo.access !== 'write') throw new Error('Host commands require a writable registered repository');
      if (!input.label?.trim() || input.label.length > 200 || !Array.isArray(input.argv) || !input.argv.length || input.argv.length > 256
        || input.argv.some(argument => typeof argument !== 'string' || argument.length > 16000 || argument.includes('\0'))) throw new Error('Invalid background command');
      if (input.task) safeId(input.task);
      if (input.portPrefix !== undefined && (!input.portPrefix.length || input.portPrefix.length > 100)) throw new Error('Invalid service port prefix');
      if (input.argv.some(argument => this.workspace.secrets.some(secret => argument.includes(secret)))) throw new Error('Use environment references instead of literal credentials in command arguments');
      for (const [name, reference] of Object.entries(input.envRefs ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference) || process.env[reference] === undefined) throw new Error('Invalid or unavailable command environment reference');
      }
      const maximum = input.maxRuntimeMs ?? (input.kind === 'service' ? 86_400_000 : 3_600_000);
      if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 86_400_000) throw new Error('Invalid background runtime budget');
      const active = await this.list(input.task); if (active.filter(run => ['starting', 'running'].includes(run.state.status)).length >= 12) throw new Error('Background process limit reached');
      const base = { ...input, schema: 1 as const, id: id('run'), root: this.workspace.root, cwd: await realpath(repo.root), createdAt: new Date().toISOString(), maxRuntimeMs: maximum };
      const spec: BackgroundSpec = { ...base, fingerprint: hash(JSON.stringify(base)) };
      const directory = await this.directory(spec.id), path = join(directory, 'input.json'); await writeJson(path, spec);
      const worker = fileURLToPath(new URL('./background-worker.js', import.meta.url)); await access(worker);
      await this.workspace.mutate(repo.id, 'command', async () => {
        const child = spawn(process.execPath, [worker, path], { cwd: this.workspace.root, detached: true, stdio: 'ignore', env: workerEnvironment({ ...process.env, ...environment }) });
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
        const identity = child.pid ? await processIdentity(child.pid) : undefined;
        await writeJson(join(directory, 'owner.json'), { pid: child.pid, identity: identity?.identity, fingerprint: spec.fingerprint });
        return { status: 'dispatched', note: 'Command was started; dispatch is not completion or proof of all background effects.' };
      });
      return { spec, state: await this.waitForState(spec.id, 10_000) };
    });
  }
  private async waitForState(run: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { return (await this.status(run)).state; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await delay(25);
    }
    throw new Error('Background worker did not publish state; inspect its dispatch receipt before retrying');
  }
  async status(run: string, task?: string) {
    const directory = await this.directory(run), spec = await readJson<BackgroundSpec>(join(directory, 'input.json'));
    if (spec.schema !== 1 || spec.id !== run || spec.root !== this.workspace.root) throw new Error('Invalid background run identity');
    const { fingerprint, ...base } = spec; if (hash(JSON.stringify(base)) !== fingerprint) throw new Error('Background specification integrity mismatch');
    if (task && spec.task && spec.task !== task) throw new Error('Background run belongs to another task');
    const readState = async () => {
      const state = await readJson<BackgroundState>(join(directory, 'state.json'));
      if (state.schema !== 1 || state.id !== run || state.fingerprint !== spec.fingerprint || typeof state.output !== 'string' || state.output.length > 64_000
        || !['starting', 'running', 'passed', 'failed', 'cancelled', 'timeout', 'unknown'].includes(state.status)) throw new Error('Invalid background process observation');
      return state;
    };
    let state = await readState();
    const worker = await this.probeIdentity(state.workerPid);
    // The OS probe can outlive a short command. Prefer its newly committed exit
    // receipt over misclassifying an earlier active snapshot as a dead worker.
    if (['starting', 'running'].includes(state.status)) state = await readState();
    const identityMatches = worker.state === 'alive' && !!state.workerIdentity && worker.identity === state.workerIdentity;
    const active = ['starting', 'running'].includes(state.status);
    const current = active && !identityMatches ? { ...state, status: 'unknown' as const, error: 'Worker identity is absent, changed or terminated; effects need reconciliation.' } : state;
    const terminal = !active || worker.state === 'gone' || worker.state === 'alive' && !!state.workerIdentity && !!worker.identity && worker.identity !== state.workerIdentity;
    return { spec, state: current, recordedStatus: state.status, terminal, worker, observationFresh: Date.now() - Date.parse(state.observedAt) < 10_000,
      note: 'A live worker/output is not proof of task completion. The execution boundary is supplied by the active host; repository observations alone do not establish process isolation.' };
  }
  async list(task?: string) {
    const directory = await ensureDir(join(this.workspace.data, 'background')); const results = [];
    for (const run of await readdir(directory)) {
      try { const value = await this.status(run, task); if (!task || !value.spec.task || value.spec.task === task) results.push(value); }
      catch (error) { if (String(error).includes('another task')) continue; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return results;
  }
  async cancel(run: string, task?: string) {
    const observed = await this.status(run, task);
    if (!['starting', 'running'].includes(observed.recordedStatus)) return observed;
    await writeJson(join(await this.directory(run), 'control.json'), { id: run, fingerprint: observed.spec.fingerprint, action: 'cancel' });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { const current = await this.status(run, task); if (current.terminal) return current; await delay(100); }
    throw new Error('Cancellation has not reached a confirmed terminal state; do not replay or restore code yet');
  }
  async wait(run: string, options: { task?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new Error('Background waiting cancelled; the command continues until explicitly cancelled');
      const current = await this.status(run, options.task); if (current.terminal) return current;
      await delay(100);
    }
    return await this.status(run, options.task);
  }
  async drain(run: string, options: { task?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
    const timeoutMs = options.timeoutMs ?? 10000; if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Background drain budget must be 1–60,000 ms');
    const deadline = Date.now() + timeoutMs;
    while (true) {
      options.signal?.throwIfAborted(); const result = await this.status(run, options.task), workerGone = result.worker.state === 'gone'
        || result.worker.state === 'alive' && !!result.state.workerIdentity && !!result.worker.identity && result.worker.identity !== result.state.workerIdentity;
      let childGone = result.state.status !== 'unknown' && result.terminal && result.state.cleanup === 'complete';
      if (!childGone && result.state.childPid) { const child = await processIdentity(result.state.childPid); childGone = child.state === 'gone' || child.state === 'alive' && !!result.state.childIdentity && !!child.identity && child.identity !== result.state.childIdentity; }
      const drained = workerGone && childGone;
      if (drained || Date.now() >= deadline) return { ...result, drained, note: 'Command outcome and owned worker teardown are distinct; an expired drain is not permission to delete its workspace or replay effects.' };
      await delay(100);
    }
  }
  async unresolved() {
    const results = [];
    for (const run of await this.list()) if (run.state.status === 'unknown') {
      try { await readJson(join(await this.directory(run.spec.id), 'reconciled.json')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; results.push(run.spec.id); }
    }
    return results;
  }
  async acknowledge(run: string, observation: string) {
    if (!observation.trim() || observation.length > 4000) throw new Error('Describe the actual background command effects');
    const current = await this.status(run);
    if (['starting', 'running'].includes(current.state.status)) throw new Error('Cannot reconcile a still-running background command');
    const child = current.state.childPid ? await processIdentity(current.state.childPid) : undefined;
    if (current.worker.state === 'alive' && (!current.state.workerIdentity || current.worker.identity === current.state.workerIdentity)
      || child?.state === 'alive' && (!current.state.childIdentity || child.identity === current.state.childIdentity)) throw new Error('Owned worker/command may still be active; confirm termination before reconciling');
    await writeJson(join(await this.directory(run), 'reconciled.json'), { id: run, fingerprint: current.spec.fingerprint, at: new Date().toISOString(), observation: redact(observation, this.workspace.secrets) });
  }
}
