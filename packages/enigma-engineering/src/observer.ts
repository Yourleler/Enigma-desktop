import { appendFile, lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ensureDir, readJson, redact, safeId, writeJson } from './storage.js';
import type { ActivityEvent } from './telemetry.js';

const exec = promisify(execFile);
const maxEvents = 120, maxPending = 300, maxStageTypes = 80;
export interface ObservedEvent extends ActivityEvent { seq: number; at: string }
interface ActiveStage { id: string; stage: string; startedAt: string; parent?: string; repo?: string; detail?: string; pid?: number; lastOutputAt?: string }
export interface ObserverSnapshot {
  schema: 1; id: string; session: string; sessionFile?: string; root: string; pid: number; processIdentity?: string;
  run?: string; state: 'idle' | 'running' | 'settling' | 'completed' | 'aborted' | 'error' | 'closed';
  startedAt: string; observedAt: string; activityAt: string; seq: number;
  active: ActiveStage[]; recent: ObservedEvent[];
  lastProgress?: { at: string; stage: string; reference: string; detail?: string };
  signals: { type: 'repeated-reading' | 'repeated-error'; count: number; at: string; reference?: string; detail: string }[];
  timings: Record<string, { count: number; totalMs: number; maxMs: number }>;
  streamedEvents: number; mirrorLoss: number; collection: { flushes: number; writeMs: number; failed: boolean };
}

