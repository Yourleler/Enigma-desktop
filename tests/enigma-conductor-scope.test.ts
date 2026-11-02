import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationConductor } from '../plugins/enigma/conductor.ts';
import { Workspace } from 'enigma-next';
import { EngineeringHost } from '../plugins/enigma/host.ts';
import {runProcess} from 'enigma-next/process';

const directories:string[]=[];
const managers:ConversationConductor[]=[];
afterEach(async()=>{for(const manager of managers.splice(0))await manager.shutdown();for(const directory of directories.splice(0))await fs.rm(directory,{recursive:true,force:true});});

async function setup(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-conductor-scope-'));directories.push(directory);
  await Workspace.open(directory);
  const engine={hanakoHome:directory,getSessionIdForPath:()=> 'manager-one',emitBoundSessionEvent:vi.fn(),abortSession:vi.fn(),setSessionProjectAssignment:vi.fn()};
  const host={engine,publish:vi.fn(),confirm:vi.fn(async()=>true)};
  const manager=new ConversationConductor(host,'/owned/manager.jsonl');
  managers.push(manager);
  await manager.initialize(directory,{maxConcurrent:2,maxTasks:3,writableRepos:[],allowRewind:false,allowedModels:['test/model']});
  return {directory,engine,manager,host};
}

it('retains the provider failure returned as a terminal message rather than a thrown exception',async()=>{
  const {manager,engine,host,directory}=await setup(),ledger=await manager.load();
  const workspace=await Workspace.open(directory),repo=path.join(directory,'source');await fs.mkdir(repo);await runProcess(['git','init','-q'],repo);await fs.writeFile(path.join(repo,'config.json'),'{}');await workspace.addRepo('main',repo,{access:'write'});
  const native={model:{provider:'test',id:'model'},getLastAssistantText:()=>'',sendCustomMessage:vi.fn(async()=>{}),sessionManager:{getSessionId:()=> 'worker-pi',getBranch:()=>[{type:'message',message:{role:'assistant',stopReason:'error',errorMessage:'Worker model is outside its current manager grant'}}]}};
  Object.assign(engine,{getSessionByPath:()=>native,listSessions:async()=>[{path:'/owned/manager.jsonl',cwd:directory,projectId:'cwd:'}],resolveModelWithCredentialsFresh:async()=>({model:native.model}),resolveSessionOwnership:()=>({agentId:'test'}),createDetachedSession:async()=>({sessionPath:'/owned/worker.jsonl',sessionId:'worker'}),saveSessionTitle:async()=>{},promptSession:async()=>{}});
  Object.assign(host,{connect:async()=>{},setManagedModels:async()=>{}});
  const task={id:'worker',title:'read config',goal:'read',requires:[],writeRepos:[],checks:[],status:'queued' as const};ledger.tasks.push(task);
  await (manager as any).run(task);
  expect(ledger.tasks[0].status).toBe('failed');
  expect(ledger.tasks[0].error).toContain('outside its current manager grant');
  expect(engine.setSessionProjectAssignment).toHaveBeenCalledWith({sessionPath:'/owned/worker.jsonl',projectId:'cwd:'});
});

it('rejects undelegated write scopes, unapproved models and unrelated conversation controls',async()=>{
  const {manager,engine}=await setup();
  await expect(manager.enqueue({title:'unapproved write',goal:'change files',requires:[],writeRepos:['foreign'],checks:[]})).rejects.toThrow('write scope');
  await expect(manager.enqueue({title:'unapproved model',goal:'read',requires:[],writeRepos:[],checks:[],modelPolicy:{mode:'single',execution:{provider:'other',id:'model'},phase:'execution',requests:0,failures:0}})).rejects.toThrow('allowlist');
  await expect(manager.cancel('other-conversation')).rejects.toThrow('Only conversations');
  await expect(manager.move('other-conversation','other-project')).rejects.toThrow('Only conversations');
  expect(engine.abortSession).not.toHaveBeenCalled();expect(engine.setSessionProjectAssignment).not.toHaveBeenCalled();
});

