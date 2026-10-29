import assert from 'node:assert/strict';
import test from 'node:test';
import {rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from './fixtures.js';
import {ServiceManager} from '../src/services.js';
import {BackgroundRuns} from '../src/background.js';
import {evaluateWait} from '../src/task-events.js';
import {domainAction} from '../src/workbench-domain.js';
import {processIdentity} from '../src/observer.js';
import {projectOverview} from '../src/project-overview.js';
const ctx=(workspace:any)=>({options:{workspace},chat:{session:'task'},runtime:{session:{sessionManager:{getLeafId:()=>undefined,getBranch:()=>[]}}}}) as any;

test('service readiness timeout persists across fresh reads while later readiness remains meaningful',async()=>{
 const {root,workspace}=await fixture(),services=new ServiceManager(workspace);
 try{
  await writeFile(join(root,'app','slow.cjs'),'console.log("BOOTING");setTimeout(()=>console.log("READY"),2500);setInterval(()=>{},1000);');
  await services.add({id:'slow',repo:'app',label:'slow',argv:[process.execPath,'slow.cjs'],readiness:{type:'log',includes:'READY',timeoutMs:150}});
  assert.equal((await services.start('slow')).status,'readiness-timeout');assert.equal((await services.list())[0]?.status,'readiness-timeout');assert.equal((await evaluateWait(workspace,{kind:'service',service:'slow',state:'ready'})).failed,true);
  assert.equal((await evaluateWait(workspace,{kind:'service',service:'slow',state:'stopped'})).done,false);
  await assert.rejects(services.start('slow'),/重启/);
  const deadline=Date.now()+4000;let status=await services.status('slow');while(!status.ready&&Date.now()<deadline){await delay(50);status=await services.status('slow');}assert.equal(status.ready,true);
  await services.stop('slow');assert.equal((await services.status('slow')).executionTerminal,true);
  const stopped=await evaluateWait(workspace,{kind:'service',service:'slow',state:'stopped'});assert.equal(stopped.done,true);assert.equal(stopped.failed,false);
  const neverReady=await evaluateWait(workspace,{kind:'service',service:'slow',state:'ready'});assert.equal(neverReady.done,true);assert.equal(neverReady.failed,true);
 }finally{await services.stop('slow').catch(()=>{});await rm(root,{recursive:true,force:true});}
});
test('workbench service edits are version-bound and invalid command data fails before persistence',async()=>{
 const {root,workspace}=await fixture(),services=new ServiceManager(workspace),controller=ctx(workspace),signal=new AbortController().signal;
 try{
  const input={id:'app',repo:'app',label:'first',argv:[process.execPath,'-e','console.log("READY")'],readiness:{type:'log' as const,includes:'READY'}};
  await domainAction(controller,'service-add',input,signal);const original=await services.status('app');
  await assert.rejects(domainAction(controller,'service-add',{...input,label:'unsafe overwrite'},signal),/同名/);
  await domainAction(controller,'service-add',{...input,label:'new',version:original.configuration},signal);
  await assert.rejects(domainAction(controller,'service-add',{...input,label:'stale',version:original.configuration},signal),/配置已变化/);assert.equal((await services.status('app')).service.label,'new');
  await assert.rejects(services.add({...input,id:'invalid',argv:['node',null as any]}),/Invalid service/);
  workspace.secrets.push('fixture-service-secret');await assert.rejects(services.add({...input,id:'secret',argv:['echo','fixture-service-secret']}),/environment references/);
  assert.equal((await services.definitions()).length,1);assert(!(await readFile(join(workspace.data,'services.json'),'utf8')).includes('fixture-service-secret'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unknown service writers cannot be replaced and exact reconciliation stays visible',async()=>{
 const {root,workspace}=await fixture(),services=new ServiceManager(workspace),background=new BackgroundRuns(workspace);let commandPid:number|undefined;
 try{
  const input={id:'owned',repo:'app',label:'owned',argv:[process.execPath,'-e','console.log("READY");setInterval(()=>{},1000)'],readiness:{type:'log' as const,includes:'READY'}};
  await services.add(input);const running=await services.start(input.id);assert('run' in running&&running.run);const state=await background.status(running.run);commandPid=state.state.childPid;assert(commandPid);
  process.kill(state.state.workerPid,'SIGKILL');while((await processIdentity(state.state.workerPid)).state==='alive')await delay(20);
  await assert.rejects(services.add({...input,label:'replace unknown'}),/未知/);await assert.rejects(background.acknowledge(running.run,'parent exited only'),/may still be active/);
  process.kill(-commandPid,'SIGKILL');const deadline=Date.now()+5000;while((await processIdentity(commandPid)).state==='alive'&&Date.now()<deadline)await delay(20);
  await background.acknowledge(running.run,'worker and child exited; no file edits');const acknowledged=await background.status(running.run);assert.equal(acknowledged.reconciled,true);assert.equal(acknowledged.state.status,'unknown');assert.equal((await background.unresolved()).length,0);
  assert(!(await projectOverview(workspace)).blockers.some(item=>item.includes(running.run)));
  await writeFile(join(await background.directory(running.run),'reconciled.json'),JSON.stringify({id:running.run,fingerprint:'wrong',at:'now',observation:'forged'}));assert.equal((await background.status(running.run)).reconciled,false);assert.equal((await background.unresolved()).length,1);
 }finally{if(commandPid)try{process.kill(-commandPid,'SIGKILL');}catch{}await rm(root,{recursive:true,force:true});}
});
