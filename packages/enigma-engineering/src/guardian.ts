import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, ensureDir, safeId } from './storage.js';

export interface GuardianConfig {
  mode: 'observe' | 'assist' | 'managed';
  stageDeadlineMs: number; maxInterventions: number;
  allowedActions: ('notify' | 'cancel-and-resume' | 'refresh-observer' | 'propose-repair')[];
}
export interface GuardianStatus {
  phase: 'watching' | 'diagnosing' | 'intervening' | 'waiting-user' | 'host-unavailable' | 'stopped';
  updatedAt: string; pid?: number; interventions: number; events: { at: string; text: string; action?: string }[];
  diagnosis?: { answer: string; action: string; basis: string; usedModel: boolean };
}

export function guardianConcern(status: any, deadline: number): { kind: string; reason: string } | null {
  if (!status?.available) return { kind: 'observation', reason: '运行观测不可用，需要核对采集或宿主连接' };
  if (status.sourceProcess?.liveness === 'dead') return { kind: 'process', reason: '来源进程已退出，旧状态不能证明任务仍在运行' };
  const waiting = status.stages?.find((stage: any) => stage.stage === 'approval');
  if (waiting?.elapsedMs > deadline) return { kind: 'approval', reason: '任务正在等待用户审批' };
  const repeated = status.signals?.find((signal: any) => signal.count >= 3);
  if (repeated) return { kind: 'repetition', reason: `连续出现重复行为：${repeated.detail || repeated.type}` };
  const overdue = status.stages?.find((stage: any) => !['run','context','approval'].includes(stage.stage) && stage.elapsedMs > deadline);
  if (overdue) return { kind: overdue.stage, reason: `${overdue.label || overdue.stage} 已持续较长时间；需要区分正常长任务与异常，不能仅凭超时回滚` };
  return null;
}

/** The monitor owns an independent process. Secrets are passed once through stdin, never its argv or files. */
export class GuardianProcess {
  private child?: ChildProcess;
  constructor(readonly workspaceRoot: string, readonly session: string) { safeId(session); }
  private async directory() { return ensureDir(join(this.workspaceRoot,'.enigma-next','guardians',this.session)); }
  async start(config: GuardianConfig, connection: { origin: string; token: string; sessionPath: string }) {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) throw new Error('Guardian is already running');
    const url = new URL(connection.origin);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Guardian currently uses the local authenticated host');
    if (!['observe','assist','managed'].includes(config.mode) || !Number.isFinite(config.stageDeadlineMs) || config.stageDeadlineMs < 1000
      || !Number.isInteger(config.maxInterventions) || config.maxInterventions < 0 || config.maxInterventions > 10) throw new Error('Invalid guardian configuration');
    if(!Array.isArray(config.allowedActions)||config.allowedActions.some(action=>!['notify','cancel-and-resume','refresh-observer','propose-repair'].includes(action)))throw new Error('Invalid guardian actions');
    const directory=await this.directory();
    await writeJson(join(directory,'config.json'),config);
    await writeJson(join(directory,'control.json'),{action:'run'});
    const worker=fileURLToPath(new URL('./guardian-worker.js',import.meta.url));
    const child=spawn(process.execPath,[worker,directory],{cwd:this.workspaceRoot,stdio:['pipe','ignore','pipe']});this.child=child;
    child.stdin!.end(JSON.stringify({...connection,workspace:this.workspaceRoot,session:this.session}));
    let errors='';child.stderr!.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
    child.on('error',()=>{});
    child.on('exit',()=>{if(errors)void writeJson(join(directory,'last-error.json'),{error:errors});});
    return {started:true,pid:child.pid,mode:config.mode};
  }
  async status():Promise<GuardianStatus|null>{try{return await readJson(join(await this.directory(),'status.json'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  async stop(){const directory=await this.directory();await writeJson(join(directory,'control.json'),{action:'stop'});const child=this.child;if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise<void>(resolve=>{child.once('exit',()=>resolve());setTimeout(()=>{child.kill('SIGKILL');resolve();},2000).unref();});}
    const state=await this.status();if(state)await writeJson(join(directory,'status.json'),{...state,phase:'stopped',updatedAt:new Date().toISOString()});this.child=undefined;return {stopped:true};}
}
