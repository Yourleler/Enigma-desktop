import assert from 'node:assert/strict';
import { readFile,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { MemoryStore } from '../src/memory.js';
import { MemoryDreams } from '../src/memory-dream.js';
import { ProjectContext } from '../src/project-context.js';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const note=(title:string,content:string)=>({kind:'contract' as const,scope:{type:'repositories' as const,repos:['library','sdk']},title,content,appliesWhen:'library-v1 consumer migration',origin:{kind:'assistant' as const,reference:'source-reading'},sources:[{repo:'library',file:'index.js'},{repo:'sdk',file:'index.js'}]});
const answer=(sources:string[])=>JSON.stringify({candidates:[{title:'跨仓迁移记忆',kind:'contract',content:'library 接口由 sdk 消费，迁移后必须执行真实消费链验证。',appliesWhen:'这些来源仍对应当前 library 与 sdk 契约时',sources}],relations:sources.length>1?[{left:sources[0],right:sources[1],kind:'related',reason:'Both describe the same producer-consumer contract'}]:[]});

test('incremental dream publishes conditioned cross-repo candidates and deletion invalidates all derived recall',async()=>{
  const {root,workspace}=await fixture();try{
    const store=await MemoryStore.open(workspace),first=await store.save(note('上游契约','library 提供 greet 字符串接口。')),second=await store.save(note('下游调用','sdk 调用 library greet，验收应覆盖真实调用。'));
    const dreams=new MemoryDreams(workspace),run=await dreams.prepare([first.id,second.id]);let payload='';
    const ready=await dreams.execute(run.id,{},async(input)=>{payload=input;return answer([first.id,second.id]);});
    assert.equal(ready.status,'ready');assert(payload.includes(first.id)&&payload.includes(second.id));assert(!payload.includes('unrelated-secret'));
    assert(!(await store.search('跨仓迁移记忆')).items.some(item=>item.title==='跨仓迁移记忆'),'A prepared draft must not be recalled');
    const published=await dreams.publish(run.id);assert.equal(published.status,'published');assert.equal(published.memories?.length,1);const derived=published.memories![0]!;
    const memory=await store.read(derived);assert.equal(memory.freshness,'current');assert.equal(memory.record.status,'candidate');assert.equal(memory.record.scope.type,'repositories');assert.equal(memory.record.derivedFrom?.length,2);
    await store.feedback(derived,'helpful',{},'user-followup:consumer-migration');assert((await store.search('跨仓迁移')).items.some(item=>item.id===derived));
    await store.forget(first.id);assert.equal((await store.read(derived)).freshness,'stale');assert.equal(await store.visible(derived),false);assert(!(await store.search('跨仓迁移')).items.some(item=>item.id===derived));
    await assert.rejects(dreams.publish(run.id),/forgotten/);assert.equal((await store.read(second.id)).freshness,'current');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('pause/resume keeps the request budget and a cancelled dream cannot publish late model results',async()=>{
  const {root,workspace}=await fixture();try{
    const store=await MemoryStore.open(workspace),source=await store.save(note('契约','library 与 sdk 迁移要求。')),dreams=new MemoryDreams(workspace),run=await dreams.prepare([source.id],{},2);
    let started!:()=>void,finish!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    const pending=dreams.execute(run.id,{},async()=>{started();await new Promise<void>(resolve=>{finish=resolve;});return answer([source.id]);});await began;
    await dreams.control(run.id,'pause');finish();assert.equal((await pending).status,'paused');assert.equal((await dreams.read(run.id)).requests,1);
    const resumed=await dreams.execute(run.id,{},async()=>answer([source.id]));assert.equal(resumed.status,'ready');assert.equal(resumed.requests,2);
    await dreams.control(run.id,'cancel');await assert.rejects(dreams.publish(run.id),/ready/);assert(!(await store.search('跨仓迁移')).items.some(item=>item.title==='跨仓迁移记忆'));
    assert.equal((await store.read(source.id)).content,'library 与 sdk 迁移要求。');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('stale/foreign sources and private scope widening are rejected, and imported uncertainty survives consolidation',async()=>{
  const {root,workspace}=await fixture();try{
    const store=await MemoryStore.open(workspace),privateNote=await store.save({...note('任务契约','task-private-context'),scope:{type:'task',session:'private',entry:'entry'}},{access:{session:'private',entries:['entry']}}),dreams=new MemoryDreams(workspace);
    await assert.rejects(dreams.prepare([privateNote.id]),/scope/);
    const source=await store.read(privateNote.id,{session:'private',entries:['entry']});
    await assert.rejects(store.save({...note('非法提升','private copied'),derivedFrom:[{id:source.record.id,revision:source.record.revision,bodyHash:source.bodyHash!}]},{access:{session:'private',entries:['entry']}}),/widen/);
    const project=new ProjectContext(workspace),resource=await project.add({title:'外部接口资料',repos:['library','sdk'],source:{kind:'imported',uri:'https://example.invalid/contracts'},content:'外部快照，尚未验证远端更新。'});
    const imported=await store.save({...note('接口资料','external contract snapshot'),sources:[],materials:[{id:resource.id,revision:resource.revision,contentHash:resource.contentHash}]});
    const run=await dreams.prepare([imported.id]);assert.equal((await dreams.execute(run.id,{},async()=>answer([imported.id]))).status,'ready');
    const published=await dreams.publish(run.id),derived=await store.read(published.memories![0]!);assert(derived.content?.startsWith('[Reference snapshot:'));assert.equal(derived.freshness,'current');
    await project.refresh(resource.id,{},'新版接口');assert.equal((await store.read(derived.record.id)).freshness,'stale');
    const fresh=await store.save(note('新的契约','新说明')),bad=await dreams.prepare([fresh.id]);const failed=await dreams.execute(bad.id,{},async()=>answer(['memory-foreign']));assert.equal(failed.status,'failed');assert.equal(failed.requests,2);assert(!failed.memories?.length);
    await writeFile(join(root,'library/index.js'),'export const changed=true;\n');await assert.rejects(dreams.prepare([fresh.id]),/stale/);
    assert.equal(await readFile(join(root,'library/index.js'),'utf8'),'export const changed=true;\n');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('two adapters cannot dispatch the same dream twice, and cancellation through another adapter wins over late output',async()=>{
 const {root,workspace}=await fixture();try{
  const store=await MemoryStore.open(workspace),source=await store.save(note('契约','保留来源')),a=new MemoryDreams(workspace),b=new MemoryDreams(workspace),run=await a.prepare([source.id]);
  let started!:()=>void,finish!:()=>void;const entered=new Promise<void>(r=>{started=r;});
  const work=a.execute(run.id,{},async()=>{started();await new Promise<void>(r=>{finish=r;});return answer([source.id]);});await entered;
  await assert.rejects(b.execute(run.id,{},async()=>answer([source.id])),/active/);
  await b.control(run.id,'cancel');finish();assert.equal((await work).status,'cancelled');assert.equal((await a.read(run.id)).requests,1);assert.equal((await a.read(run.id)).candidates,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a killed model worker becomes recoverable with spent requests retained and no automatic replay',async()=>{
 const {root,workspace}=await fixture();let child:ReturnType<typeof spawn>|undefined;
 try{
  const store=await MemoryStore.open(workspace),source=await store.save(note('契约','保留来源')),dreams=new MemoryDreams(workspace),run=await dreams.prepare([source.id],{},2);
  const module=new URL('../src/memory-dream.js',import.meta.url).href,workspaceModule=new URL('../src/workspace.js',import.meta.url).href;
  const script=`import {MemoryDreams} from ${JSON.stringify(module)};import {Workspace} from ${JSON.stringify(workspaceModule)};const w=await Workspace.open(process.argv[1]);await new MemoryDreams(w).execute(process.argv[2],{},async()=>{process.stdout.write('ready\\n');return new Promise(()=>setInterval(()=>{},1000));});`;
  child=spawn(process.execPath,['--input-type=module','-e',script,root,run.id],{stdio:['ignore','pipe','pipe']});
  let ready=false;child.stdout!.on('data',chunk=>{if(chunk.toString().includes('ready'))ready=true;});
  const until=Date.now()+5000;while(!ready&&Date.now()<until)await new Promise(r=>setTimeout(r,25));assert(ready);
  assert.equal((await dreams.list())[0]?.runtimeState,'active');await assert.rejects(dreams.recover(run.id),/仍在运行/);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  assert.equal((await dreams.list())[0]?.runtimeState,'interrupted');const recovered=await dreams.recover(run.id);assert.equal(recovered.status,'paused');assert.equal(recovered.requests,1);
  const resumed=await dreams.execute(run.id,{},async()=>answer([source.id]));assert.equal(resumed.status,'ready');assert.equal(resumed.requests,2);
 }finally{child?.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});
test('source changes during model repair prevent publishing the resulting candidates',async()=>{
 const {root,workspace}=await fixture();try{
  const store=await MemoryStore.open(workspace),source=await store.save(note('契约','原契约')),dreams=new MemoryDreams(workspace),run=await dreams.prepare([source.id]);let calls=0;
  const result=await dreams.execute(run.id,{},async()=>{if(++calls===1)return 'invalid JSON';await writeFile(join(root,'library/index.js'),'export const newContract=true;\n');return answer([source.id]);});
  assert.equal(result.status,'stale');assert.equal(result.candidates,undefined);assert.equal(result.requests,2);assert.equal(result.writer,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});
