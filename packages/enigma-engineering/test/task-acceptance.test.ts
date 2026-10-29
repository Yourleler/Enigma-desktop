import assert from 'node:assert/strict';
import {rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {fixture} from './fixtures.js';
import {TaskAcceptance} from '../src/task-acceptance.js';
import {BackgroundRuns} from '../src/background.js';
import {hash} from '../src/storage.js';
test('routine operation receipts do not inflate goals, while failed operations, edited requests and goal-bearing inputs remain reviewable',async()=>{
 const {root,workspace}=await fixture();try{
  const store=new TaskAcceptance(workspace,'typed'),notes=[{id:'goal',text:'保留接口兼容性'},{id:'read',text:'查看当前代码'},{id:'failed',text:'运行检查'},{id:'new-goal',text:'计划目标：更新迁移指南'}];
  const request=(entry:string,goal:boolean,state:string,outcome?:string)=>({entry,sourceHash:hash(notes.find(note=>note.id===entry)!.text),operation:`op-${entry}`,action:'fixture',title:entry,goal,state,outcome});
  const requests=[request('read',false,'completed'),request('failed',false,'completed','failed'),request('new-goal',true,'completed')];
  const evidence=await workspace.evidence('reading',{});await store.resolve(notes,{id:'goal',assessment:'addressed',reason:'Current source was inspected',evidence:[evidence.id]});
  const first=await store.inspect(notes,{workbenchRequests:requests});assert.deepEqual(first.requirements.map(item=>item.id),['goal','new-goal']);assert.equal(first.operationRequests[0]?.current,true);assert.equal(first.operationRequests[1]?.current,false);assert(first.gaps.includes('workbench:failed'));assert(first.gaps.includes('requirement:new-goal'));assert.equal(first.readyForReview,false);
  const edited=await store.inspect(notes.map(note=>note.id==='read'?{...note,text:'查看当前代码，并实现重构'}:note),{workbenchRequests:requests});assert(edited.requirements.some(item=>item.id==='read'));
  const onlyClicks=await store.inspect([notes[1]!],{workbenchRequests:requests});assert.equal(onlyClicks.readyForReview,false);assert(onlyClicks.gaps.includes('requirements:no-task-goal'));await assert.rejects(store.receipt([notes[1]!],{workbenchRequests:requests}),/unresolved/);
  const cancelled=await store.inspect([notes[2]!],{workbenchRequests:[request('failed',false,'completed','cancelled')]});assert.equal(cancelled.operationRequests[0]?.current,false);
  await store.resolve(notes,{id:'failed',assessment:'not-applicable',reason:'Controlled failed attempt was replaced; actual task evidence is checked separately.'});
  assert.equal((await store.inspect(notes,{workbenchRequests:requests})).operationRequests[1]?.current,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing original verification and unresolved effects remain readable blockers instead of crashing the acceptance panel',async()=>{
 const {root,workspace}=await fixture();try{
  await workspace.addCheck({id:'syntax',repo:'library',argv:[process.execPath,'--check','index.js']});
  const store=new TaskAcceptance(workspace,'task'),notes=[{id:'user',text:'Keep the source valid'}],verification=await workspace.verify();
  await store.resolve(notes,{id:'user',assessment:'addressed',reason:'Syntax checked',evidence:[verification.evidence]});
  await rm(join(workspace.data,'evidence',verification.evidence+'.json'));
  const missing=await store.inspect(notes,{verification:verification.evidence});assert.equal(missing.readyForReview,false);assert(missing.verificationIssue);assert(missing.gaps.includes('verification:unavailable'));assert(missing.requirements[0]?.problems.some(x=>x.includes('unavailable')));
  const next=await workspace.verify();await writeFile(join(workspace.data,'operations','unknown.json'),JSON.stringify({schema:1,id:'unknown',operation:'command',status:'unknown'}));
  const pending=await store.inspect(notes,{verification:next.evidence});assert.equal(pending.readyForReview,false);assert(pending.gaps.includes('operation:unknown'));assert(pending.verificationIssue);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('completion reconciles every original update and actual check evidence, retaining falsified assumptions',async()=>{
  const {root,workspace}=await fixture();try{
    await workspace.addCheck({id:'consumer',repo:'app',joint:true,argv:[process.execPath,'--input-type=module','-e','import {main} from "./index.js";if(main()!=="v1")process.exit(1);']});
    const store=new TaskAcceptance(workspace,'task'),notes=[{id:'user-1',text:'Preserve string API and verify consumer.'},{id:'user-2',text:'Keep migration documentation.'}];
    const hypothesis=await store.assumption({text:'The current consumer accepts a string.',failureCondition:'Actual app consumer does not return v1.'});
    await assert.rejects(store.receipt(notes),/unresolved/);
    const verification=await workspace.verify();assert.equal(verification.status,'verified');
    await store.testAssumption(hypothesis.id,'supported',verification.evidence,'Actual consumer check passed with string output.');
    await store.resolve(notes,{id:'user-1',assessment:'addressed',reason:'Current source verified by actual consumer check',evidence:[verification.evidence]});
    const first=await store.inspect(notes,{verification:verification.evidence});assert.equal(first.readyForReview,false);assert(first.gaps.includes('requirement:user-2'));
    await store.resolve(notes,{id:'user-2',assessment:'not-applicable',reason:'This fixture original request has no requested source documentation change; retain as explicit coverage assessment.'});
    assert.equal((await store.receipt(notes,{verification:verification.evidence})).assessment.readyForReview,true);
    await writeFile(join(root,'library/index.js'),'export function greet(){return {value:"v1"};}\n');const stale=await store.inspect(notes,{verification:verification.evidence});assert.equal(stale.readyForReview,false);assert(stale.gaps.includes('original-checks:not-currently-verified'));
    await assert.rejects(store.resolve(notes,{id:'forged',assessment:'not-applicable',reason:'discard'}),/original user/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('repeated requirement evidence is checked once per inspection and source changes during the inspection block completion',async()=>{
 const {root,workspace}=await fixture();try{
  const store=new TaskAcceptance(workspace,'consistent'),notes=[{id:'one',text:'Keep original source'},{id:'two',text:'Keep original consumer'}],evidence=await workspace.evidence('reading',{});
  for(const note of notes)await store.resolve(notes,{id:note.id,assessment:'addressed',reason:'Original source observed',evidence:[evidence.id]});
  const original=workspace.evidenceStatus.bind(workspace);let checks=0;workspace.evidenceStatus=async id=>{checks++;return original(id);};
  const stable=await store.inspect(notes);assert.equal(stable.readyForReview,true);assert.equal(checks,1);
  checks=0;workspace.evidenceStatus=async id=>{const result=await original(id);if(++checks===1)await writeFile(join(root,'library/index.js'),'export function greet(){return "changed";}');return result;};
  const changed=await store.inspect(notes);assert.equal(changed.readyForReview,false);assert.equal(changed.sourceStable,false);assert(changed.gaps.includes('source:changed-during-acceptance'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a still-running task command prevents completion even without a separate wait registration',async()=>{
 const{root,workspace}=await fixture(),runs=new BackgroundRuns(workspace);let id:string|undefined;
 try{
  const command=await runs.start({repo:'library',task:'owned',label:'unfinished',argv:[process.execPath,'-e','setInterval(()=>{},1000)'],maxRuntimeMs:10000});id=command.spec.id;
  const acceptance=new TaskAcceptance(workspace,'owned'),notes=[{id:'user',text:'Finish the background work'}];await acceptance.resolve(notes,{id:'user',assessment:'not-applicable',reason:'Testing that mechanical unfinished work cannot be dismissed'});
  const pending=await acceptance.inspect(notes);assert.equal(pending.readyForReview,false);assert(pending.gaps.includes(`command:${id}`));
  await runs.cancel(id,'owned');assert(!(await acceptance.inspect(notes)).gaps.includes(`command:${id}`));
 }finally{if(id){await runs.cancel(id).catch(()=>{});await runs.drain(id).catch(()=>{});}await rm(root,{recursive:true,force:true});}
});
