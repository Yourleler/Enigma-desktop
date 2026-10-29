import {setImmediate as nextTurn} from 'node:timers/promises';
/** A registry mutation also starts a refresh inside Pi. Order those public calls
 * before explicit catalog reads, per runtime. Equivalent waiting refreshes use
 * the latest declarations when they start, so they can share one pending pass. */
export function serializeModelRuntimeRefresh<T extends {refresh:(...args:any[])=>Promise<any>}>(runtime:T):T {
 const refresh=runtime.refresh.bind(runtime);
 let tail:Promise<unknown>=Promise.resolve();
 let pending:{key:string|null;started:boolean;promise:Promise<any>}|undefined;
 runtime.refresh=((...args:Parameters<T['refresh']>)=>{
  let key:string|null=null;
  try{if(!args.some(arg=>arg&&typeof arg==='object'&&arg.signal))key=JSON.stringify(args);}catch{/* Non-serializable options remain distinct operations. */}
  if(key!==null&&pending?.key===key&&!pending.started)return pending.promise;
  const job={key,started:false,promise:Promise.resolve() as Promise<any>};
  job.promise=tail.catch(()=>{}).then(async()=>{
   // A synchronous registration batch is spread over Promise callbacks by the
   // facade. Give that batch one event-loop turn to enqueue its declarations.
   await nextTurn();job.started=true;return refresh(...args);
  });
  tail=job.promise.catch(()=>{});pending=job;
  return job.promise;
 }) as T['refresh'];
 return runtime;
}
