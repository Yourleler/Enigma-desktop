import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringHost } from '../plugins/enigma/host';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, {recursive:true,force:true}); });
function gate() { let release!: () => void; const promise = new Promise<void>(r => {release=r;}); return {promise,release}; }
async function setup() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-model-race-'));roots.push(root);await fs.mkdir(path.join(root,'user'));
  const engine={hanakoHome:root,getSessionIdForPath:()=> 'worker',getSessionByPath:()=>({isIdle:false}),resolveModelWithCredentialsFresh:vi.fn(async(role)=>role),switchSessionModel:vi.fn(async()=>({})),emitBoundSessionEvent:vi.fn()};
  const host=new EngineeringHost(engine),session='/owned/worker.jsonl';await host.saveBinding(session,{root,memory:false});
  return {root,engine,host,session};
}
it('keeps the last engineering model choice when credential checks finish out of order',async()=>{
  const f=await setup(),entered=gate(),slow=gate();
  f.engine.resolveModelWithCredentialsFresh.mockImplementation(async role=>{if(role.id==='slow'){entered.release();await slow.promise;}return role;});
  const first=f.host.requestModel(f.session,'test','slow');await entered.promise;
  await f.host.requestModel(f.session,'test','latest');slow.release();await first;
  await f.host.applyRequestedModel(f.session);
  expect(f.engine.switchSessionModel).toHaveBeenCalledExactlyOnceWith(f.session,'latest','test');
});
it('cancels an engineering selection while its credential check is still pending',async()=>{
  const f=await setup(),entered=gate(),slow=gate();
  f.engine.resolveModelWithCredentialsFresh.mockImplementation(async role=>{entered.release();await slow.promise;return role;});
  const pending=f.host.requestModel(f.session,'test','slow');await entered.promise;
  await f.host.cancelRequestedModel(f.session);slow.release();await pending;await f.host.applyRequestedModel(f.session);
  expect(f.engine.switchSessionModel).not.toHaveBeenCalled();
});
it('does not resurrect a revoked manager grant after an old credential check finishes',async()=>{
  const f=await setup(),entered=gate(),slow=gate();await f.host.setManagedModels(f.session,'/owned/manager',['test/slow']);
  f.engine.resolveModelWithCredentialsFresh.mockImplementation(async role=>{entered.release();await slow.promise;return role;});
  const pending=f.host.requestModel(f.session,'test','slow');await entered.promise;
  await f.host.setManagedModels(f.session,'/owned/manager',[]);slow.release();await pending.catch(()=>{});
  expect((await f.host.binding(f.session))?.managedGrant?.models).toEqual([]);
  await f.host.applyRequestedModel(f.session);expect(f.engine.switchSessionModel).not.toHaveBeenCalled();
});
it('rechecks the newest choice at the request boundary and serializes overlapping boundary calls',async()=>{
  const f=await setup(),entered=gate(),slow=gate();let checks=0;
  f.engine.resolveModelWithCredentialsFresh.mockImplementation(async role=>{if(role.id==='first'&&++checks===2){entered.release();await slow.promise;}return role;});
  await f.host.requestModel(f.session,'test','first');
  const boundary=f.host.applyRequestedModel(f.session);await entered.promise;
  await f.host.requestModel(f.session,'test','latest');
  const sameBoundary=f.host.applyRequestedModel(f.session);slow.release();await Promise.all([boundary,sameBoundary]);
  expect(f.engine.switchSessionModel).toHaveBeenCalledExactlyOnceWith(f.session,'latest','test');
});
it('does not falsely report cancellation once a model commit has started',async()=>{
  const f=await setup(),entered=gate(),slow=gate();
  f.engine.switchSessionModel.mockImplementation(async()=>{entered.release();await slow.promise;return {};});
  await f.host.requestModel(f.session,'test','target');const boundary=f.host.applyRequestedModel(f.session);await entered.promise;
  await expect(f.host.cancelRequestedModel(f.session)).rejects.toThrow('已进入切换阶段');
  slow.release();await boundary;
  expect((await f.host.binding(f.session))?.pendingModel?.state).toBe('applied');
});
it('keeps role policy consistent when the boundary validates faster than the original selection request',async()=>{
  const f=await setup(),entered=gate(),slow=gate();
  await f.host.configureModelPolicy(f.session,{mode:'single',execution:{provider:'test',id:'original'},maxRequests:12});
  let checks=0;f.engine.resolveModelWithCredentialsFresh.mockImplementation(async role=>{if(role.id==='target'&&++checks===1){entered.release();await slow.promise;}return role;});
  const pending=f.host.requestModel(f.session,'test','target');await entered.promise;
  await f.host.applyRequestedModel(f.session);slow.release();await pending;
  const binding=await f.host.binding(f.session);
  expect(binding?.pendingModel?.state).toBe('applied');
  expect(binding?.modelPolicy?.execution.id).toBe('target');
  expect(binding?.modelPolicy?.maxRequests).toBe(12);
});
