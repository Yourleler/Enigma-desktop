import {it,expect,vi} from 'vitest';
import {QueuedModelSwitch} from '../core/queued-model-switch';
it('records a selection while streaming and applies it only at a request boundary',async()=>{
 const apply=vi.fn(async()=>{}),save=vi.fn(async()=>{}),resolve=vi.fn(async(provider,id)=>({provider,id}));
 const queue=new QueuedModelSwitch({resolve,apply,save,idle:()=>false});
 expect(await queue.request('p','b')).toMatchObject({selection:{id:'b',state:'pending'},effectiveAt:'next-request'});expect(apply).not.toHaveBeenCalled();
 await queue.atBoundary();expect(apply).toHaveBeenCalledWith({provider:'p',id:'b'});expect(queue.result()).toMatchObject({selection:{state:'applied'},effectiveAt:'now'});
 await queue.atBoundary();expect(apply).toHaveBeenCalledTimes(1);
});
it('keeps the latest selection when validation resolves out of order and supports cancellation',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);const apply=vi.fn(async()=>{});
 const queue=new QueuedModelSwitch({resolve:async(provider,id)=>{if(id==='slow')await gate;return {provider,id};},apply,save:async()=>{},idle:()=>false});
 const first=queue.request('p','slow');await queue.request('p','latest');release();await first;await queue.atBoundary();expect(apply).toHaveBeenCalledTimes(1);expect(apply).toHaveBeenCalledWith({provider:'p',id:'latest'});
 await queue.request('p','cancel');await queue.cancel();await queue.atBoundary();expect(apply).toHaveBeenCalledTimes(1);expect(queue.selection?.state).toBe('cancelled');
});
it('retains the current model when credentials or capacity fail and retries only on a new choice',async()=>{
 const apply=vi.fn(async()=>{throw Error('context too large');});const queue=new QueuedModelSwitch({resolve:async()=>({id:'small'}),apply,save:async()=>{},idle:()=>false});
 await queue.request('p','small');await queue.atBoundary();expect(queue.selection).toMatchObject({state:'failed',error:'context too large'});await queue.atBoundary();expect(apply).toHaveBeenCalledTimes(1);
});
it('restores a pending selection and revalidates it at the next request',async()=>{
 const apply=vi.fn(async()=>{});const queue=new QueuedModelSwitch({initial:{provider:'p',id:'saved',revision:8,state:'pending'},resolve:async(provider,id)=>({provider,id}),apply,save:async()=>{},idle:()=>false});
 await queue.atBoundary();expect(apply).toHaveBeenCalledWith({provider:'p',id:'saved'});expect(queue.selection?.state).toBe('applied');
});
