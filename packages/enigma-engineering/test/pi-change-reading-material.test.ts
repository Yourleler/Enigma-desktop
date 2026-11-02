import assert from 'node:assert/strict';
import {writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {fixture} from './fixtures.js';
import {createChangeReadingExtension} from '../src/pi-change-reading.js';
import {explainReadingMaterial} from '../src/reading-material.js';
import {git} from '../src/process.js';
import {ChangeReadings} from '../src/change-reading.js';

test('Pi tool sends all files beyond the old caps and retains valid batches on a later failure',async()=>{
 const {root,workspace}=await fixture();
 try{
  for(let i=0;i<139;i++)await writeFile(join(root,'library',`note-${i}.md`),`# Contract ${i}\n\n${('Quoted "reference" 中文; preserve caller compatibility.\n').repeat(15)}`);
  const hooks=new Map<string,Function>();let tool:any;
  const pi:any={on:(name:string,fn:Function)=>hooks.set(name,fn),events:{emit(){}},getActiveTools:()=>[],setActiveTools(){},registerTool:(value:any)=>{tool=value;},registerCommand(){},appendEntry(){}};
  const batches:any[]=[];let failAt=Infinity;
  const ctx:any={cwd:root,signal:new AbortController().signal,model:{id:'controlled',contextWindow:64000},modelRegistry:{streamSimple:(_model:any,input:any)=>({result:async()=>{
   const prompt=input.messages[0].content[0].text;
   const batch=JSON.parse(prompt.slice(prompt.indexOf('\n')+1));batches.push(batch);
   return {stopReason:'stop',content:[{type:'text',text:batches.length===failAt?'invalid-json':JSON.stringify({chapters:batch.nodes.length?[{title:'Source behavior',summary:'Only the supplied references were provided.',nodes:[batch.nodes[0].id]}]:[],insights:[]})}]};
  }})},sessionManager:{getSessionId:()=> 'pi-material',getBranch:()=>[]}};
  createChangeReadingExtension({workspace})(pi);await hooks.get('session_start')!({},ctx);
  const result=await tool.execute('call',{action:'build',kind:'working',goal:'Read every changed contract'},ctx.signal,()=>{},ctx);
  assert.equal(result.details.status,'ready',result.details.error);
  assert(batches.length>1&&batches.length<=12);
  const sent=new Set(batches.flatMap(batch=>batch.changes.map((file:any)=>file.file)));
  for(let i=0;i<139;i++)assert(sent.has(`note-${i}.md`));
  assert.equal(result.details.reading.modelCoverage.changes,result.details.changes.length);
  assert.equal(result.details.reading.modelCoverage.nodes,result.details.reading.nodes.length);
  assert.equal(result.details.reading.modelCoverage.status,'complete');

  batches.length=0;failAt=2;
  const failed=await tool.execute('fail',{action:'build',kind:'working',goal:'Keep partial results on failure'},ctx.signal,()=>{},ctx);
  assert.equal(failed.details.status,'failed');assert.equal(failed.isError,true);
  assert.equal(failed.details.reading.modelCoverage.completedRequests,1);
  assert.equal(failed.details.reading.modelCoverage.status,'partial');
  assert(failed.details.reading.chapters.length>0);
  const reopened=await new ChangeReadings(workspace).latest('pi-material');
  assert.equal(reopened?.record.status,'failed');
  assert.equal(reopened?.record.reading?.nodes.length,failed.details.reading.nodes.length);
  for(const repo of workspace.config.repos)await git(repo.root,['add','.']);
  batches.length=0;failAt=1;
  hooks.get('tool_execution_end')!({toolName:'repo_run',result:{details:{argv:['git','add','.'],status:'passed'}}});
  const automatic=await hooks.get('turn_end')!({},ctx);
  assert.equal(automatic.entries[0].display,true);assert(automatic.entries[0].content.includes('解读未完成'));
  hooks.get('tool_execution_end')!({toolName:'repo_run',result:{details:{argv:['git','add','.'],status:'passed'}}});
  hooks.get('tool_execution_end')!({toolName:'change_reading',isError:true,result:{details:{input:{kind:'staged'},status:'failed'}}});
  assert.equal(await hooks.get('turn_end')!({},ctx),undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('a model budget rejection dispatches no request and a cancelled batch stops continuation',async()=>{
 const report:any={schema:1,nodes:[{id:'n',role:'implementation',source:{repo:'r',file:'sample.ts',line:1,snippet:'export const answer=1;'}}],edges:[],chapters:[],insights:[]};let called=0;
 await assert.rejects(explainReadingMaterial(report,[],{onRequest:async()=>{throw Error('budget exhausted');},request:async()=>{called++;return '{}';}}),/budget exhausted/);
 assert.equal(called,0);
 const controller=new AbortController();
 await assert.rejects(explainReadingMaterial(report,[],{signal:controller.signal,request:async({signal})=>{assert.equal(signal.aborted,false);called++;controller.abort();return '{"chapters":[],"insights":[]}';}}));
 assert.equal(called,1);
});