export async function processIdentity(pid: number): Promise<{ state: 'alive' | 'gone' | 'unknown'; identity?: string }> {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: 'unknown' };
  try { process.kill(pid, 0); }
  catch (error) { return { state: (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unknown' }; }
  try {
    // Inspect OS-owned start identity rather than treating a stale pid file as proof.
    const result = process.platform === 'win32'
      ? await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], { timeout: 2500, maxBuffer: 4096 })
      : await exec('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2500, maxBuffer: 4096, env: { ...process.env, LC_ALL: 'C' } });
    const identity = result.stdout.trim();
    return { state: 'alive', identity: identity || undefined };
  } catch { return { state: 'alive' }; }
}

/** Bounded, best-effort mirror. The writer never owns the workspace operation lock. */
export class RunObserver {
  private static active = new Map<string,RunObserver>();
  private registrations: string[] = [];
  /** Native UI adapters use a separate Workspace instance from Pi extensions.
   * Deliver to the session's existing observer instead of creating a rival stream. */
  static recordForSession(root:string,session:string,event:ActivityEvent) {
    RunObserver.active.get(JSON.stringify([resolve(root),session]))?.record(event);
  }
  readonly state: ObserverSnapshot;
  readonly directory: string;
  private pending: ObservedEvent[] = [];
  private chain = Promise.resolve();
  private interval?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private flushing = false;
  private flushRequested = false;
  private reads = new Map<string, number>();
  private errors = new Map<string, number>();
  private references = new Set<string>();
  private constructor(root: string, session: string, sessionFile: string | undefined, readonly secrets: string[], identity?: string) {
    const now = new Date().toISOString(), id = randomUUID();
    this.directory = join(root, '.enigma-next', 'observations', id);
    this.state = { schema: 1, id, root, session, sessionFile, pid: process.pid, processIdentity: identity,
      state: 'idle', startedAt: now, observedAt: now, activityAt: now, seq: 0, active: [], recent: [], signals: [],
      timings: Object.create(null), streamedEvents: 0, mirrorLoss: 0, collection: { flushes: 0, writeMs: 0, failed: false } };
  }
  static async create(root: string, session: string, options: { sessionFile?: string; secrets?: string[]; heartbeatMs?: number } = {}): Promise<RunObserver> {
    const canonical = await realpath(root); safeId(session);
    await ensureDir(join(canonical, '.enigma-next')); await ensureDir(join(canonical, '.enigma-next', 'observations'));
    const process = await processIdentity(globalThis.process.pid);
    const observer = new RunObserver(canonical, session, options.sessionFile, options.secrets ?? [], process.identity);
    await mkdir(observer.directory, { mode: 0o700 });
    await observer.flush();
    observer.registrations=[...new Set([canonical,resolve(root)])].map(directory=>JSON.stringify([directory,session]));
    for(const key of observer.registrations)RunObserver.active.set(key,observer);
    observer.interval = setInterval(() => { void observer.flush(); }, options.heartbeatMs ?? 1000); observer.interval.unref();
    return observer;
  }
  record(event: ActivityEvent): void {
    if (this.stopped || this.state.collection.failed) return;
    try {
      const at = new Date().toISOString();
      // Explicit fields keep raw provider data, commands, prompts and outputs out of the mirror.
      const observed: ObservedEvent = { kind: event.kind, stage: event.stage.slice(0, 100), seq: ++this.state.seq, at,
        id: event.id?.slice(0, 160), parent: event.parent?.slice(0, 160), repo: event.repo?.slice(0, 100),
        detail: event.detail ? redact(event.detail, this.secrets).slice(0, 800) : undefined, reference: event.reference ? redact(event.reference, this.secrets).slice(0, 500) : undefined,
        fingerprint: event.fingerprint ? redact(event.fingerprint, this.secrets).slice(0, 500) : undefined, status: event.status?.slice(0, 80), pid: event.pid, count: event.count,
        durationMs: Number.isFinite(event.durationMs) ? event.durationMs : undefined };
      this.state.activityAt = at;
      if (event.stage === 'run' && event.kind === 'start') {
        this.state.run = event.id; this.state.state = 'running'; this.state.signals = []; this.state.lastProgress = undefined; this.reads.clear(); this.errors.clear(); this.references.clear();
      }
      if (event.stage === 'settling' && event.kind === 'start') this.state.state = 'settling';
      if (event.kind === 'start' && ['model', 'model.stream', 'tool', 'context'].includes(event.stage)) this.state.state = 'running';
      if (event.stage === 'run' && event.kind === 'end') {
        this.state.state = event.status === 'aborted' ? 'aborted' : event.status === 'error' ? 'error' : 'completed';
        this.state.active = [];
      }
      const eventId = observed.id ?? observed.stage;
      if (event.kind === 'start') {
        this.state.active = this.state.active.filter(stage => stage.id !== eventId);
        if (this.state.active.length < 100) this.state.active.push({ id: eventId, stage: observed.stage, startedAt: at, parent: observed.parent, repo: observed.repo, detail: observed.detail, pid: observed.pid });
        else this.state.mirrorLoss++;
      } else if (event.kind === 'end') {
        this.state.active = this.state.active.filter(stage => stage.id !== eventId);
        if (observed.durationMs !== undefined && observed.durationMs >= 0) {
          if (this.state.timings[observed.stage] || Object.keys(this.state.timings).length < maxStageTypes) {
            const stats = this.state.timings[observed.stage] ??= { count: 0, totalMs: 0, maxMs: 0 };
            stats.count++; stats.totalMs += observed.durationMs; stats.maxMs = Math.max(stats.maxMs, observed.durationMs);
          }
        }
      } else if (event.kind === 'update') {
        const active = this.state.active.find(stage => stage.id === eventId);
        if (active) { if ((event.count ?? 1) > 0) active.lastOutputAt = at; active.pid ??= event.pid; }
        this.state.streamedEvents++;
      }
      if (event.kind === 'fact' && event.reference) {
        const key = `${event.stage}:${event.reference}:${event.fingerprint ?? ''}`;
        const fresh = !this.references.has(key); this.references.add(key);
        if (this.references.size > 500) this.references.delete(this.references.values().next().value!);
        if (fresh && ['source.read', 'source.changed', 'check.passed', 'plan.advanced'].includes(event.stage)) this.state.lastProgress = { at, stage: event.stage, reference: observed.reference!, detail: observed.detail };
        if (event.stage === 'source.read') {
          const count = (this.reads.get(key) ?? 0) + 1; this.reads.set(key, count);
          if (this.reads.size > 500) this.reads.delete(this.reads.keys().next().value!);
          if (count >= 3) this.signal('repeated-reading', key, count, at, observed.reference, 'Repeatedly read the same source version; relevance or progress is not established.');
        }
      }
      if (event.kind === 'fact' && event.stage === 'tool.failed') {
        const key = event.fingerprint ?? event.reference ?? event.detail ?? event.stage;
        const count = (this.errors.get(key) ?? 0) + 1; this.errors.set(key, count);
        if (this.errors.size > 200) this.errors.delete(this.errors.keys().next().value!);
        if (count >= 3) this.signal('repeated-error', key, count, at, observed.reference, 'Repeated tool failure with the same error signature; inspect the cause before retrying.');
      }
      this.state.recent.push(observed); if (this.state.recent.length > maxEvents) this.state.recent.shift();
      if (this.pending.length < maxPending) this.pending.push(observed); else this.state.mirrorLoss++;
      if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 150); this.timer.unref(); }
    } catch { this.state.mirrorLoss++; }
  }
  private signal(type: ObserverSnapshot['signals'][number]['type'], key: string, count: number, at: string, reference: string | undefined, detail: string) {
    const existing = this.state.signals.find(signal => signal.type === type && signal.reference === (reference ?? key));
    if (existing) { existing.count = count; existing.at = at; }
    else this.state.signals.push({ type, count, at, reference: reference ?? key, detail });
    if (this.state.signals.length > 12) this.state.signals.shift();
  }
  flush(): Promise<void> {
    this.flushRequested = true;
    if (this.flushing) return this.chain;
    this.flushing = true;
    this.chain = this.chain.then(async () => {
      do {
        this.flushRequested = false;
        if (this.state.collection.failed) return;
        const started = performance.now();
        const pending = this.pending.splice(0);
        try {
          const journal = join(this.directory, 'events.jsonl');
          try { if ((await lstat(journal)).size > 1_000_000) { await rm(`${journal}.previous`, { force: true }); await rename(journal, `${journal}.previous`); } }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if (pending.length) await appendFile(journal, pending.map(event => JSON.stringify(event)).join('\n') + '\n', { mode: 0o600 });
          this.state.observedAt = new Date().toISOString(); this.state.collection.flushes++;
          await writeJson(join(this.directory, 'status.json'), this.state);
          this.state.collection.writeMs += performance.now() - started;
        } catch { this.state.collection.failed = true; this.state.mirrorLoss += pending.length; }
      } while (this.flushRequested);
    }).finally(() => { this.flushing = false; });
    return this.chain;
  }
  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true; if (this.interval) clearInterval(this.interval); if (this.timer) clearTimeout(this.timer);
    for(const key of this.registrations)if(RunObserver.active.get(key)===this)RunObserver.active.delete(key);
    this.state.state = 'closed'; await this.flush();
  }
}

