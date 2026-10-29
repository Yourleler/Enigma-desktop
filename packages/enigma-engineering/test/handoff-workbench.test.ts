import assert from 'node:assert/strict';
import test from 'node:test';
import {rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './fixtures.js';
import {MemoryStore} from '../src/memory.js';
import {exportHandoff,inspectHandoff} from '../src/handoff.js';
import {domainAction} from '../src/workbench-domain.js';
import {writeJson} from '../src/storage.js';

test('handoff manifest scope does not authorize the recipient to read private source memories',async()=>{
 const {root,workspace}=await fixture();
 try{
  const access={session:'source-task',entries:['entry-a']},store=await MemoryStore.open(workspace),memory=await store.save({kind:'contract',title:'私有契约',content:'PRIVATE_SOURCE_BODY',scope:{type:'task',session:'source-task',entry:'entry-a'},origin:{kind:'user',reference:'user'}},{userStated:true,access});
  const directory=join(root,'handoff');await exportHandoff(workspace,directory,{mode:'continue',goal:'继续',source:{agent:'pi',session:'source-task'},notes:[],memories:[memory.id],memoryAccess:access});
  const own=await inspectHandoff(workspace,directory,{memoryAccess:access});assert.equal(own.memories[0]?.state,'current');assert.equal(own.memories[0]?.summary,'PRIVATE_SOURCE_BODY');
  const other=await inspectHandoff(workspace,directory,{memoryAccess:{session:'other',entries:['entry-a']}});assert.equal(other.memories[0]?.state,'omitted');assert(!JSON.stringify(other).includes('PRIVATE_SOURCE_BODY'));
  assert.equal((await inspectHandoff(workspace,directory)).memories[0]?.state,'omitted');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('continuation export carries pending original requirements, while background excludes the old plan',async()=>{
 const {root,workspace}=await fixture();
 try{
  const user={id:'u',type:'message',message:{role:'user',content:'原用户要求不能遗漏'}},assistant={id:'a',type:'message',message:{role:'assistant',content:'已核对调用关系'}};
  const controller={options:{workspace},chat:{session:'task'},runtime:{session:{sessionManager:{getLeafId:()=> 'a',getBranch:()=>[user,assistant],getEntry:(id:string)=>id==='u'?user:assistant,getSessionId:()=> 'task'}}}} as any;
  await writeJson(join(workspace.data,'session-task.json'),{schema:1,requirements:['此前保留要求'],requirementEntries:['u'],reviewEntries:['u'],requests:3});
  const result=await domainAction(controller,'handoff-export',{goal:'继续原工作',mode:'continue',entries:['a'],destination:join(root,'continue')},new AbortController().signal) as any;
  assert.equal(result.handoffExport,true);assert(result.manifest.notes.some((note:any)=>note.text==='原用户要求不能遗漏'&&note.kind==='requirement'));assert(result.document.includes('此前保留要求'));assert.equal(result.document,await readFile(result.documentPath,'utf8'));
  await writeFile(join(root,'sdk','index.js'),'export const changed=true;');
  const inspection=await domainAction(controller,'handoff-inspect',{directory:result.directory},new AbortController().signal) as any;assert.equal(inspection.safeToContinue,false);assert(inspection.code.some((repo:any)=>repo.state==='changed'));
  const background=await domainAction(controller,'handoff-export',{goal:'另一个任务',mode:'background',entries:['a'],destination:join(root,'background')},new AbortController().signal) as any;assert.equal(background.manifest.plan,undefined);assert.equal(background.manifest.notes.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
