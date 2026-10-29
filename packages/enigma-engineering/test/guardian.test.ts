import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { GuardianProcess,guardianConcern } from '../src/guardian.js';
import { RunObserver } from '../src/observer.js';
import {GuardianActions} from '../src/guardian-actions.js';

test('guardian distinguishes missing observations, approval, repetition and long stages without auto rollback',()=>{
  assert.equal(guardianConcern({available:false},1000)?.kind,'observation');
  const base={available:true,sourceProcess:{liveness:'alive'},stages:[],signals:[]};
  assert.equal(guardianConcern({...base,stages:[{stage:'run',elapsedMs:100000}]},1000),null);
  assert.equal(guardianConcern({...base,stages:[{stage:'tool',elapsedMs:100000,label:'test'}]},1000)?.kind,'tool');
  assert.equal(guardianConcern({...base,stages:[{stage:'approval',elapsedMs:100000}]},1000)?.kind,'approval');
  assert.equal(guardianConcern({...base,signals:[{count:3,type:'same-source'}]},1000)?.kind,'repetition');
  assert.equal(guardianConcern({...base,sourceProcess:{liveness:'terminated'}},1000)?.kind,'process');
  assert.equal(guardianConcern({...base,state:'error',recent:[{stage:'compaction',kind:'end',status:'failed'}]},1000)?.kind,'compaction');
  assert.equal(guardianConcern({...base,state:'completed',recent:[{stage:'compaction',kind:'end',status:'failed'}]},1000)?.kind,'compaction');
  assert.equal(guardianConcern({...base,state:'completed',recent:[{stage:'compaction',kind:'end',status:'failed'},{stage:'compaction',kind:'end',status:'completed'}]},1000),null);
  assert.equal(guardianConcern({...base,state:'running',recent:[{stage:'compaction',kind:'end',status:'failed'},{stage:'run',kind:'start',id:'new'}]},1000),null);
});

