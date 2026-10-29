import { workerEnvironment } from './execution-boundary.js';
import { spawn } from 'node:child_process';
import { readdir,writeFile } from 'node:fs/promises';
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

export async function evaluateWait(workspace: Workspace, condition: WaitCondition, signal?:AbortSignal): Promise<{ done: boolean; failed?: boolean; result: unknown }> {
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
    const unknown = service.status === 'unknown' && service.executionTerminal===true;
    if(condition.state==='stopped')return {done:unknown||service.status==='not-started'||service.executionTerminal===true,failed:unknown,result:service};
    const failed = ['failed', 'cancelled', 'timeout', 'passed', 'configuration-changed', 'dependency-changed', 'source-changed','readiness-timeout'].includes(service.status) || unknown;
    return { done: failed || service.ready, failed, result: service };
  }
  const response = await runProcess(['gh', 'api', `repos/${condition.repo}/actions/runs/${condition.run}`], workspace.root, { timeoutMs: 15000, limit: 64000,signal });
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
    const owner=child.pid?await processIdentity(child.pid):undefined;
    await writeJson(join(directory,'owner.json'),{pid:child.pid,identity:owner?.identity,fingerprint:spec.fingerprint});
    return spec;
  }
  async status(watch: string, task?: string) {
    const directory = await this.directory(watch), spec = await readJson<WaitSpec>(join(directory, 'input.json'));
    const { fingerprint, ...base } = spec;
    if (spec.schema !== 1 || spec.id !== watch || spec.root !== this.workspace.root || hash(JSON.stringify(base)) !== fingerprint) throw new Error('Invalid wait specification');
    if (task && spec.task !== task) throw new Error('Wait belongs to another task');
    let state: WaitState;
    try { state = await readJson<WaitState>(join(directory, 'state.json')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const owner=await readJson<{pid:number;identity?:string;fingerprint:string}>(join(directory,'owner.json')).catch(()=>null);
      state={schema:1,id:watch,status:'waiting',workerPid:owner?.fingerprint===fingerprint?owner.pid:0,workerIdentity:owner?.fingerprint===fingerprint?owner.identity:undefined,updatedAt:spec.createdAt,polls:0};
    }
    const validState=(value:WaitState)=>value.schema===1&&value.id===watch&&['waiting','completed','failed','cancelled','timeout'].includes(value.status)&&Number.isSafeInteger(value.workerPid)&&value.workerPid>=0&&Number.isFinite(Date.parse(value.updatedAt))&&Number.isSafeInteger(value.polls)&&value.polls>=0;
    if(!validState(state))throw new Error('Invalid wait observation');
    const worker = await processIdentity(state.workerPid);
    if(state.status==='waiting')try{state=await readJson<WaitState>(join(directory,'state.json'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(!validState(state))throw new Error('Invalid wait observation');
    const workerCurrent=worker.state==='alive'&&!!state.workerIdentity&&state.workerIdentity===worker.identity;
    const workerStopped=worker.state==='gone'||worker.state==='alive'&&!!worker.identity&&!!state.workerIdentity&&worker.identity!==state.workerIdentity;
    return { spec, state, worker, workerCurrent, runtimeState:state.status!=='waiting'?'settled':workerStopped?'interrupted':workerCurrent?'active':'unknown', observationFresh: Date.now() - Date.parse(state.updatedAt) < Math.max(spec.pollMs * 3, 20000) };
  }
  async list(task?: string) {
    const directory = await ensureDir(join(this.workspace.data, 'waits')), results = [];
    for (const watch of await readdir(directory)) try { const value = await this.status(watch, task); results.push(value); } catch (error) { if (!String(error).includes('another task') && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return results;
  }
  async cancel(watch: string, task?: string) {
    let value = await this.status(watch, task);const directory=await this.directory(watch);
    await writeJson(join(directory, 'control.json'), { id: watch, fingerprint: value.spec.fingerprint, action: 'cancel' });
    if(value.state.status!=='waiting')return value;
    if(value.runtimeState==='interrupted'){await this.finishCancelled(value.spec,value.state);return this.status(watch,task);}
    if(value.workerCurrent)try{process.kill(value.state.workerPid,'SIGTERM');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    const until=Date.now()+5000;
    while(Date.now()<until){await new Promise(resolve=>setTimeout(resolve,50));value=await this.status(watch,task);if(value.state.status!=='waiting')return value;if(value.runtimeState==='interrupted'){await this.finishCancelled(value.spec,value.state);return this.status(watch,task);}}
    return {...value,cancelRequested:true,note:'已请求停止等待，尚未确认等待器结束。目标命令或服务不会被取消。'};
  }
  private async finishCancelled(spec:WaitSpec,state:WaitState){
    const now=new Date().toISOString(),result={error:'等待器已退出，取消剩余等待；目标任务结果未被改写。'};
    await writeJson(join(await this.directory(spec.id),'state.json'),{...state,status:'cancelled',updatedAt:now,lastError:result.error});
    const event:TaskEvent={schema:1,id:`event-${spec.id}`,watch:spec.id,task:spec.task,entry:spec.entry,label:spec.label,outcome:'cancelled',result,createdAt:now,observation:spec.observation,resume:false};
    await writeFile(join(await ensureDir(join(this.workspace.data,'events')),`${event.id}.json`),JSON.stringify(event),{flag:'wx',mode:0o600}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});
  }
  async cancelled(watch:string){const directory=await this.directory(watch),spec=await readJson<WaitSpec>(join(directory,'input.json'));try{const control=await readJson<{id:string;action:string;fingerprint:string}>(join(directory,'control.json'));return control.id===watch&&control.action==='cancel'&&control.fingerprint===spec.fingerprint;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
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
