import {expect,it} from 'vitest';
import {serializeModelRuntimeRefresh} from '../lib/pi-sdk/model-runtime-refresh.ts';
it('orders implicit mutation refreshes before explicit reads and recovers after failure',async()=>{
 let started!:()=>void;const beginning=new Promise<void>(r=>started=r);
 let release!:()=>void;const first=new Promise<void>(resolve=>release=resolve);const events:string[]=[];
 const runtime=serializeModelRuntimeRefresh({async refresh(kind:string){events.push(kind);started();if(kind==='mutation'){await first;throw Error('transient');}return kind;}});
 const mutation=runtime.refresh('mutation');const failed=mutation.catch(error=>error.message);const read=runtime.refresh('read');await beginning;expect(events).toEqual(['mutation']);release();expect(await failed).toBe('transient');expect(await read).toBe('read');expect(events).toEqual(['mutation','read']);
});
it('does not serialize unrelated runtimes',async()=>{
 let release!:()=>void;const blocked=serializeModelRuntimeRefresh({refresh:()=>new Promise<void>(r=>release=r)});const independent=serializeModelRuntimeRefresh({refresh:async()=> 'ready'});const pending=blocked.refresh();expect(await independent.refresh()).toBe('ready');release();await pending;
});
it('coalesces equivalent waiting refreshes but not separately abortable calls',async()=>{
 let started!:()=>void;const beginning=new Promise<void>(r=>started=r);
 let release!:()=>void;const gate=new Promise<void>(r=>release=r),calls:unknown[]=[];const runtime=serializeModelRuntimeRefresh({async refresh(options:unknown){calls.push(options);started();if(calls.length===1)await gate;return calls.length;}});
 const first=runtime.refresh({providers:['busy']});await beginning;
 const second=runtime.refresh({allowNetwork:false}),third=runtime.refresh({allowNetwork:false});expect(second).toBe(third);
 const fourth=runtime.refresh({allowNetwork:false,signal:new AbortController().signal});expect(fourth).not.toBe(second);release();await Promise.all([first,second,third,fourth]);expect(calls).toHaveLength(3);
});
