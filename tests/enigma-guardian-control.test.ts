import { afterEach,expect,it,vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace,RunObserver,readObserverStatus } from 'enigma-next';
import { EngineeringGuardian } from '../plugins/enigma/guardian-host.ts';
import { EngineeringMemory } from '../plugins/enigma/memory-host.ts';
const cleanup:(()=>Promise<any>)[]=[];
afterEach(async()=>{for(const close of cleanup.reverse())await close();cleanup.length=0;});
async function setup(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-guardian-control-'));cleanup.push(()=>fs.rm(root,{recursive:true,force:true}));
  const workspace=await Workspace.open(root),observer=await RunObserver.create(root,'main',{heartbeatMs:100});cleanup.push(()=>observer.close());
  observer.record({kind:'start',stage:'run',id:'run'});await observer.flush();
  const binding:any={root,guardianEnabled:true,guardian:{mode:'managed',allowedActions:['notify','cancel-and-resume','refresh-observer'],maxInterventions:1}};
  const native={isIdle:false,isCompacting:false,model:{provider:'test',id:'model'},sessionManager:{getSessionId:()=> 'main',getEntries:()=>[{id:'request',type:'message',message:{role:'user',content:'Original task'}}]},sendCustomMessage:vi.fn(async()=>{})};
  const engine={getSessionByPath:()=>native,abortSession:vi.fn(async()=>{native.isIdle=true;}),reloadSessionRuntime:vi.fn(),_utilityOptionsForContext:()=>({}),resolveUtilityConfigFresh:vi.fn(async()=>{throw new Error('offline fixture');})};
  const host={engine,binding:vi.fn(async()=>binding),saveBinding:vi.fn(async()=>{}),publish:vi.fn()};
  return {root,workspace,observer,binding,native,engine,guardian:new EngineeringGuardian(host)};
}
it('independent diagnosis remains available offline and never calls main-run controls',async()=>{
  const {guardian,engine,native}=await setup();const result=await guardian.diagnose('/owned/main.jsonl','现在是否在做有意义的事？');
  expect(result.usedModel).toBe(false);expect(result.basis.requirements[0].text).toBe('Original task');
  expect(engine.abortSession).not.toHaveBeenCalled();expect(native.sendCustomMessage).not.toHaveBeenCalled();
});
it('guardian rejects stale observation, approvals, and exhausted grants without aborting work',async()=>{
  const {guardian,observer,root,engine,binding}=await setup();
  await expect(guardian.act('/owned/main.jsonl',{action:'cancel-and-resume',reason:'slow',observationId:'stale'})).rejects.toThrow('Observation changed');
  observer.record({kind:'start',stage:'approval',id:'approval'});await observer.flush();const status=await readObserverStatus(root,undefined,'main');expect(status.available).toBe(true);
  await expect(guardian.act('/owned/main.jsonl',{action:'cancel-and-resume',reason:'approve it',observationId:(status as any).id,run:(status as any).run})).rejects.toThrow('cannot approve');
  binding.guardianInterventions=1;
  await expect(guardian.act('/owned/main.jsonl',{action:'notify',reason:'too many'})).rejects.toThrow('budget');expect(engine.abortSession).not.toHaveBeenCalled();
});
it('authorized cancellation waits for settled runtime and preserves original request and code',async()=>{
  const {guardian,root,engine,native,binding,observer}=await setup();await fs.writeFile(path.join(root,'USER.txt'),'Keep actual code');
  for(let i=0;i<3;i++)observer.record({kind:'fact',stage:'tool.failed',reference:'test',fingerprint:'same-error',detail:'same failure'});await observer.flush();
  const status=await readObserverStatus(root,undefined,'main');expect(status.available).toBe(true);
  await guardian.act('/owned/main.jsonl',{action:'cancel-and-resume',reason:'Observed repeated failure; re-read current files.',observationId:(status as any).id,run:(status as any).run});
  expect(engine.abortSession).toHaveBeenCalledTimes(1);expect(binding.guardianInterventions).toBe(1);
  expect(native.sendCustomMessage).toHaveBeenCalledWith(expect.objectContaining({customType:'enigma.guardian-recovery',content:expect.stringContaining('Original requirements')}),{triggerTurn:true});
  expect(await fs.readFile(path.join(root,'USER.txt'),'utf8')).toBe('Keep actual code');
});
it('a slow active task without established failures cannot be interrupted automatically',async()=>{
  const {guardian,root,engine}=await setup(),status=await readObserverStatus(root,undefined,'main');
  await expect(guardian.act('/owned/main.jsonl',{action:'cancel-and-resume',reason:'It is taking too long',observationId:(status as any).id,run:(status as any).run})).rejects.toThrow('elapsed time alone');expect(engine.abortSession).not.toHaveBeenCalled();
});
it('serialized guardian actions cannot spend the same remaining intervention twice',async()=>{
  const {guardian,binding,native}=await setup();
  const results=await Promise.allSettled([guardian.act('/owned/main.jsonl',{action:'notify',reason:'first observation'}),guardian.act('/owned/main.jsonl',{action:'notify',reason:'second observation'})]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(binding.guardianInterventions).toBe(1);expect(native.sendCustomMessage).toHaveBeenCalledTimes(1);
});
it('preauthorized repair creates a bounded isolated worker and leaves the original source untouched',async()=>{
  const {guardian,root,binding}=await setup();await fs.writeFile(path.join(root,'USER.txt'),'Original source');binding.guardian.allowedActions=['propose-repair'];
  const host=(guardian as any).host,enqueue=vi.fn(async()=>({id:'repair-worker'}));host.createConductor=vi.fn(async()=>({sessionPath:'/owned/repair-manager.jsonl'}));host.conductor=()=>({enqueue});
  const result=await guardian.act('/owned/main.jsonl',{action:'propose-repair',reason:'Observed formatter failure; reproduce using original source and checks.'});
  expect((result as any).task).toBe('repair-worker');expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({requires:[],goal:expect.stringContaining('do not modify original checks')}));expect(await fs.readFile(path.join(root,'USER.txt'),'utf8')).toBe('Original source');
});
it('stopping supervision revokes saved authority and rejects subsequent actions',async()=>{
  const {guardian,binding,native}=await setup();
  await guardian.stop('/owned/main.jsonl');
  expect(binding.guardianEnabled).toBe(false);
  await expect(guardian.act('/owned/main.jsonl',{action:'notify',reason:'stale monitor request'})).rejects.toThrow('authorization');
  expect(native.sendCustomMessage).not.toHaveBeenCalled();
});
it('stop invalidates an action while it is awaiting persistence, before dispatching a side effect',async()=>{
  const {guardian,binding,native}=await setup();const host=(guardian as any).host;
  let release!:()=>void;let saving!:()=>void;const entered=new Promise<void>(resolve=>{saving=resolve;});
  host.saveBinding.mockImplementationOnce(async()=>{saving();await new Promise<void>(resolve=>{release=resolve;});});
  const action=guardian.act('/owned/main.jsonl',{action:'notify',reason:'old request'});const rejected=expect(action).rejects.toThrow('stopped or changed');
  await entered;const stopped=guardian.stop('/owned/main.jsonl');release();await rejected;await stopped;
  expect(binding.guardianEnabled).toBe(false);expect(native.sendCustomMessage).not.toHaveBeenCalled();
});
it('stop cancels pending supervision approval so a late confirmation cannot launch a monitor',async()=>{
  const {guardian,binding}=await setup();const host=(guardian as any).host;
  let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
  host.confirm=vi.fn(async(_session,_dialog,options)=>{entered();return new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve(false),{once:true}));});
  const started=guardian.start('/owned/main.jsonl',binding.guardian);const rejected=expect(started).rejects.toThrow('not approved');
  await waiting;await guardian.stop('/owned/main.jsonl');await rejected;
  expect(binding.guardianEnabled).toBe(false);
});
it('restoration preserves prior intervention spending and does not bypass a disabled saved grant',async()=>{
  const {guardian,binding}=await setup();binding.guardianEnabled=false;
  await expect(guardian.start('/owned/main.jsonl',binding.guardian,true)).rejects.toThrow('Restoration cannot expand');
  expect(binding.guardianInterventions).toBeUndefined();
  binding.guardianEnabled=true;binding.guardianInterventions=1;
  await expect(guardian.start('/owned/main.jsonl',{...binding.guardian,maxInterventions:2},true)).rejects.toThrow('Restoration cannot expand');
  expect(binding.guardianInterventions).toBe(1);
});
it('saved but unrestored supervision is shown as unavailable rather than silently absent',async()=>{
  const {guardian}=await setup();
  expect(await guardian.status('/owned/main.jsonl')).toMatchObject({phase:'host-unavailable',processState:'unknown'});
});
it('a later read-only restriction prevents old guardian grants from launching another task',async()=>{
  const {guardian,binding,engine,native}=await setup();(engine as any).getSessionPermissionMode=()=> 'read_only';binding.guardian.allowedActions=['propose-repair'];
  await expect(guardian.act('/owned/main.jsonl',{action:'propose-repair',reason:'repair stale configuration'})).rejects.toThrow('只读');
  expect(native.sendCustomMessage).not.toHaveBeenCalled();expect(binding.guardianInterventions).toBeUndefined();
});
it('read-only memory callers cannot start, resume, publish, or record feedback through side endpoints',async()=>{
  const binding=vi.fn(),memory=new EngineeringMemory({engine:{getSessionPermissionMode:()=> 'read_only'},binding});
  await expect(memory.start('/owned',['memory-id'])).rejects.toThrow('只读');
  await expect(memory.action('/owned','run','resume')).rejects.toThrow('只读');
  await expect(memory.action('/owned','run','publish')).rejects.toThrow('只读');
  await expect(memory.feedback('/owned','memory-id','helpful')).rejects.toThrow('只读');
  expect(binding).not.toHaveBeenCalled();
});
it('can rebuild missing observations for an idle runtime without requiring the nonexistent observation id',async()=>{
  const {guardian,native,engine,observer,workspace}=await setup();await observer.close();await fs.rm(path.join(workspace.data,'observations'),{recursive:true,force:true});
  native.isIdle=true;
  await guardian.act('/owned/main.jsonl',{action:'refresh-observer',reason:'采集记录缺失，实际主任务空闲'});
  expect(engine.reloadSessionRuntime).toHaveBeenCalledWith('/owned/main.jsonl',{refreshCapabilitySnapshots:true});
});
it('does not rebuild observation collectors while an engineering operation is running',async()=>{
  const {guardian,native,engine,root}=await setup();native.isIdle=true;(guardian as any).host.isBusy=()=>true;
  const status=await readObserverStatus(root,undefined,'main');
  await expect(guardian.act('/owned/main.jsonl',{action:'refresh-observer',reason:'观测疑似异常',observationId:(status as any).id,run:(status as any).run})).rejects.toThrow('busy');
  expect(engine.reloadSessionRuntime).not.toHaveBeenCalled();
});
it('repeated monitor request ids cannot repeat a saved notification or spend budget twice',async()=>{
 const {guardian,binding,native}=await setup();const request={requestId:'lost-response',action:'notify',reason:'observed event'};
 const first=await guardian.act('/owned/main.jsonl',request),again=await guardian.act('/owned/main.jsonl',request);
 expect(again).toMatchObject({...first,replayed:true});expect(binding.guardianInterventions).toBe(1);expect(native.sendCustomMessage).toHaveBeenCalledTimes(1);
});

