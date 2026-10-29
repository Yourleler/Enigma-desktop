import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { BackgroundRuns } from '../src/background.js';
import { TaskEvents } from '../src/task-events.js';
import { ServiceManager } from '../src/services.js';
import {TaskAcceptance} from '../src/task-acceptance.js';

test('a separate wait worker publishes one real command result without holding the operation lock', async () => {
  const { root, workspace } = await fixture(), runs = new BackgroundRuns(workspace), waits = new TaskEvents(workspace);
  try {
    const command = await runs.start({ repo: 'library', label: 'waiting example', task: 'task-a', argv: [process.execPath, '-e', 'setTimeout(()=>console.log("actual result"),500)'] });
    const watch = await waits.start({ label: 'Continue after command', task: 'task-a', entry: 'source-entry', condition: { kind: 'background', run: command.spec.id }, pollMs: 250, resume: true, timeoutMs: 10000 });
    await workspace.exclusive(() => workspace.checkpoint('during wait'));
    const deadline = Date.now() + 15000; let events = await waits.events('task-a');
    while (!events.length && Date.now() < deadline) { await delay(50); events = await waits.events('task-a'); }
    assert.equal(events.length, 1); assert.equal(events[0]?.watch, watch.id); assert.equal(events[0]?.outcome, 'completed'); assert(JSON.stringify(events[0]?.result).includes('actual result'));
    await delay(500); assert.equal((await waits.events('task-a')).length, 1);
    assert.equal((await waits.events('task-b')).length, 0);
    await waits.markDelivery(events[0]!, 'prepared'); assert.equal((await waits.delivery(events[0]!))?.state, 'prepared');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('wait cancellation and timeout produce explicit terminal outcomes without claiming the service is ready', async () => {
  const { root, workspace } = await fixture(), services = new ServiceManager(workspace), waits = new TaskEvents(workspace);
  try {
    await services.add({ id: 'future', repo: 'library', label: 'Not started', argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], readiness: { type: 'log', includes: 'ready' } });
    const timed = await waits.start({ label: 'Timed wait', task: 'task', condition: { kind: 'service', service: 'future', state: 'ready' }, timeoutMs: 400, pollMs: 250 });
    const cancelled = await waits.start({ label: 'Cancelled wait', task: 'task', condition: { kind: 'service', service: 'future', state: 'ready' }, timeoutMs: 5000, pollMs: 250 });
    await waits.cancel(cancelled.id, 'task');
    const deadline = Date.now() + 10000; let results = await waits.events('task');
    while (results.length < 2 && Date.now() < deadline) { await delay(50); results = await waits.events('task'); }
    assert.equal(results.find(event => event.watch === timed.id)?.outcome, 'timeout');
    assert.equal(results.find(event => event.watch === cancelled.id)?.outcome, 'cancelled');
    assert.equal((await services.status('future')).ready, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('cancelling a long-poll wait is prompt and never requests automatic continuation',async()=>{
 const {root,workspace}=await fixture(),services=new ServiceManager(workspace),waits=new TaskEvents(workspace);let watch:string|undefined;
 try{
  await services.add({id:'future',repo:'library',label:'future',argv:[process.execPath,'-e','setInterval(()=>{},1000)'],readiness:{type:'log',includes:'ready'}});
  watch=(await waits.start({label:'long interval',task:'owned',condition:{kind:'service',service:'future',state:'ready'},pollMs:60000,timeoutMs:120000,resume:true})).id;
  const deadline=Date.now()+3000;while(!(await waits.status(watch)).workerCurrent&&Date.now()<deadline)await delay(20);
  const before=Date.now(),cancelled=await waits.cancel(watch,'owned');assert.equal(cancelled.state.status,'cancelled');assert(Date.now()-before<3000);assert.equal((await services.status('future')).ready,false);
  const until=Date.now()+2000;while(!(await waits.events('owned')).length&&Date.now()<until)await delay(20);assert.equal((await waits.events('owned'))[0]?.resume,false);assert.equal(await waits.cancelled(watch),true);
 }finally{if(watch)await waits.cancel(watch).catch(()=>{});await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
test('a killed wait worker is reported interrupted and blocks required continuation acceptance until explicitly cancelled',async()=>{
 const {root,workspace}=await fixture(),services=new ServiceManager(workspace),waits=new TaskEvents(workspace);let watch:string|undefined;
 try{
  await services.add({id:'future',repo:'library',label:'future',argv:[process.execPath,'-e','setInterval(()=>{},1000)'],readiness:{type:'log',includes:'ready'}});
  watch=(await waits.start({label:'required follow-up',task:'owned',condition:{kind:'service',service:'future',state:'ready'},pollMs:60000,timeoutMs:120000,resume:true})).id;
  const deadline=Date.now()+3000;let state=await waits.status(watch);while(!state.workerCurrent&&Date.now()<deadline){await delay(20);state=await waits.status(watch);}
  assert(state.workerCurrent);process.kill(state.state.workerPid,'SIGKILL');const gone=Date.now()+3000;while((await waits.status(watch)).runtimeState!=='interrupted'&&Date.now()<gone)await delay(20);
  assert.equal((await waits.status(watch)).runtimeState,'interrupted');
  const acceptance=new TaskAcceptance(workspace,'owned'),notes=[{id:'request',text:'Return after required follow-up'}];await acceptance.resolve(notes,{id:'request',assessment:'not-applicable',reason:'Fixture checks mechanical pending work even if model claims no work'});
  assert((await acceptance.inspect(notes)).gaps.includes(`wait:${watch}`));await waits.cancel(watch,'owned');assert(!(await acceptance.inspect(notes)).gaps.includes(`wait:${watch}`));
 }finally{if(watch)await waits.cancel(watch).catch(()=>{});await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
test('a short timeout does not wait through a longer polling interval',async()=>{
 const{root,workspace}=await fixture(),waits=new TaskEvents(workspace);let id:string|undefined;
 try{
  await new ServiceManager(workspace).add({id:'future',repo:'library',label:'future',argv:[process.execPath,'-e','setInterval(()=>{},1000)'],readiness:{type:'log',includes:'ready'}});
  const started=Date.now();id=(await waits.start({task:'owned',label:'short deadline',condition:{kind:'service',service:'future',state:'ready'},timeoutMs:300,pollMs:60000})).id;
  while((await waits.status(id)).state.status==='waiting'&&Date.now()-started<3000)await delay(25);
  assert.equal((await waits.status(id)).state.status,'timeout');assert(Date.now()-started<3000);
 }finally{if(id)await waits.cancel(id).catch(()=>{});await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
