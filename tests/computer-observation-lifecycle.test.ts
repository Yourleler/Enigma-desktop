import {expect,it,vi} from 'vitest';
import {ComputerLeaseRegistry} from '../core/computer-use/lease-registry.ts';
import {ComputerHost} from '../core/computer-use/computer-host.ts';
import {ComputerProviderRegistry} from '../core/computer-use/provider-registry.ts';
import {createMockComputerProvider} from '../core/computer-use/providers/mock-provider.ts';
const ctx={sessionId:'new-test',sessionPath:'/new/test.jsonl',agentId:'test',model:{id:'test',provider:'test',input:['text','image']}};

it('keeps only the current screenshot and rejects expired or invalidated observations',()=>{
  let now=1000;const registry=new ComputerLeaseRegistry({now:()=>now,snapshotMaxAgeMs:2000});
  const lease=registry.createLease(ctx,{providerId:'mock',appId:'test'});
  let snapshot:any;
  for(let i=0;i<50;i++)snapshot=registry.recordSnapshot(ctx,lease.leaseId,{screenshot:{data:'new-test-image'}});
  expect(registry._snapshots.size).toBe(1);
  now=4001;expect(()=>registry.validateSnapshot(ctx,lease.leaseId,snapshot.snapshotId)).toThrow('expired');
  registry.invalidateSnapshot(ctx,lease.leaseId);expect(registry._snapshots.size).toBe(0);
  expect(()=>registry.validateSnapshot(ctx,lease.leaseId,snapshot.snapshotId)).toThrow('stale');
});

it('serializes an observation before later input and refuses the old snapshot',async()=>{
  const provider=createMockComputerProvider();const providers=new ComputerProviderRegistry();providers.register(provider);
  const host=new ComputerHost({providers,defaultProviderId:'mock',getSettings:()=>({enabled:true})});
  const lease=await host.createLease(ctx,{appId:'test'});const before=await host.getAppState(ctx,lease.leaseId);
  const original=provider.getAppState.bind(provider);let release:any;
  provider.getAppState=vi.fn(async(c,l)=>{await new Promise(resolve=>{release=resolve;});return original(c,l);});
  const action=vi.spyOn(provider,'performAction');const reading=host.getAppState(ctx,lease.leaseId);
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const clicking=host.performAction(ctx,lease.leaseId,{type:'click_element',elementId:'mock-button',snapshotId:before.snapshotId});
  release();await reading;await expect(clicking).rejects.toMatchObject({code:'STALE_SNAPSHOT'});
  expect(action).not.toHaveBeenCalled();
});

it('cancels queued input without dispatching it after an OS read finishes',async()=>{
  const provider=createMockComputerProvider();const providers=new ComputerProviderRegistry();providers.register(provider);
  const host=new ComputerHost({providers,defaultProviderId:'mock',getSettings:()=>({enabled:true})});
  const lease=await host.createLease(ctx,{appId:'test'});const before=await host.getAppState(ctx,lease.leaseId);
  const original=provider.getAppState.bind(provider);let release:any;
  provider.getAppState=vi.fn(async(c,l)=>{await new Promise(resolve=>{release=resolve;});return original(c,l);});
  const action=vi.spyOn(provider,'performAction');const reading=host.getAppState(ctx,lease.leaseId);
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const cancel=new AbortController();const clicking=host.performAction({...ctx,signal:cancel.signal},lease.leaseId,{type:'click_element',elementId:'mock-button',snapshotId:before.snapshotId});
  cancel.abort(new Error('stop queued action'));await expect(clicking).rejects.toThrow('stop queued action');
  release();await reading;await host._operations;expect(action).not.toHaveBeenCalled();
});
