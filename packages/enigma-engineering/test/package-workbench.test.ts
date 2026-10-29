import assert from 'node:assert/strict';
import {access,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {fixture} from './fixtures.js';
import {Workspace} from '../src/workspace.js';
import {TaskPackages} from '../src/task-package.js';
import {ProjectContext} from '../src/project-context.js';
import {domainAction} from '../src/workbench-domain.js';
import {hash,writeJson} from '../src/storage.js';
const controller=(workspace:Workspace)=>({options:{workspace},chat:{session:'launcher'},runtime:{session:{sessionManager:{getLeafId:()=>undefined,getBranch:()=>[]}}}}) as any;

test('export preserves pending original requirements without requiring an agent turn; execution remains blocked',async()=>{
 const {root,workspace}=await fixture();
 try{
  const entry={id:'latest',type:'message',message:{role:'user',content:[{type:'text',text:'保留最新接口要求'}]}},ctx=controller(workspace);
  ctx.runtime.session.sessionManager={getLeafId:()=>entry.id,getBranch:()=>[entry],getEntry:()=>entry,getSessionId:()=> 'launcher'};
  await writeJson(join(workspace.data,'session-launcher.json'),{schema:1,reviewEntries:['latest'],requirementEntries:['latest'],requirements:['原先保留的要求'],requests:0});
  const exported=await domainAction(ctx,'package-export',{goal:'交给新任务继续',entries:['latest']},new AbortController().signal) as any;
  assert(exported.manifest.notes.some((note:any)=>note.text==='保留最新接口要求'&&note.kind==='requirement'));assert(exported.manifest.notes.some((note:any)=>note.text==='原先保留的要求'));
  await assert.rejects(domainAction(ctx,'package-restore',{directory:exported.directory,destination:join(root,'not-created'),expectedManifest:exported.manifestHash},new AbortController().signal),/原用户要求未回读/);await assert.rejects(access(join(root,'not-created')),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a foreign task package restores its own repository scopes and private background into a new Pi task',async()=>{
 const {root,workspace}=await fixture();
 try{
  await workspace.addCheck({id:'original',repo:'app',argv:[process.execPath,'--check','index.js']});
  const material=await new ProjectContext(workspace).add({task:'source-task',title:'原用户要求',content:'保留跨仓接口兼容性。',source:{kind:'note',author:'user'}});
  const exported=await new TaskPackages(workspace).export({goal:'在独立目录继续任务',task:'source-task',source:{agent:'pi'},notes:[{role:'user',kind:'requirement',reference:'original-message',text:'保留跨仓接口兼容性。'}],resources:[material.id]});
  await mkdir(join(root,'launcher'));const launcher=await Workspace.open(join(root,'launcher')),ctx=controller(launcher),signal=new AbortController().signal;
  const inspected=await domainAction(ctx,'package-inspect',{directory:exported.directory},signal) as any;
  assert.equal(inspected.packageInspection,true);assert.equal(inspected.manifest.repos.length,3);
  const destination=join(root,'restored'),result=await domainAction(ctx,'package-restore',{directory:exported.directory,destination,expectedManifest:inspected.manifestHash,writeRepos:['sdk'],activateRuntime:true},signal) as any;
  assert.equal(result.packageRestored,true);assert.equal(result.session.sessionId.length>0,true);
  const target=await Workspace.open(destination);assert.equal(target.repo('sdk').access,'write');assert.equal(target.repo('app').access,'read');assert.equal(target.config.checks.length,1);
  const copied=await new ProjectContext(target).read(result.materials[0].target,{task:result.session.sessionId});assert(copied.content.includes('跨仓接口'));
  await assert.rejects(new ProjectContext(target).read(result.materials[0].target,{task:'foreign-task'}),/another task/);
  const state=JSON.parse(await readFile(join(target.data,`session-${result.session.sessionId}.json`),'utf8'));assert.equal(state.lastVerification,'unverified');
  assert.equal((await new TaskPackages(workspace).list('other-task')).items.length,0);assert.equal((await new TaskPackages(workspace).list('source-task')).items[0]?.goal,'在独立目录继续任务');
  assert.equal(await readFile(join(root,'library','index.js'),'utf8'),'export function greet() { return "v1"; }\n');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('changed previews and malformed runtime metadata fail before destination creation; failed exports remain clearly failed',async()=>{
 const {root,workspace}=await fixture();
 try{
  const store=new TaskPackages(workspace),exported=await store.export({goal:'原任务',task:'source-task',source:{agent:'pi'},notes:[]});
  const file=join(exported.directory,'manifest.json'),envelope=JSON.parse(await readFile(file,'utf8'));envelope.manifest.goal='后来改过的任务';envelope.hash=hash(JSON.stringify(envelope.manifest));await writeJson(file,envelope);
  await assert.rejects(TaskPackages.restore(exported.directory,join(root,'changed'),{expectedManifest:exported.manifestHash}),/预览后已变化/);await assert.rejects(access(join(root,'changed')),/ENOENT/);
  envelope.manifest.runtime.checks=undefined;envelope.hash=hash(JSON.stringify(envelope.manifest));await writeJson(file,envelope);
  await assert.rejects(TaskPackages.restore(exported.directory,join(root,'malformed')),/structure/);await assert.rejects(access(join(root,'malformed')),/ENOENT/);
  const secret='test-only-package-secret';workspace.secrets.push(secret);await writeFile(join(root,'library','credential.txt'),secret);
  await assert.rejects(store.export({goal:'应拒绝导出',task:'failed-task',source:{agent:'pi'},notes:[]}),/credential/);
  const listed=await store.list('failed-task');assert.equal(listed.items.length,1);assert.equal(listed.items[0]?.status,'failed');
 }finally{await rm(root,{recursive:true,force:true});}
});
