import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { GuardianProcess,guardianConcern } from '../src/guardian.js';
import { RunObserver } from '../src/observer.js';

test('guardian distinguishes missing observations, approval, repetition and long stages without auto rollback',()=>{
  assert.equal(guardianConcern({available:false},1000)?.kind,'observation');
  const base={available:true,sourceProcess:{liveness:'alive'},stages:[],signals:[]};
  assert.equal(guardianConcern({...base,stages:[{stage:'run',elapsedMs:100000}]},1000),null);
  assert.equal(guardianConcern({...base,stages:[{stage:'tool',elapsedMs:100000,label:'test'}]},1000)?.kind,'tool');
  assert.equal(guardianConcern({...base,stages:[{stage:'approval',elapsedMs:100000}]},1000)?.kind,'approval');
  assert.equal(guardianConcern({...base,signals:[{count:3,type:'same-source'}]},1000)?.kind,'repetition');
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