it('diagnosis includes historical successful checks and distinguishes their current validity from a later quiet operation',async()=>{
 const {guardian,workspace,native,root}=await setup();
 const {runProcess}=await import('enigma-next/process');const repo=path.join(root,'repo');await fs.mkdir(repo);await fs.writeFile(path.join(repo,'value.txt'),'before');await runProcess(['git','init','-q'],repo);await workspace.addRepo('api',repo,{access:'write'});await workspace.addCheck({id:'read',repo:'api',argv:[process.execPath,'-e','console.log("ACTUAL_CHECK_OK")']});const actual=await workspace.verify();expect(actual.status).toBe('verified');
 (native.sessionManager as any).getBranch=()=>[{type:'custom_message',customType:'enigma.workbench-operation',timestamp:new Date().toISOString(),content:JSON.stringify({id:'check-operation',state:'completed',outcome:actual.status,title:'运行全部检查',result:actual})},{type:'custom_message',customType:'enigma.workbench-operation',content:JSON.stringify({id:'later-view',state:'completed',title:'查看源码',result:{}})}];
 const first=await guardian.diagnose('/owned/main.jsonl','之前检查做了什么？');expect(first.basis.latestVerification.validNow).toBe(true);expect(first.basis.latestVerification.checks[0].output).toContain('ACTUAL_CHECK_OK');expect(first.answer).toContain('当时通过');
 await fs.writeFile(path.join(repo,'value.txt'),'after');const changed=await guardian.diagnose('/owned/main.jsonl','现在还是通过的吗？');expect(changed.basis.latestVerification.validNow).toBe(false);expect(changed.answer).toContain('需要重新检查');
 (native.sessionManager as any).getBranch=()=>[{type:'custom_message',customType:'enigma.workbench-operation',content:'{clipped',details:{operation:'failed-latest',verificationAttempt:true,state:'failed'}}];const failed=await guardian.diagnose('/owned/main.jsonl','最新检查怎样？');expect(failed.basis.latestVerification.recordedOutcome).toBe('failed');expect(failed.answer).toContain('不能沿用更早的通过记录');
});
it('large diagnostic inputs remain valid bounded JSON with check facts rather than cutting off serialization',async()=>{
 const {diagnosticPrompt}=await import('../plugins/enigma/guardian-host.ts');const input={at:'now',native:{idle:true},latestVerification:{validNow:false,checks:[{check:'contract',status:'passed',output:'ACTUAL_CHECK_OK'}]},observation:{recent:Array.from({length:100},()=>({detail:'many events '.repeat(5000)}))},requirements:Array.from({length:100},()=>({text:'a'.repeat(20000)}))};
 const text=diagnosticPrompt('还有进展吗？',input);expect(text.length).toBeLessThanOrEqual(22000);const value=JSON.parse(text);expect(value.snapshot.latestVerification.checks[0].output).toBe('ACTUAL_CHECK_OK');expect(value.snapshot.native.idle).toBe(true);
});
