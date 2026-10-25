import { afterEach,expect,it,vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace,RunObserver,readObserverStatus } from 'enigma-next';
import { EngineeringGuardian } from '../plugins/enigma/guardian-host.ts';
const cleanup:(()=>Promise<any>)[]=[];
afterEach(async()=>{for(const close of cleanup.reverse())await close();cleanup.length=0;});
async function setup(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-guardian-control-'));cleanup.push(()=>fs.rm(root,{recursive:true,force:true}));
  const workspace=await Workspace.open(root),observer=await RunObserver.create(root,'main',{heartbeatMs:100});cleanup.push(()=>observer.close());
  observer.record({kind:'start',stage:'run',id:'run'});await observer.flush();
  const binding:any={root,guardian:{mode:'managed',allowedActions:['notify','cancel-and-resume','refresh-observer'],maxInterventions:1}};
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
  const {guardian,root,engine,native,binding}=await setup();await fs.writeFile(path.join(root,'USER.txt'),'Keep actual code');
  const status=await readObserverStatus(root,undefined,'main');expect(status.available).toBe(true);
  await guardian.act('/owned/main.jsonl',{action:'cancel-and-resume',reason:'Observed repeated failure; re-read current files.',observationId:(status as any).id,run:(status as any).run});
  expect(engine.abortSession).toHaveBeenCalledTimes(1);expect(binding.guardianInterventions).toBe(1);
  expect(native.sendCustomMessage).toHaveBeenCalledWith(expect.objectContaining({customType:'enigma.guardian-recovery',content:expect.stringContaining('Original requirements')}),{triggerTurn:true});
  expect(await fs.readFile(path.join(root,'USER.txt'),'utf8')).toBe('Keep actual code');
});