it('snapshots the configured child model at enqueue while preserving explicit task policies',async()=>{
  const {manager,host}=await setup();vi.spyOn(manager,'pump').mockResolvedValue(undefined);
  Object.assign(host,{binding:async()=>({modelPolicy:{mode:'delegated',execution:{provider:'test',id:'main'},worker:{provider:'test',id:'model',thinking:'low'}}})});
  const task=await manager.enqueue({title:'child',goal:'read',requires:[],writeRepos:[],checks:[]});
  expect(task.modelPolicy?.execution).toEqual({provider:'test',id:'model',thinking:'low'});expect(task.modelPolicy?.mode).toBe('single');expect(task.modelPolicy?.worker).toBeUndefined();
  const explicit=await manager.enqueue({title:'explicit',goal:'read',requires:[],writeRepos:[],checks:[],modelPolicy:{mode:'single',execution:{provider:'test',id:'model',thinking:'high'},phase:'execution',requests:0,failures:0}});
  expect(explicit.modelPolicy?.execution.thinking).toBe('high');
  Object.assign(host,{binding:async()=>({modelPolicy:{worker:{provider:'other',id:'not-allowed'}}})});
  await expect(manager.enqueue({title:'bad child',goal:'read',requires:[],writeRepos:[],checks:[]})).rejects.toThrow('allowlist');
});

it('allows narrowing persisted manager limits and rejects silent expansion or rewind enablement',async()=>{
  const {manager,directory}=await setup();
  await manager.restrictLimits({maxConcurrent:1,maxTasks:2});
  await expect(manager.restrictLimits({maxConcurrent:2})).rejects.toThrow('expanding');
  await expect(manager.restrictLimits({allowRewind:true})).rejects.toThrow('expanding');
  const stored=JSON.parse(await fs.readFile(path.join(directory,'user/enigma-conductors/manager-one.json'),'utf8'));
  expect(stored.limits.maxConcurrent).toBe(1);expect(stored.limits.allowRewind).toBe(false);
});

it('validates limits and does not accept malformed concurrency or a forged ledger root',async()=>{
  const {manager,directory}=await setup();
  await expect(manager.restrictLimits({maxConcurrent:1.5})).rejects.toThrow('limits require');
  await expect(manager.restrictLimits({allowedModels:['malformed']})).rejects.toThrow('limits require');
  await manager.restrictLimits({maxConcurrent:1,root:'/foreign'} as any);
  expect((await manager.load()).root).toBe(await fs.realpath(directory));
  expect((await manager.load()).limits).not.toHaveProperty('root');
});

it('revokes already-running models before abort and awaits actual owned execution settlement',async()=>{
  const {manager,engine}=await setup(),ledger=await manager.load();
  ledger.tasks.push({id:'worker',title:'own worker',goal:'read',requires:[],writeRepos:[],checks:[],sessionPath:'/owned/worker.jsonl',status:'running',modelPolicy:{mode:'single',execution:{provider:'test',id:'model'},phase:'execution',requests:2,failures:0}});
  let finish!:()=>void;manager.active.set('worker',new Promise<void>(resolve=>{finish=resolve;}));
  engine.abortSession.mockImplementation(async()=>{expect(ledger.tasks[0].status).toBe('cancelled');finish();});
  await manager.restrictLimits({allowedModels:[]});
  expect(engine.abortSession).toHaveBeenCalledWith('/owned/worker.jsonl');
  expect(ledger.tasks[0].status).toBe('cancelled');expect(ledger.tasks[0].error).toContain('撤销');
  expect(ledger.tasks[0].modelPolicy?.requests).toBe(2);
});

