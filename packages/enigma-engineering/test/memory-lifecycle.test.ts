import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fixture} from './fixtures.js';
import {MemoryStore,type MemoryInput} from '../src/memory.js';
import {domainAction,domainChoices,domainData} from '../src/workbench-domain.js';

test('long-lived memory remains searchable beyond 500 records and more than 80 stale matches',{timeout:60000},async()=>{
 const {root,workspace}=await fixture(),store=await MemoryStore.open(workspace);
 try{
  const started=performance.now(),ids=[];
  for(let i=0;i<530;i++)ids.push(await store.save({kind:'decision',scope:{type:'project'},title:`记录 ${i}`,content:i<90?'跨仓兼容约束，旧依据':'普通历史背景',origin:{kind:'user',reference:`entry:${i}`},...(i<90?{sources:[{repo:'library',file:'index.js'}]}:{})},{userStated:true}));
  await writeFile(join(root,'library','index.js'),'export function greet(){return "changed";}');
  const final=await store.save({kind:'contract',scope:{type:'project'},title:'最终跨仓兼容约束',content:'跨仓兼容约束，最新独有协议尾部 ZEBRA_FINAL',origin:{kind:'user',reference:'latest'}},{userStated:true});
  const recalled=await store.search('跨仓兼容约束');assert.equal(recalled.items.length,1);assert.equal(recalled.items[0]?.id,final.id);
  assert.equal((await store.search('ZEBRA_FINAL')).items[0]?.id,final.id);
  const page1=await store.catalog({}, {limit:20}),page2=await store.catalog({}, {limit:20,offset:20});assert.equal(page1.total,531);assert(page1.more);assert(!page1.items.some(item=>page2.items.some(other=>other.id===item.id)));
  await store.forget(ids[0]!.id);const correction=await store.save({kind:'contract',scope:{type:'project'},title:'更正后的跨仓约束',content:'更正协议 ZEBRA_FINAL',origin:{kind:'user',reference:'correction'}},{replaces:final.id,userStated:true});assert.equal((await store.search('ZEBRA_FINAL')).items[0]?.id,correction.id);await assert.rejects(store.read(final.id),/forgotten/);
  await writeFile(join(store.directory,'entries',`${ids[3]!.id}.json`),'broken');const isolated=await store.search('ZEBRA_FINAL');assert.equal(isolated.items[0]?.id,correction.id);assert(isolated.unavailable>0);
  console.log(JSON.stringify({memoryLifecycleMs:Math.round(performance.now()-started),records:532,indexed:Object.keys((await store.index()).index.entries).length}));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('draft organization respects current task scope and saved drafts do not exhaust the pending budget',{timeout:60000},async()=>{
 const {root,workspace}=await fixture(),store=await MemoryStore.open(workspace),accessA={session:'task-a',entries:['entry-a']},accessB={session:'task-b',entries:['entry-b']};
 try{
  const input=(title:string):MemoryInput=>({kind:'contract',title,content:'接口保留兼容性',scope:{type:'task',session:'task-a',entry:'entry-a'},sources:[{repo:'library',file:'index.js'}],origin:{kind:'assistant',reference:'source'}});
  const a=await store.queue(input('A的私有经验'),accessA),b=await store.queue({...input('B的私有经验'),scope:{type:'task',session:'task-b',entry:'entry-b'}},accessB);
  assert.equal((await store.drafts(accessB)).items.length,1);assert.equal((await store.organize({access:accessA,ids:[b]})).outcomes.length,0);
  const outcome=await store.organize({access:accessA,ids:[a]});assert.equal(outcome.outcomes[0]?.status,'saved');assert.equal((await store.drafts(accessB)).items[0]?.state,'queued');await assert.rejects(store.read(outcome.outcomes[0]!.memory!,accessB),/scope/);
  const stale=await store.queue(input('将过期的草稿'),accessA);await writeFile(join(root,'library','index.js'),'export const changed=true;');assert.equal((await store.organize({access:accessA,ids:[stale]})).outcomes[0]?.status,'stale');
  // Archived draft receipts are authoritative history, not outstanding work.
  const saved=JSON.parse(await readFile(join(store.directory,'drafts',a+'.json'),'utf8'));for(let i=0;i<105;i++)await writeFile(join(store.directory,'drafts',`saved-${i}.json`),JSON.stringify({...saved,id:`saved-${i}`}));
  const next=await store.queue(input('归档很多次后仍可记录'),accessA);assert(next);assert.equal((await store.drafts(accessA)).items.find(draft=>draft.id===next)?.state,'queued');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('workbench choices and indexing expose only scoped records and never the private index tokens',async()=>{
 const {root,workspace}=await fixture(),store=await MemoryStore.open(workspace);
 try{
  for(const task of ['task-a','task-b'])await store.save({kind:'decision',scope:{type:'task',session:task,entry:'entry'},title:task,content:task==='task-b'?'PRIVATE_TOKEN_SENTINEL':'当前任务背景',origin:{kind:'user',reference:task}},{userStated:true,access:{session:task,entries:['entry']}});
  const controller={options:{workspace},chat:{session:'task-a'},snapshot:()=>({memory:true}),runtime:{session:{sessionManager:{getLeafId:()=> 'entry',getBranch:()=>[{id:'entry'}]}}}} as any;
  const choices=await domainChoices(controller,['memories']);assert.equal((choices.memories as any[]).length,1);assert((choices.memories as any[])[0].label.includes('task-a'));
  const indexed=await domainAction(controller,'memory-reindex',{},new AbortController().signal) as any;assert.equal(indexed.indexed,1);assert.equal(indexed.memoryIndex,true);assert(!JSON.stringify(indexed).includes('PRIVATE_TOKEN_SENTINEL'));assert(!indexed.index);
  const data=await domainData(controller,'memory','',{offset:0}) as any;assert.equal(data.search.items.length,1);assert.equal(data.search.items[0].title,'task-a');
 }finally{await rm(root,{recursive:true,force:true});}
});
