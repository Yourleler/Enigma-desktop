import { workerEnvironment,isolatedWorkerBoundary,withProcessBoundary } from './execution-boundary.js';
import { spawn } from 'node:child_process';
import { access, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Workspace } from './workspace.js';
import { TaskPackages, type TaskPackageInput } from './task-package.js';
import { processIdentity } from './observer.js';
import { ensureDir, hash, id, readJson, redact, safeId, writeJson } from './storage.js';
import type { Checkpoint, Observation } from './types.js';
import { runProcess } from './process.js';
import { BackgroundRuns } from './background.js';
import { PlanStore } from './planning.js';
import { createTwoFilesPatch } from 'diff';

export interface DelegationInput extends TaskPackageInput {
  target: 'pi' | 'codex'; writeRepos?: string[]; checks?: string[]; timeoutMs?: number; maxRequests?: number; provider?: string; model?: string; agentDir?: string;
}
export interface DelegationSpec {
  schema: 1; id: string; parent: string; task?: string; entry?: string; goal: string; target: 'pi' | 'codex'; createdAt: string;
  package: string; packageHash: string; workspace: string; handoff: string; writeRepos: string[]; timeoutMs: number; maxRequests?: number;
  checks: string[];
  provider?: string; model?: string; agentDir?: string; inheritedRequests: number; fingerprint: string;
}
export interface DelegationState {
  schema: 1; id: string; fingerprint: string; status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'budget' | 'unknown';
  workerPid: number; workerIdentity?: string; updatedAt: string; requests: number; tools: number; answer?: string; error?: string;
  session?: string; thread?: string; verification?: unknown; observation?: Observation; targetUsage?: unknown;
  phase?: string;
}
export interface MergePreview {
  schema: 1; id: string; delegation: string; spec: string; expected: string; proposed: string; child: Observation;
  changes: { repo: string; file: string; state: 'apply' | 'already-present' | 'merged' | 'conflict'; reason?: string; patch?: string; patchTruncated?: boolean }[];
  conflicts: string[]; applyAllowed: boolean; createdAt: string;
  criteriaHash?:string;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Isolated child tasks. Parent file mutation is a separate, explicitly previewed operation. */
export class Delegations {
  constructor(readonly workspace: Workspace) {}
  private async directory(task: string) { return await ensureDir(join(await ensureDir(join(this.workspace.data, 'delegations')), safeId(task))); }
  async start(input: DelegationInput) {
    if (!['pi', 'codex'].includes(input.target) || !input.goal?.trim()) throw new Error('Invalid delegation target or goal');
    const timeoutMs = input.timeoutMs ?? 240000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new Error('Invalid delegation time budget');
    if (input.target === 'pi' && (!input.provider || !input.model || !input.agentDir)) throw new Error('Pi delegation requires an existing provider/model/config directory');
    if (input.maxRequests !== undefined && (input.target !== 'pi' || !Number.isSafeInteger(input.maxRequests) || input.maxRequests < 1 || input.maxRequests > 100)) throw new Error('Request budgets of 1–100 are supported for Pi; Codex uses bounded time/output');
    const writeRepos = [...new Set(input.writeRepos ?? [])];
    writeRepos.forEach(repo => { if (this.workspace.repo(repo).access !== 'write') throw new Error('Delegation cannot expand source repository write grants'); });
    const checks = input.checks ?? []; if (!Array.isArray(checks) || checks.some(id => !this.workspace.config.checks.some(check => check.id === id))) throw new Error('Select child checks from existing parent definitions');
    if (!writeRepos.length && checks.length) throw new Error('Read-only children do not execute host checks; select writable isolated repos for executable validation');
    // Preparation reservation is under the source lock; running children do not hold it.
    const taskId = id('delegation'), directory = await this.directory(taskId);
    await this.workspace.exclusive(async () => {
      const active = (await this.list()).filter(item => !item.terminal);
      let preparing = 0;
      for (const name of await readdir(join(this.workspace.data, 'delegations'))) try { const reservation = await readJson<{ status: string; pid: number }>(join(this.workspace.data, 'delegations', name, 'preparation.json')); if (reservation.status === 'preparing' && (await processIdentity(reservation.pid)).state !== 'gone') preparing++; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (active.length + preparing >= 4) throw new Error('At most four child tasks may be active in one workspace');
      await writeJson(join(directory, 'preparation.json'), { status: 'preparing', pid: process.pid, task: input.task, createdAt: new Date().toISOString() });
    });
    try {
      const packaged = await new TaskPackages(this.workspace).export(input);
      const restored = await TaskPackages.restore(packaged.directory, join(directory, 'workspace'), { writeRepos, activateRuntime: writeRepos.length > 0, checks, includePlan: false, task: taskId });
      const base: Omit<DelegationSpec, 'fingerprint'> = { schema: 1, id: taskId, parent: this.workspace.root, task: input.task, entry: input.source.entry, goal: redact(input.goal, this.workspace.secrets), target: input.target,
        createdAt: new Date().toISOString(), package: packaged.directory, packageHash: hash(JSON.stringify(packaged.manifest)), workspace: restored.workspace.root, handoff: restored.handoff, writeRepos, checks, timeoutMs,
        maxRequests: input.target === 'pi' ? input.maxRequests ?? 24 : undefined, provider: input.provider, model: input.model, agentDir: input.agentDir, inheritedRequests: input.source.requests ?? 0 };
      const spec: DelegationSpec = { ...base, fingerprint: hash(JSON.stringify(base)) }; await writeJson(join(directory, 'input.json'), spec);
      const worker = fileURLToPath(new URL('./delegation-worker.js', import.meta.url)); await access(worker);
      const boundary=await isolatedWorkerBoundary(restored.workspace.root,restored.workspace.config.repos);
      const environment=boundary?await withProcessBoundary(boundary,async()=>workerEnvironment(process.env)):workerEnvironment(process.env);
      const log = await open(join(directory, 'worker.log'), 'a', 0o600);
      let child: ReturnType<typeof spawn> | undefined;
      try { const launched = spawn(process.execPath, [worker, join(directory, 'input.json')], { cwd: restored.workspace.root, detached: true, stdio: ['ignore', log.fd, log.fd], env: environment }); child = launched; await new Promise<void>((resolve, reject) => { launched.once('spawn', resolve); launched.once('error', reject); }); launched.unref(); }
      finally { await log.close(); }
      if (!child) throw new Error('Delegation worker was not dispatched');
      await writeJson(join(directory, 'owner.json'), { pid: child.pid, identity: child.pid ? (await processIdentity(child.pid)).identity : undefined, fingerprint: spec.fingerprint });
      await writeJson(join(directory, 'preparation.json'), { status: 'dispatched', task: input.task });
      return await this.status(taskId, input.task);
    } catch (error) { await writeJson(join(directory, 'preparation.json'), { status: 'failed', error: redact(String(error), this.workspace.secrets), task: input.task }); throw error; }
  }
  async status(taskId: string, task?: string) {
    const directory = await this.directory(taskId), spec = await readJson<DelegationSpec>(join(directory, 'input.json')), { fingerprint, ...base } = spec;
    if (spec.schema !== 1 || spec.id !== taskId || spec.parent !== this.workspace.root || hash(JSON.stringify(base)) !== fingerprint || task !== undefined && spec.task !== task) throw new Error('Invalid delegation identity or task ownership');
    if (await realpath(spec.workspace) !== join(directory, 'workspace')) throw new Error('Delegation workspace moved or escaped its origin');
    let state: DelegationState;
    try { state = await readJson<DelegationState>(join(directory, 'state.json')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const owner = await readJson<{ pid: number; identity?: string }>(join(directory, 'owner.json'));
      state = { schema: 1, id: spec.id, fingerprint: spec.fingerprint, status: 'starting', workerPid: owner.pid, workerIdentity: owner.identity, updatedAt: spec.createdAt, requests: 0, tools: 0 };
    }
    if (state.schema !== 1 || state.id !== spec.id || state.fingerprint !== spec.fingerprint || !['starting', 'running', 'completed', 'failed', 'cancelled', 'timeout', 'budget', 'unknown'].includes(state.status)) throw new Error('Invalid delegation receipt');
    const worker = await processIdentity(state.workerPid);
    if (['starting', 'running'].includes(state.status)) try { state = await readJson<DelegationState>(join(directory, 'state.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (state.schema !== 1 || state.id !== spec.id || state.fingerprint !== spec.fingerprint || !['starting', 'running', 'completed', 'failed', 'cancelled', 'timeout', 'budget', 'unknown'].includes(state.status)) throw new Error('Delegation receipt changed identity during observation');
    const active = ['starting', 'running'].includes(state.status), matching = worker.state === 'alive' && !!state.workerIdentity && worker.identity === state.workerIdentity;
    const stopped = worker.state === 'gone' || worker.state === 'alive' && !!state.workerIdentity && !!worker.identity && worker.identity !== state.workerIdentity;
    let diagnostic: string | undefined;
    if (stopped && active) try { diagnostic = redact((await readFile(join(directory, 'worker.log'), 'utf8')).slice(-8000), this.workspace.secrets); } catch { /* Missing diagnostics never prove completion. */ }
    return { spec, state, status: active && !matching ? 'unknown' : state.status, terminal: !active || stopped, worker, diagnostic,
      observationFresh: Date.now() - Date.parse(state.updatedAt) < 10000, note: 'A completed child is a source result, not parent acceptance. Its request accounting and permissions are separate; source costs remain retained.' };
  }
  async list(task?: string) {
    let names: string[]; try { names = await readdir(join(this.workspace.data, 'delegations')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const results = [];
    for (const name of names.slice(-200)) try { const result = await this.status(name); if (task === undefined || result.spec.task === task) results.push(result); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return results;
  }
  async wait(taskId: string, options: { task?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000)) throw new Error('Delegation observation wait must be 1–60,000 ms');
    const deadline = Date.now() + (options.timeoutMs ?? 5000);
    while (Date.now() < deadline) { options.signal?.throwIfAborted(); const result = await this.status(taskId, options.task); if (result.terminal) return result; await delay(100); }
    return await this.status(taskId, options.task);
  }
  async cancel(taskId: string, task?: string) {
    const result = await this.status(taskId, task);
    if (!result.terminal) await writeJson(join(await this.directory(taskId), 'control.json'), { id: taskId, fingerprint: result.spec.fingerprint, action: 'cancel' });
    return await this.wait(taskId, { task, timeoutMs: 8000 });
  }
  async drain(taskId: string, options: { task?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
    const timeoutMs = options.timeoutMs ?? 10000; if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Child teardown wait must be 1–60,000 ms');
    const deadline = Date.now() + timeoutMs;
    while (true) {
      options.signal?.throwIfAborted(); const result = await this.status(taskId, options.task);
      const gone = result.worker.state === 'gone' || result.worker.state === 'alive' && !!result.state.workerIdentity && !!result.worker.identity && result.worker.identity !== result.state.workerIdentity;
      if (gone || Date.now() >= deadline) return { ...result, drained: gone, note: 'A child terminal receipt and its worker exit are separate. This wait never restarts or kills an unidentified process.' };
      await delay(100);
    }
  }
  async preview(taskId: string, task?: string, options: { planFile?: string } = {}): Promise<MergePreview> {
    const result = await this.status(taskId, task);
    if (!result.terminal || result.state.status !== 'completed') throw new Error('Merge requires a completed child with settled execution');
    const source = await TaskPackages.inspect(result.spec.package); if (hash(JSON.stringify(source.manifest)) !== result.spec.packageHash) throw new Error('Delegation baseline package changed');
    const child = await Workspace.open(result.spec.workspace);
    if (child.config.repos.some(repo => { const path = relative(join(child.root, 'repos'), repo.root); return isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`); })) throw new Error('Child repository registration escaped its isolated workspace');
    if ((await child.operations()).some(op => ['unknown', 'pending'].includes(op.status)) || (await new BackgroundRuns(child).unresolved()).length) throw new Error('Child effects remain unresolved');
    return await this.workspace.exclusive(async () => {
      const childSnapshot = await child.exclusive(() => child.checkpoint('merge proposal')), observed = await child.observe();
      const plan = await new PlanStore(this.workspace, options.planFile).current();
      const expected = await this.workspace.checkpoint('before child merge', { plan: plan ? { id: plan.id, revision: plan.revision } : null }), proposed: Checkpoint = structuredClone(expected); proposed.id = id('checkpoint'); proposed.label = `merge:${taskId}`; proposed.references = [];proposed.purpose='integration-proposal';
      const preview: MergePreview = { schema: 1, id: id('merge'), delegation: taskId, spec: result.spec.fingerprint, expected: expected.id, proposed: proposed.id, child: observed,
        changes: [], conflicts: [], applyAllowed: false, createdAt: new Date().toISOString(),criteriaHash:hash(JSON.stringify(this.workspace.config.checks)) };
      const directory = await ensureDir(join(await ensureDir(join(this.workspace.data, 'merge-previews')), preview.id));
      for (const repo of source.manifest.repos) {
        const target = proposed.repos.find(item => item.repo.id === repo.repo.id), other = childSnapshot.repos.find(item => item.repo.id === repo.repo.id);
        if (!target || !other) throw new Error('Repository set changed before merge');
        for (const file of new Set([...Object.keys(repo.files), ...Object.keys(other.files)])) {
          const original = repo.files[file], theirs = other.files[file], ours = target.files[file]; if (same(original, theirs)) continue;
          const change: MergePreview['changes'][number] = { repo: repo.repo.id, file, state: 'apply' }; preview.changes.push(change);
          if (!result.spec.writeRepos.includes(repo.repo.id) || this.workspace.repo(repo.repo.id).access !== 'write') { change.state = 'conflict'; change.reason = 'Change is outside current write grants'; }
          else if (same(ours, theirs)) change.state = 'already-present';
          else if (same(ours, original)) {
            if (!theirs) delete target.files[file]; else { const bytes = await readFile(join(child.data, 'blobs', theirs.hash)); if (hash(bytes) !== theirs.hash) throw new Error('Child snapshot blob is corrupt'); await this.storeBlob(bytes); target.files[file] = theirs; }
          } else if (original && ours && theirs && original.mode === ours.mode && original.mode === theirs.mode) {
            const oursBytes = await readFile(join(this.workspace.data, 'blobs', ours.hash)), baseBytes = await source.blob(original.hash), theirsBytes = await readFile(join(child.data, 'blobs', theirs.hash));
            try { for (const bytes of [oursBytes, baseBytes, theirsBytes]) new TextDecoder('utf-8', { fatal: true }).decode(bytes); if ([oursBytes, baseBytes, theirsBytes].some(bytes => bytes.includes(0))) throw new Error('Binary conflict'); }
            catch { change.state = 'conflict'; change.reason = 'Overlapping binary or encoding change'; }
            if (change.state !== 'conflict') {
              for (const [name, bytes] of [['ours', oursBytes], ['base', baseBytes], ['theirs', theirsBytes]] as const) await writeFile(join(directory, name), bytes, { mode: 0o600 });
              const merged = await runProcess(['git', 'merge-file', '-p', join(directory, 'ours'), join(directory, 'base'), join(directory, 'theirs')], this.workspace.root, { limit: 8000000, timeoutMs: 30000 });
              if (merged.status !== 'passed' || merged.truncated) { change.state = 'conflict'; change.reason = 'Overlapping edits need review'; change.patch = redact(merged.output, this.workspace.secrets).slice(0, 12000); }
              else { const bytes = Buffer.from(merged.output); await this.storeBlob(bytes); target.files[file] = { hash: hash(bytes), mode: ours.mode }; change.state = 'merged'; }
            }
          } else { change.state = 'conflict'; change.reason = 'Parent edited, removed, or changed permissions on this file'; }
          if (change.state === 'conflict') preview.conflicts.push(`${change.repo}:${file}: ${change.reason}`);
          else if (change.state !== 'already-present') {
            const proposedFile = target.files[file];
            const blob = async (fingerprint: typeof ours) => {
              if (!fingerprint) return Buffer.alloc(0);
              const bytes = await readFile(join(this.workspace.data, 'blobs', fingerprint.hash));
              if (hash(bytes) !== fingerprint.hash) throw new Error('Merge preview blob integrity mismatch');
              return bytes;
            };
            const [before, after] = await Promise.all([blob(ours), blob(proposedFile)]);
            if (before.length + after.length > 1_000_000) change.reason = '文件较大，请在独立工作目录核对完整内容。';
            else try {
              const decoder = new TextDecoder('utf-8', { fatal: true });
              if (before.includes(0) || after.includes(0)) throw new Error('Binary file');
              const patch = redact(createTwoFilesPatch(`${repo.repo.id}/${file}`, `${repo.repo.id}/${file}`, decoder.decode(before), decoder.decode(after)), this.workspace.secrets);
              change.patch = patch.slice(0, 48_000); change.patchTruncated = patch.length > 48_000;
              if (ours?.mode !== proposedFile?.mode && ours && proposedFile) change.reason = `文件权限：${ours.mode.toString(8)} → ${proposedFile.mode.toString(8)}`;
            } catch (error) {
              if (error instanceof TypeError || (error as Error).message === 'Binary file') change.reason = '二进制文件或非 UTF-8 内容，请在独立工作目录核对。';
              else throw error;
            }
          }
        }
      }
      if (!same(observed.fingerprints, (await child.observe()).fingerprints)) throw new Error('Child changed during merge preview');
      preview.applyAllowed = !preview.conflicts.length;
      await writeJson(join(this.workspace.data, 'checkpoints', `${proposed.id}.json`), proposed); await writeJson(join(directory, 'preview.json'), preview); return preview;
    });
  }
  private async storeBlob(bytes: Buffer) {
    const key = hash(bytes), path = join(this.workspace.data, 'blobs', key);
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    if (hash(await readFile(path)) !== key) throw new Error('Merge blob integrity mismatch');
  }
  async merge(previewId: string, options: { task?: string; signal?: AbortSignal; planFile?: string } = {}) {
    const path = join(this.workspace.data, 'merge-previews', safeId(previewId), 'preview.json'), preview = await readJson<MergePreview>(path), result = await this.status(preview.delegation, options.task);
    if (preview.schema !== 1 || preview.id !== previewId || !preview.applyAllowed || result.spec.fingerprint !== preview.spec || result.state.status !== 'completed' || !result.terminal) throw new Error('Merge preview is conflicting, stale or no longer owned');
    const child = await Workspace.open(result.spec.workspace);
    return await this.workspace.exclusive(()=>child.exclusive(async () => {
      if(!same(preview.child.fingerprints,(await child.observe()).fingerprints)||(await child.operations()).some(op=>['pending','unknown'].includes(op.status))||(await new BackgroundRuns(child).unresolved()).length)throw new Error('Child changed or has unresolved effects after preview');
      if(preview.criteriaHash!==hash(JSON.stringify(this.workspace.config.checks)))throw new Error('Acceptance changed or old preview lacks criteria; generate a new preview before merge');
      options.signal?.throwIfAborted(); await this.workspace.restore(preview.proposed, preview.expected, { planFile: options.planFile });
      const verified = await this.workspace.verify(options.signal);
      const receipt = { schema: 1, id: id('merge-result'), preview: preview.id, delegation: result.spec.id, task: options.task, createdAt: new Date().toISOString(), verification: verified, observation: await this.workspace.observe(), note: 'Applied code only. Child/source historical evidence and runtime permissions were not imported as parent success.' };
      await writeJson(join(this.workspace.data, 'merge-previews', preview.id, 'result.json'), receipt); return receipt;
    }));
  }
}
