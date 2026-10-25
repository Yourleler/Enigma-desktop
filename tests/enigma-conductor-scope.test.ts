import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationConductor } from '../plugins/enigma/conductor.ts';
import { Workspace } from 'enigma-next';
import { EngineeringHost } from '../plugins/enigma/host.ts';

const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await fs.rm(directory,{recursive:true,force:true});});

async function setup(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-conductor-scope-'));directories.push(directory);
  await Workspace.open(directory);
  const engine={hanakoHome:directory,getSessionIdForPath:()=> 'manager-one',emitBoundSessionEvent:vi.fn(),abortSession:vi.fn(),setSessionProjectAssignment:vi.fn()};
  const host={engine,publish:vi.fn(),confirm:vi.fn(async()=>true)};
  const manager=new ConversationConductor(host,'/owned/manager.jsonl');
  await manager.initialize(directory,{maxConcurrent:2,maxTasks:3,writableRepos:[],allowRewind:false,allowedModels:['test/model']});
  return {directory,engine,manager};
}

it('rejects undelegated write scopes, unapproved models and unrelated conversation controls',async()=>{
  const {manager,engine}=await setup();
  await expect(manager.enqueue({title:'unapproved write',goal:'change files',requires:[],writeRepos:['foreign'],checks:[]})).rejects.toThrow('write scope');
  await expect(manager.enqueue({title:'unapproved model',goal:'read',requires:[],writeRepos:[],checks:[],modelPolicy:{mode:'single',execution:{provider:'other',id:'model'},phase:'execution',requests:0,failures:0}})).rejects.toThrow('allowlist');
  await expect(manager.cancel('other-conversation')).rejects.toThrow('Only conversations');
  await expect(manager.move('other-conversation','other-project')).rejects.toThrow('Only conversations');
  expect(engine.abortSession).not.toHaveBeenCalled();expect(engine.setSessionProjectAssignment).not.toHaveBeenCalled();
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
  expect((await manager.load()).root).toBe(directory);
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
