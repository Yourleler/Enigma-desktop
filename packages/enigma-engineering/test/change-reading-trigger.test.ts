import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {fixture} from './fixtures.js';
import {git} from '../src/process.js';
import {createChangeReadingExtension} from '../src/pi-change-reading.js';
import {gitReadingKind,publicationSource} from '../src/change-reading-trigger.js';
import {ChangeReadings} from '../src/change-reading.js';

test('Git trigger detects the actual subcommand, not a commit word in a search or file path',()=>{
 assert.equal(gitReadingKind(['git','log','--grep','commit']),null);
 assert.equal(gitReadingKind(['git','-c','user.name=example','commit','-m','add docs']),'commit');
 assert.equal(gitReadingKind(['git','-C','commit','add','file']),'staged');
 assert.equal(publicationSource({input:{kind:'staged'}}).kind,'staged');
});

test('automatic staged reading freezes physical source and avoids duplication after an explicit publication',async()=>{
 const {root,workspace}=await fixture();const hooks=new Map<string,Function>();const entries:any[]=[];
 const pi:any={on:(name:string,fn:Function)=>hooks.set(name,fn),events:{emit(){}},getActiveTools:()=>[],setActiveTools(){},registerTool(){},registerCommand(){},appendEntry:(type:string,data:any)=>entries.push({type,data})};
 const ctx:any={cwd:root,signal:new AbortController().signal,model:{id:'controlled'},modelRegistry:{streamSimple:()=>({result:async()=>({stopReason:'stop',content:[{type:'text',text:'{"chapters":[],"insights":[]}' }]})})},sessionManager:{getSessionId:()=> 'automatic-test',getBranch:()=>[{type:'message',message:{role:'user',content:'Review greet return value'}}]}};
 try{
  for(const repo of workspace.config.repos){await git(repo.root,['add','.']);await git(repo.root,['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','baseline']);}
  createChangeReadingExtension({workspace})(pi);await hooks.get('session_start')!({},ctx);
  const file=join(root,'library','index.js');const original=await readFile(file,'utf8');await writeFile(file,original.replace('v1','v2'));await git(join(root,'library'),['add','index.js']);
  hooks.get('tool_execution_end')!({toolName:'repo_stage',result:{details:{argv:['git','add','index.js'],status:'passed'}}});
  await hooks.get('turn_end')!({},ctx);
  const latest=await new ChangeReadings(workspace).latest('automatic-test');assert(latest);assert.equal(latest.record.input.kind,'staged');assert(latest.record.changes.some(c=>c.patch?.includes('v2')));
  const count=entries.length;
  hooks.get('tool_execution_end')!({toolName:'repo_stage',result:{details:{argv:['git','add','index.js'],status:'passed'}}});
  hooks.get('tool_execution_end')!({toolName:'change_reading',result:{details:{input:{kind:'staged'}}}});
  assert.equal(await hooks.get('turn_end')!({},ctx),undefined);assert.equal(entries.length,count);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unavailable MR identity is a visible reading failure, not a failed source operation or inferred revision',async()=>{
 const {root,workspace}=await fixture();const hooks=new Map<string,Function>(),entries:any[]=[];
 const pi:any={on:(name:string,fn:Function)=>hooks.set(name,fn),events:{emit(){}},getActiveTools:()=>[],setActiveTools(){},registerTool(){},registerCommand(){},appendEntry:(type:string,data:any)=>entries.push({type,data})};
 const ctx:any={cwd:root,signal:new AbortController().signal,sessionManager:{getSessionId:()=> 'mr-test',getBranch:()=>[]}};
 try{
  createChangeReadingExtension({workspace})(pi);await hooks.get('session_start')!({},ctx);
  hooks.get('tool_execution_end')!({toolName:'repo_run',result:{details:{argv:['gh','pr','create'],status:'passed',output:'https://github.com/example/unregistered/pull/12'}}});
  const result=await hooks.get('turn_end')!({},ctx);assert.equal(entries[0].data.status,'failed');assert.equal(result.entries[0].display,true);assert(result.entries[0].content.includes('文件保持原样'));
 }finally{await rm(root,{recursive:true,force:true});}
});