it('cold load preserves orphan task data and reports interrupted execution without replaying it',async()=>{
  const {manager,directory,engine}=await setup();
  const file=path.join(directory,'user/enigma-conductors/manager-one.json'),stored=JSON.parse(await fs.readFile(file,'utf8'));
  stored.tasks=[{id:'orphan',title:'interrupted',goal:'retain original goal',requires:[],writeRepos:[],checks:[],status:'running',sessionPath:'/owned/worker.jsonl',result:'prior evidence'}];
  await fs.writeFile(file,JSON.stringify(stored));
  const restored=new ConversationConductor({engine,publish:vi.fn()},'/owned/manager.jsonl');
  const [first,second]=await Promise.all([restored.load(),restored.load()]);
  expect(first).toBe(second);expect(first.tasks[0].status).toBe('blocked');expect(first.tasks[0].result).toBe('prior evidence');
  expect(first.tasks[0].goal).toBe('retain original goal');expect(engine.abortSession).not.toHaveBeenCalled();
  expect(manager.active.size).toBe(0);
});
it('cold task status reads owned progress and revalidates saved check evidence against current source',async()=>{
 const {manager,engine,directory}=await setup(),ledger=await manager.load(),root=path.join(directory,'child');await fs.mkdir(root);
 const child=await Workspace.open(root),repo=path.join(root,'source');await fs.mkdir(repo);await runProcess(['git','init','-q'],repo);await fs.writeFile(path.join(repo,'index.js'),'export const version = 1;');await child.addRepo('source',repo,{access:'write'});await child.addCheck({id:'syntax',repo:'source',argv:[process.execPath,'--check','index.js']});
 const proof=await child.exclusive(()=>child.verify());
 await fs.writeFile(path.join(child.data,'session-child-pi.json'),JSON.stringify({schema:1,requests:7,sessionFile:'/owned/worker.jsonl',lastVerification:'verified',lastCheckEvidence:proof.evidence}));
 ledger.tasks.push({id:'worker',title:'stored task',goal:'retain files',requires:[],writeRepos:['source'],checks:['syntax'],status:'blocked',root:child.root,sessionPath:'/owned/worker.jsonl',piSessionId:'child-pi'});
 (engine as any).getSessionByPath=vi.fn(()=>null);
 expect((await manager.status()).tasks[0].progress).toEqual({verification:'verified',requests:7});
 await fs.writeFile(path.join(repo,'index.js'),'export const version = 2;');
 expect((await manager.status()).tasks[0].progress).toEqual({verification:'stale',requests:7});
 await fs.writeFile(path.join(child.data,'session-child-pi.json'),JSON.stringify({schema:1,requests:99,sessionFile:'/unrelated/task'}));
 const changed=(await manager.status()).tasks[0];expect(changed.progress).toBeNull();expect(changed.progressError).toContain('暂不可读取');
 expect(engine.abortSession).not.toHaveBeenCalled();
});

