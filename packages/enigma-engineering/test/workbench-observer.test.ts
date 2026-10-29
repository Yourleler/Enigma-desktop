import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {RunObserver} from '../src/observer.js';
import {Workspace} from '../src/workspace.js';
import {WorkbenchSession} from '../src/workbench-session.js';
import {runProcess} from '../src/process.js';

test('native workbench operations report command activity into the original session observer and finish on cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'enigma-workbench-observer-')),workspace=await Workspace.open(root),observer=await RunObserver.create(root,'main');
 try{
  workspace.activity=event=>RunObserver.recordForSession(root,'main',event);
  const controller=new WorkbenchSession({session:'main'} as any,{workspace,emit:()=>{},persist:async()=>{}} as any);
  controller.snapshot=()=>({idle:!controller.operation||controller.operation.state!=='running'}) as any;
  controller.runtime={session:{sessionManager:{appendCustomMessageEntry:()=>{}},refreshContext:()=>{},abort:async()=>{},waitForIdle:async()=>{}}} as any;
  let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
  const work=controller.perform('验证示例',async signal=>{started();return runProcess([process.execPath,'-e','setInterval(()=>{},1000)'],root,{signal,timeoutMs:10000});});
  await entered;assert.equal(observer.state.state,'running');assert(observer.state.active.some(stage=>stage.stage==='workbench'));
  await controller.cancel();await work;assert.equal(observer.state.state,'aborted');assert.equal(observer.state.active.length,0);
  assert(observer.state.recent.some(event=>event.stage==='process'));
  const other=await RunObserver.create(root,'other');try{RunObserver.recordForSession(root,'main',{kind:'fact',stage:'source.read',reference:'main-only'});assert(!other.state.recent.some(event=>event.reference==='main-only'));}finally{await other.close();}
 }finally{await observer.close();await rm(root,{recursive:true,force:true});}
});

test('closing an older observer cannot disconnect its replacement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'enigma-observer-replace-')),old=await RunObserver.create(root,'same'),current=await RunObserver.create(root,'same');
 try{await old.close();RunObserver.recordForSession(root,'same',{kind:'start',stage:'run',id:'replacement'});assert.equal(current.state.run,'replacement');assert.equal(old.state.run,undefined);}
 finally{await current.close();await rm(root,{recursive:true,force:true});}
});