const labels: Record<string, string> = {
  'context': '准备上下文', 'model': '等待模型可见响应', 'model.stream': '接收模型响应', 'tool': '执行工具',
  'process': '运行命令', 'approval': '等待用户确认', 'snapshot': '采集代码快照', 'fingerprints': '核对代码版本',
  'verification': '执行验收', 'settling': '整理与收尾', 'reading': '分析源码', 'workspace.operation': '工作区操作', 'compaction': '压缩会话',
  'reading.capture':'冻结变更版本','reading.analyze':'分析源码关系','reading.explain':'生成源码讲解','workbench':'执行工作台操作',
};

export async function readObserverStatus(root: string, selectedId?: string, sourceSession?: string) {
  // Read-only: do not call Workspace.open or create/acquire any runtime lock.
  const canonical = await realpath(root), base = join(canonical, '.enigma-next', 'observations');
  for (const path of [join(canonical, '.enigma-next'), base]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Observation directory cannot be a symbolic link'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false as const, reason: 'No observer data; enable the observer plugin for the source session.' }; throw error; }
  }
  const ids = selectedId ? [safeId(selectedId)] : (await readdir(base)).filter(id => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(id)).slice(-100);
  const snapshots: ObserverSnapshot[] = [];
  for (const id of ids) {
    const directory = join(base, id), path = join(directory, 'status.json');
    try {
      if ((await lstat(directory)).isSymbolicLink() || (await lstat(path)).isSymbolicLink()) throw new Error('Observation state cannot be a symbolic link');
      if ((await lstat(path)).size > 2_000_000) throw new Error('Observation state exceeds read budget');
      const snapshot = await readJson<ObserverSnapshot>(path);
      if (snapshot.schema !== 1 || snapshot.id !== id || typeof snapshot.root !== 'string' || resolve(snapshot.root) !== canonical
        || !Number.isSafeInteger(snapshot.pid) || snapshot.pid < 1 || !Number.isSafeInteger(snapshot.seq) || snapshot.seq < 0
        || !['idle', 'running', 'settling', 'completed', 'aborted', 'error', 'closed'].includes(snapshot.state)
        || ![snapshot.startedAt, snapshot.observedAt, snapshot.activityAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
        || !Array.isArray(snapshot.active) || snapshot.active.length > 100 || !snapshot.active.every(stage => typeof stage.id === 'string' && typeof stage.stage === 'string' && Number.isFinite(Date.parse(stage.startedAt)))
        || !Array.isArray(snapshot.recent) || snapshot.recent.length > maxEvents || !Array.isArray(snapshot.signals) || snapshot.signals.length > 12
        || !snapshot.timings || typeof snapshot.timings !== 'object' || !snapshot.collection || typeof snapshot.collection.failed !== 'boolean') throw new Error('Invalid observer snapshot');
      if (!sourceSession || snapshot.session === sourceSession) snapshots.push(snapshot);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !selectedId) continue; throw error; }
  }
  snapshots.sort((a, b) => b.activityAt.localeCompare(a.activityAt) || b.observedAt.localeCompare(a.observedAt));
  const snapshot = snapshots[0]; if (!snapshot) return { available: false as const, reason: 'No completed observer snapshot is available.' };
  const now = Date.now(), identity = await processIdentity(snapshot.pid);
  const liveness = identity.state === 'gone' ? 'terminated' : identity.state === 'alive' && snapshot.processIdentity && identity.identity !== snapshot.processIdentity ? 'pid-reused'
    : identity.state === 'alive' && !!snapshot.processIdentity && snapshot.processIdentity === identity.identity ? 'alive' : 'unknown';
  const heartbeatAgeMs = Math.max(0, now - Date.parse(snapshot.observedAt));
  const observation = liveness === 'terminated' || liveness === 'pid-reused' ? 'source-stopped' : heartbeatAgeMs > 5000 ? 'stale' : 'fresh';
  const stages = snapshot.active.map(stage => ({ ...stage, label: labels[stage.stage] ?? stage.stage, elapsedMs: Math.max(0, now - Date.parse(stage.startedAt)) }));
  const leafStages = stages.filter(stage => !stages.some(child => child.parent === stage.id));
  const primary = leafStages.at(-1);
  const stateLabel={idle:'空闲',running:'正在执行',settling:'正在收尾',completed:'已结束',aborted:'已停止',error:'执行失败',closed:'采集已关闭'}[snapshot.state];
  const explanations = [primary ? `${primary.label}${primary.repo ? `（${primary.repo}）` : ''}，持续 ${Math.round(primary.elapsedMs / 1000)} 秒。` : `会话状态：${stateLabel}。`];
  if (observation === 'stale') explanations.push('观测已停止更新；当前无法确认执行是否有进展，不能仅据此判断卡死。');
  if (observation === 'source-stopped') explanations.push('原观察进程已终止或 PID 已被复用；遗留活动阶段不代表任务仍在执行。');
  if (primary?.stage === 'model') explanations.push('等待模型的可见响应；没有服务端遥测，无法区分排队、内部计算或网络等待。');
  if (primary?.stage === 'process') explanations.push(primary.lastOutputAt ? '记录到命令输出活动，尚不等于任务验收通过。' : '尚无命令输出；静默计算不等于卡死。');
  if (snapshot.lastProgress) explanations.push(`最近的证据变化：${snapshot.lastProgress.stage} · ${snapshot.lastProgress.reference}。这不代表整个任务已完成。`);
  else explanations.push('尚未记录可回查的源码、修改或检查进展；流式输出与心跳只证明活动。');
  return { available: true as const, id: snapshot.id, session: snapshot.session, run: snapshot.run, state: snapshot.state, sourceProcess: { pid: snapshot.pid, liveness, exists: identity.state === 'alive' },
    observation, heartbeatAgeMs, activityAgeMs: Math.max(0, now - Date.parse(snapshot.activityAt)), stages, lastProgress: snapshot.lastProgress, signals: snapshot.signals,
    timings: snapshot.timings, collection: snapshot.collection, mirrorLoss: snapshot.mirrorLoss, recent: snapshot.recent, explanations,
    evidencePath: join(base, snapshot.id, 'status.json'), limitation: 'Activity and bounded mirror signals do not prove task completion or access hidden model reasoning. Stage times can overlap and must not be summed as total wall time.' };
}