it('native worker model controls respect manager grants and retain usage across policy changes',async()=>{
  const {directory}=await setup();
  const engine={hanakoHome:directory,getSessionIdForPath:()=> 'worker-model',resolveModelWithCredentialsFresh:vi.fn(async(role)=>role),getSessionByPath:()=>({isIdle:false}),emitBoundSessionEvent:vi.fn()};
  const host=new EngineeringHost(engine),worker='/owned/model-worker.jsonl';
  await host.saveBinding(worker,{root:directory,memory:false});await host.setManagedModels(worker,'/owned/manager.jsonl',['test/model']);
  await expect(host.requestModel(worker,'foreign','model')).rejects.toThrow('manager grant');
  expect(engine.resolveModelWithCredentialsFresh).not.toHaveBeenCalled();
  await host.configureModelPolicy(worker,{mode:'single',execution:{provider:'test',id:'model'},maxRequests:10});
  (await host.binding(worker))!.modelPolicy!.requests=7;
  await host.configureModelPolicy(worker,{mode:'single',execution:{provider:'test',id:'model'},maxRequests:10});
  expect((await host.binding(worker))!.modelPolicy!.requests).toBe(7);
  await host.setManagedModels(worker,'/owned/manager.jsonl',[]);
  await expect(host.assertManagedModel(worker,'test','model')).rejects.toThrow('manager grant');
  await expect(host.setManagedModels(worker,'/unrelated/manager.jsonl',['test/model'])).rejects.toThrow('ownership');
});
it('group completion requires original requirement coverage and expires after current source changes',async()=>{
  const {manager,engine,directory}=await setup(),ledger=await manager.load(),workspace=await Workspace.open(directory);
  const native={sessionManager:{getSessionId:()=> 'manager-pi',getEntries:()=>[{type:'message',id:'original',message:{role:'user',content:'Return a source-grounded read-only report.'}}]}};
  (engine as any).getSessionByPath=()=>native;ledger.tasks.push({id:'reader',title:'Read sources',goal:'read-only',requires:[],writeRepos:[],checks:[],status:'completed',result:'Source observations'});
  const repo=path.join(directory,'source');await fs.mkdir(repo);await runProcess(['git','init','-q'],repo);await fs.writeFile(path.join(repo,'value.txt'),'v1');await workspace.addRepo('source',repo,{access:'write'});
  await expect(manager.requirements('receipt')).rejects.toThrow('unresolved requirements');
  const evidence=await workspace.evidence('reading',{sources:'actual-fixture'},await workspace.observe());
  await manager.requirements('resolve',{id:'original',assessment:'addressed',reason:'Completed source-grounded report; no source mutation',evidence:[evidence.id]});
  const receipt=await manager.requirements('receipt');expect(receipt.task).toBe('manager-pi');expect((await manager.status()).complete).toBe(true);
  ledger.tasks[0].sessionPath='/owned/reader';(engine as any).isSessionStreaming=(p:string)=>p==='/owned/reader';expect((await manager.status()).complete).toBe(false);expect((await manager.summary()).active).toBe(1);await expect(manager.requirements('receipt')).rejects.toThrow('Settle');(engine as any).isSessionStreaming=()=>false;
  await fs.writeFile(path.join(repo,'value.txt'),'v2');expect((await manager.status()).complete).toBe(false);
});
it('dependency-blocked tasks become schedulable after their prerequisite succeeds, while explicit cancellation stays terminal',async()=>{
 const {manager}=await setup(),ledger=await manager.load();ledger.tasks.push({id:'a',title:'A',goal:'A',requires:[],writeRepos:[],checks:[],status:'failed'},{id:'b',title:'B',goal:'B',requires:['a'],writeRepos:[],checks:[],status:'queued'});
 await manager.pump();expect(ledger.tasks[1].status).toBe('blocked');expect(ledger.tasks[1].waitingOnDependencies).toBe(true);
 let completed!:()=>void;(manager as any).run=vi.fn(async task=>{task.status='completed';completed();});const finished=new Promise<void>(resolve=>{completed=resolve;});ledger.tasks[0].status='completed';await manager.pump();await finished;expect(ledger.tasks[1].status).toBe('completed');
 ledger.tasks[1].status='blocked';ledger.tasks[1].waitingOnDependencies=true;await manager.cancel('b');await manager.pump();expect(ledger.tasks[1].status).toBe('cancelled');
});
it('a fast task completing during a pump schedules its newly-ready dependents',async()=>{
 const {manager}=await setup(),ledger=await manager.load();ledger.limits.maxConcurrent=1;
 // Put the dependent first so it is visited before its prerequisite completes.
 ledger.tasks.push({id:'b',title:'B',goal:'B',requires:['a'],writeRepos:[],checks:[],status:'queued'},{id:'a',title:'A',goal:'A',requires:[],writeRepos:[],checks:[],status:'queued'});
 const order:string[]=[];(manager as any).run=vi.fn(async task=>{order.push(task.id);task.status='completed';});await manager.pump();
 const until=Date.now()+2000;while(order.length<2&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));expect(order).toEqual(['a','b']);
});
it('assignment approval cannot add a task after the allowed task count was exhausted',async()=>{
 const {manager}=await setup(),ledger=await manager.load();ledger.limits.maxTasks=1;let approve!:(value:boolean)=>void;(manager as any).host.confirm=vi.fn(()=>new Promise(resolve=>{approve=resolve;}));
 const pending=manager.enqueue({title:'pending',goal:'read',requires:[],writeRepos:[],checks:[]});const rejected=expect(pending).rejects.toThrow('limits changed');
 const until=Date.now()+1000;while(!approve&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));ledger.tasks.push({id:'other',title:'other',goal:'read',requires:[],writeRepos:[],checks:[],status:'completed'});approve(true);await rejected;expect(ledger.tasks).toHaveLength(1);
});
it('a deliberately sequenced update is not reported as a conflict with the upstream version it consumed',async()=>{
 const {manager,engine,directory}=await setup(),workspace=await Workspace.open(directory),repo=path.join(directory,'source');await fs.mkdir(repo);await runProcess(['git','init','-q'],repo);await fs.writeFile(path.join(repo,'file.txt'),'original');await workspace.addRepo('source',repo,{access:'write'});
 const base=await workspace.checkpoint('original'),up=await workspace.forkCheckpoint(base.id,path.join(directory,'up'));await fs.writeFile(path.join(up.repo('source').root,'file.txt'),'upstream');
 const {dependencyCheckpoint}=await import('enigma-next'),prepared=await dependencyCheckpoint(workspace,'down',[{task:'up',root:up.root,baseline:base.id,writeRepos:['source']}]),down=await workspace.forkCheckpoint(prepared.checkpoint.id,path.join(directory,'down'));await fs.writeFile(path.join(down.repo('source').root,'file.txt'),'downstream');
 (engine as any).getSessionByPath=()=>null;const ledger=await manager.load();ledger.tasks.push({id:'up',title:'up',goal:'up',requires:[],writeRepos:['source'],checks:[],status:'completed',root:up.root,baseline:base.id},{id:'down',title:'down',goal:'down',requires:['up'],writeRepos:['source'],checks:[],status:'completed',root:down.root,baseline:prepared.checkpoint.id,inputVersions:prepared.inputs});
 expect((await manager.status()).conflicts).toHaveLength(0);ledger.tasks[1].requires=[];expect((await manager.status()).conflicts).toHaveLength(1);
});
it('cancelling a task invalidates a pending resume approval and prevents the late continuation',async()=>{
 const {manager,directory}=await setup(),ledger=await manager.load();await fs.mkdir(path.join(directory,'child'));const child=await Workspace.open(path.join(directory,'child'));
 ledger.tasks.push({id:'worker',title:'worker',goal:'preserve original',requires:[],writeRepos:[],checks:[],status:'blocked',root:child.root,sessionPath:'/owned/worker'});
 let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 (manager as any).host.confirm=vi.fn(async(_path,_dialog,options)=>{entered();return new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve(false),{once:true}));});
 const resume=manager.resume('worker','inspect current files');const rejected=expect(resume).rejects.toThrow('任务已取消或授权已变化');await waiting;await manager.cancel('worker');await rejected;
 expect(ledger.tasks[0].status).toBe('cancelled');expect(manager.active.size).toBe(0);
});
it('tightening limits invalidates a pending resume even when the caller later approves',async()=>{
 const {manager,directory}=await setup(),ledger=await manager.load();await fs.mkdir(path.join(directory,'child'));const child=await Workspace.open(path.join(directory,'child'));
 ledger.tasks.push({id:'worker',title:'worker',goal:'preserve original',requires:[],writeRepos:[],checks:[],status:'blocked',root:child.root,sessionPath:'/owned/worker'});
 let approve!:(value:boolean)=>void;let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 (manager as any).host.confirm=vi.fn(async()=>{entered();return new Promise(resolve=>{approve=resolve;});});
 const resume=manager.resume('worker','inspect current files');const rejected=expect(resume).rejects.toThrow('任务已取消或授权已变化');await waiting;await manager.restrictLimits({maxConcurrent:1});approve(true);await rejected;
 expect(ledger.tasks[0].status).toBe('blocked');expect(manager.active.size).toBe(0);
});
it('cancel during integration confirmation invalidates the previously selected worker',async()=>{
 const {manager}=await setup(),ledger=await manager.load();ledger.tasks.push({id:'worker',title:'result',goal:'read',requires:[],writeRepos:[],checks:[],status:'completed'});ledger.integrationPreviews=[{id:'preview',task:'worker'}];
 let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 (manager as any).host.confirm=vi.fn(async(_path,_dialog,options)=>{entered();return new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve(false),{once:true}));});
 const pending=manager.integrate('preview'),rejected=expect(pending).rejects.toThrow('任务已取消或授权已变化');await waiting;await manager.cancel('worker');await rejected;expect(ledger.acceptance).toBeUndefined();
});