test('a separate guardian process diagnoses a long tool while the host run remains active, carries auth only over stdin and stops cleanly', {timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'enigma-guardian-')),guardian=new GuardianProcess(root,'main-run');
  const secret='guardian-fixture-token',requests:{url:string;body:any}[]=[];
  const server=createServer(async(request,response)=>{
    assert.equal(request.headers.authorization,`Bearer ${secret}`);
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    requests.push({url:request.url!,body:JSON.parse(Buffer.concat(chunks).toString())});
    response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({answer:'Observed a long test; inspect output and keep current files.',action:'notify',basis:'actual stage',usedModel:false}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address==='object');
  const observer=await RunObserver.create(root,'main-run',{heartbeatMs:100});
  try{
    observer.record({kind:'start',stage:'run',id:'run'});observer.record({kind:'start',stage:'tool',id:'long-check',detail:'original verification'});await observer.flush();
    const launched=await guardian.start({mode:'assist',stageDeadlineMs:1000,maxInterventions:0,allowedActions:['notify']},{origin:`http://127.0.0.1:${address.port}`,token:secret,sessionPath:'/owned/main.jsonl'});
    assert(launched.pid&&launched.pid!==process.pid);
    const deadline=Date.now()+7000;while(!requests.length&&Date.now()<deadline)await delay(100);
    assert.equal(requests[0]?.url,'/api/enigma/guardian/diagnose');assert.equal(requests[0]?.body.sessionPath,'/owned/main.jsonl');
    assert.equal((await guardian.status())?.interventions,0);assert(observer.state.active.some(stage=>stage.stage==='tool'));
    assert(!(await readFile(join(root,'.enigma-next/guardians/main-run/config.json'),'utf8')).includes(secret));
    await guardian.stop();assert.equal((await guardian.status())?.phase,'stopped');
  }finally{await guardian.stop();await observer.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

test('guardian retries a temporarily unavailable host for the same concern and reports physical process loss', {timeout:20000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'enigma-guardian-reconnect-')),guardian=new GuardianProcess(root,'reconnect');
  let attempts=0;
  const server=createServer(async(request,response)=>{for await(const _ of request){}attempts++;if(attempts===1){response.writeHead(503);response.end();return;}response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({answer:'Recovered host, keep observing',action:'notify',usedModel:false}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address==='object');
  try{
    const launched=await guardian.start({mode:'assist',stageDeadlineMs:1000,maxInterventions:0,allowedActions:['notify']},{origin:`http://127.0.0.1:${address.port}`,token:'test-only',sessionPath:'/isolated/reconnect'});
    assert.equal((await guardian.status())?.pid,launched.pid,'start must wait for this worker readiness');
    const deadline=Date.now()+10000;while(attempts<2&&Date.now()<deadline)await delay(100);
    assert(attempts>=2,'unchanged concern must be retried after host recovers');
    assert(launched.pid);process.kill(launched.pid,'SIGKILL');
    const gone=Date.now()+3000;while((await guardian.status())?.processState!=='gone'&&Date.now()<gone)await delay(50);
    assert.equal((await guardian.status())?.processState,'gone');assert.equal((await guardian.status())?.phase,'host-unavailable');
  }finally{await guardian.stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

test('a replacement host cooperatively settles the old monitor before creating a new instance', {timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'enigma-guardian-restart-'));
  const first=new GuardianProcess(root,'restart'),second=new GuardianProcess(root,'restart');
  const server=createServer(async(request,response)=>{for await(const _ of request){}response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({answer:'Observe only',action:'notify',usedModel:false}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address==='object');
  const config={mode:'assist' as const,stageDeadlineMs:1000,maxInterventions:0,allowedActions:['notify' as const]},connection={origin:`http://127.0.0.1:${address.port}`,token:'restart-test',sessionPath:'/isolated/restart'};
  try{
    const a=await first.start(config,connection),old=(await first.status())!;
    const b=await second.start({...config,mode:'managed',maxInterventions:2},{...connection,interventions:2}),current=(await second.status())!;
    assert.notEqual(a.pid,b.pid);assert.notEqual(old.instanceId,current.instanceId);assert.equal(current.processState,'alive');
    assert.equal(current.interventions,2,'restored monitor retains intervention spending from its original host');
    assert.throws(()=>process.kill(a.pid!,0),/ESRCH/);
    await second.stop();assert.equal((await second.status())?.phase,'stopped');
  }finally{await second.stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
test('a lost action response retries the same receipt rather than dispatching the side effect again',{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'enigma-guardian-lost-reply-')),guardian=new GuardianProcess(root,'lost');let diagnoses=0,effects=0;const ids:string[]=[];
 const log=new GuardianActions(root,'lost');
 const server=createServer(async(request,response)=>{
  const parts:Buffer[]=[];for await(const part of request)parts.push(Buffer.from(part));const body=JSON.parse(Buffer.concat(parts).toString());
  if(request.url?.endsWith('/diagnose')){diagnoses++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({answer:'Observed missing collection',action:'notify',usedModel:false}));return;}
  ids.push(body.requestId);const result=await log.run(body.requestId,body,async()=>({message:`recorded-${++effects}`}));
  if(ids.length===1){response.destroy();return;}
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(result));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address==='object');
 try{
  await guardian.start({mode:'managed',stageDeadlineMs:1000,maxInterventions:1,allowedActions:['notify']},{origin:`http://127.0.0.1:${address.port}`,token:'fixture',sessionPath:'/isolated/lost'});
  const until=Date.now()+10000;while(ids.length<2&&Date.now()<until)await delay(100);
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(effects,1);assert.equal(diagnoses,1);
 }finally{await guardian.stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
test('restarting after an interrupted action request recovers the pending request id without repeating its side effect',{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'enigma-guardian-pending-restart-')),first=new GuardianProcess(root,'restart-pending'),second=new GuardianProcess(root,'restart-pending');
 const log=new GuardianActions(root,'restart-pending');let effects=0;const ids:string[]=[];
 const server=createServer(async(request,response)=>{
  const parts:Buffer[]=[];for await(const part of request)parts.push(Buffer.from(part));const body=JSON.parse(Buffer.concat(parts).toString());
  if(request.url?.endsWith('/diagnose')){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({answer:'Observed missing collection',action:'notify',usedModel:false}));return;}
  ids.push(body.requestId);const result=await log.run(body.requestId,body,async()=>({message:'saved',interventions:++effects}));
  if(ids.length===1)return; // Intentionally keep the response pending until the monitor is killed.
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(result));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address==='object');
 const config={mode:'managed' as const,stageDeadlineMs:1000,maxInterventions:1,allowedActions:['notify' as const]},connection={origin:`http://127.0.0.1:${address.port}`,token:'fixture',sessionPath:'/isolated/pending'};
 try{
  const launched=await first.start(config,connection);const until=Date.now()+5000;while(!effects&&Date.now()<until)await delay(50);assert.equal(effects,1);
  process.kill(launched.pid!,'SIGKILL');const gone=Date.now()+2000;while((await first.status())?.processState!=='gone'&&Date.now()<gone)await delay(25);
  await second.start(config,{...connection,interventions:1,restorePendingActions:true});
  const settled=Date.now()+6000;while(ids.length<2&&Date.now()<settled)await delay(50);
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(effects,1);assert.equal((await second.status())?.interventions,1);
 }finally{await second.stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
