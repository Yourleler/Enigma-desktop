import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, ensureDir, safeId } from './storage.js';
import { processIdentity } from './observer.js';
import { randomUUID } from 'node:crypto';

export interface GuardianConfig {
  mode: 'observe' | 'assist' | 'managed';
  stageDeadlineMs: number; maxInterventions: number;
  allowedActions: ('notify' | 'cancel-and-resume' | 'refresh-observer' | 'propose-repair')[];
}
export interface GuardianStatus {
  phase: 'watching' | 'diagnosing' | 'intervening' | 'waiting-user' | 'host-unavailable' | 'stopped';
  updatedAt: string; pid?: number; interventions: number; events: { at: string; text: string; action?: string }[];
  instanceId?: string;
  processIdentity?: string;
  processState?: 'alive' | 'gone' | 'unknown' | 'changed';
  diagnosis?: { answer: string; action: string; basis: string; usedModel: boolean };
  pendingAction?: {requestId:string;action:string;reason:string;observationId?:string;run?:string};
}

export function currentInternalFailure(status:any){
  const recent=Array.isArray(status?.recent)?status.recent:[];
  const start=recent.findLastIndex((event:any)=>event.stage==='run'&&event.kind==='start');
  const phases=recent.slice(start+1).filter((event:any)=>['compaction','settling','model'].includes(event.stage)&&event.kind==='end');
  const latest=phases.at(-1);
  return latest?.status==='failed'?latest:null;
}

export function guardianConcern(status: any, deadline: number): { kind: string; reason: string } | null {
  if (!status?.available) return { kind: 'observation', reason: '运行观测不可用，需要核对采集或宿主连接' };
  if (['dead','gone','terminated','pid-reused'].includes(status.sourceProcess?.liveness)) return { kind: 'process', reason: '来源进程已退出或身份变化，旧状态不能证明任务仍在运行' };
  const failure=currentInternalFailure(status);
  if(failure&&(!status.stages?.length||['failed','error','aborted','closed'].includes(status.state)))return {kind:failure.stage,reason:`最近 ${failure.stage} 有明确失败记录，需要核对旧执行终态和保留的文件再决定恢复`};
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
  async start(config: GuardianConfig, connection: { origin: string; token: string; sessionPath: string; interventions?: number; restorePendingActions?:boolean }) {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) throw new Error('Guardian is already running');
    const url = new URL(connection.origin);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Guardian currently uses the local authenticated host');
    if (!['observe','assist','managed'].includes(config.mode) || !Number.isFinite(config.stageDeadlineMs) || config.stageDeadlineMs < 1000
      || !Number.isInteger(config.maxInterventions) || config.maxInterventions < 0 || config.maxInterventions > 10) throw new Error('Invalid guardian configuration');
    if(!Array.isArray(config.allowedActions)||config.allowedActions.some(action=>!['notify','cancel-and-resume','refresh-observer','propose-repair'].includes(action)))throw new Error('Invalid guardian actions');
    if(connection.interventions!==undefined&&(!Number.isInteger(connection.interventions)||connection.interventions<0||connection.interventions>10))throw new Error('Invalid prior guardian intervention count');
    const directory=await this.directory();
    // An orphan monitor may still hold the previous host's credentials in
    // memory. Stop it cooperatively before replacing its control/state files;
    // a PID by itself is never permission to signal an unrelated process.
    const previous=await this.status();
    if(previous?.pid&&previous.pid!==this.child?.pid&&previous.phase!=='stopped'){
      await writeJson(join(directory,'control.json'),{action:'stop'});
      const deadline=Date.now()+30000;let exited=false;
      while(Date.now()<deadline){const status=await this.status();if(status?.phase==='stopped'){exited=true;break;}try{process.kill(previous.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){exited=true;break;}throw error;}await new Promise(resolve=>setTimeout(resolve,100));}
      if(!exited)throw new Error('Previous guardian has not settled; no duplicate monitor was started');
    }
    await writeJson(join(directory,'config.json'),config);
    await writeJson(join(directory,'control.json'),{action:'run'});
    const worker=fileURLToPath(new URL('./guardian-worker.js',import.meta.url));
    const child=spawn(process.execPath,[worker,directory],{cwd:this.workspaceRoot,stdio:['pipe','ignore','pipe']});this.child=child;
    const instanceId=randomUUID();
    child.stdin!.on('error',()=>{});
    child.stdin!.end(JSON.stringify({...connection,workspace:this.workspaceRoot,session:this.session,instanceId}));
    let errors='';child.stderr!.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
    child.on('error',()=>{});
    child.on('exit',()=>{if(errors)void writeJson(join(directory,'last-error.json'),{error:errors});});
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      if(child.exitCode!==null||child.signalCode!==null)throw new Error(`Guardian exited before it became ready: ${errors || child.exitCode || child.signalCode}`);
      const status=await this.status();
      if(status?.instanceId===instanceId&&status.pid===child.pid)return {started:true,pid:child.pid,mode:config.mode};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    await this.stop();
    throw new Error('Guardian did not acknowledge startup before the deadline');
  }
  async status():Promise<GuardianStatus|null>{
    try{
      const state=await readJson<GuardianStatus>(join(await this.directory(),'status.json'));
      if(!state.pid||state.phase==='stopped')return state;
      const identity=await processIdentity(state.pid);
      const processState=identity.state==='alive'&&state.processIdentity&&identity.identity&&state.processIdentity!==identity.identity?'changed':identity.state;
      return {...state,processState,...(['gone','changed'].includes(processState)?{phase:'host-unavailable' as const}: {})};
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  async stop(){const directory=await this.directory();await writeJson(join(directory,'control.json'),{action:'stop'});const child=this.child;if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise<void>(resolve=>{const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');resolve();},2000);timer.unref();child.once('exit',()=>{clearTimeout(timer);resolve();});});}
    let state=await this.status();
    if(!child&&state?.pid&&state.phase!=='stopped'&&!['gone','changed'].includes(state.processState||'')){
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,100));state=await this.status();if(!state||state.phase==='stopped'||['gone','changed'].includes(state.processState||''))break;}
      if(state&&state.phase!=='stopped'&&!['gone','changed'].includes(state.processState||''))throw new Error('Previous guardian did not confirm shutdown; its state remains unresolved');
    }
    if(state)await writeJson(join(directory,'status.json'),{...state,phase:'stopped',updatedAt:new Date().toISOString()});this.child=undefined;return {stopped:true};}
}
