import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { prepareReview, readReviewSource,readReviewChanges,finishReview,readStoredReview,listReviews,readStoredReviewSource } from '../src/review.js';
import {PlanStore} from '../src/planning.js';
import { runPiReview } from '../src/pi-review.js';
import { fixture } from './fixtures.js';
test('bounded review pages enumerate every changed file beyond the first 80 and disclose clipped excerpts',()=>{
 const review={changes:Array.from({length:101},(_,i)=>({repo:'api',file:`file-${i}.ts`,change:'modified',patch:'x'.repeat(48000)}))} as any;
 const files:string[]=[];let offset:number|null=0;while(offset!==null){const page=readReviewChanges(review,offset);assert(page.changes.length>0);assert(JSON.stringify(page).length<64000);assert(page.changes.every(change=>change.patchTruncated));files.push(...page.changes.map(change=>change.file));offset=page.nextOffset;}
 assert.equal(files.length,101);assert.equal(new Set(files).size,101);assert.equal(files.at(-1),'file-100.ts');assert.throws(()=>readReviewChanges(review,-1),/分页/);
});
test('native independent reviewer can page remaining changes and records supplied coverage separately from findings',async()=>{
 const {root,workspace}=await fixture(),agentDir=join(root,'agent');try{
  const baseline=await workspace.checkpoint('before batch');for(let index=0;index<85;index++)await writeFile(join(root,'library',`new-${String(index).padStart(3,'0')}.js`),`export const value = ${index};\n`);
  const runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false}),faux=fauxProvider({models:[{id:'reviewer',contextWindow:100000,maxTokens:2000}]});runtime.registerNativeProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage([fauxToolCall('review_changes',{offset:20,limit:40})],{stopReason:'toolUse'}),fauxAssistantMessage([fauxToolCall('review_changes',{offset:60,limit:40})],{stopReason:'toolUse'}),context=>{assert(JSON.stringify(context).includes('new-084.js'));return fauxAssistantMessage('Paged all file excerpts; runtime behavior remains untested.');}]);
  const report=await runPiReview(workspace,{baseline:baseline.id,goal:'Inspect the whole change list',requirements:[]},{modelRuntime:runtime,provider:faux.getModel().provider,model:faux.getModel().id,agentDir});
  assert.equal(report.status,'completed');assert.equal(report.coverage?.files,85);assert.equal(report.coverage?.inlineDiffFiles,20);assert.equal(report.coverage?.providedDiffFiles,85);assert.equal(report.requests,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('review catalog revalidates source after publication, isolates task ownership and keeps frozen/deleted source readable',async()=>{
 const {root,workspace}=await fixture();
 try{
  await writeFile(join(root,'library','removed.txt'),'saved-before-delete\n');const baseline=await workspace.checkpoint('before review');
  await rm(join(root,'library','removed.txt'));await writeFile(join(root,'library','index.js'),'export const snapshotValue = 1;\n');
  const plan=await new PlanStore(workspace,'active-plan-task-a.json').create({goal:'Own plan',steps:[{id:'source',repo:'library',goal:'Keep contract',checks:[]}]});
  const snapshot=await prepareReview(workspace,{baseline:baseline.id,goal:'Check contract',requirements:[],task:'task-a',planFile:'active-plan-task-a.json'});assert.equal(snapshot.plan?.id,plan.id);
  await finishReview(workspace,snapshot,{status:'completed',text:'Frozen source reviewed',model:'fixture',requests:2});
  assert.equal((await readStoredReview(workspace,snapshot.id,'task-a')).sourceCurrent,true);
  await writeFile(join(root,'library','index.js'),'export const snapshotValue = 2;\n');
  const read=await readStoredReview(workspace,snapshot.id,'task-a');assert.equal(read.status,'stale');assert.equal(read.recordedStatus,'completed');assert.equal(read.sourceCurrent,false);
  assert((await readStoredReviewSource(workspace,snapshot.id,'task-a','library','index.js')).content.includes('= 1'));
  assert.equal((await readStoredReviewSource(workspace,snapshot.id,'task-a','library','removed.txt',1,20,'baseline')).content,'saved-before-delete\n');
  await assert.rejects(readStoredReview(workspace,snapshot.id,'other-task'),/另一个任务/);await assert.rejects(readStoredReviewSource(workspace,snapshot.id,'other-task','library','index.js'),/另一个任务/);
  assert.equal((await listReviews(workspace,'task-a')).items.length,1);assert.equal((await listReviews(workspace,'other-task')).items.length,0);
  const original=JSON.parse(await readFile(join(workspace.data,'reviews',snapshot.id,'report.json'),'utf8'));assert.equal(original.status,'completed');assert.equal(original.sourceCurrent,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('legacy ownership is inferred only from recorded task provenance and unknown ownership remains explicit history',async()=>{
 const {root,workspace}=await fixture();
 try{
  const baseline=await workspace.checkpoint('legacy');
  const old=await prepareReview(workspace,{baseline:baseline.id,goal:'Legacy scoped',requirements:[{text:'Keep contract',reference:'pi:owner-task:user-1'}]});await finishReview(workspace,old,{status:'completed',text:'owned report',model:'fixture'});
  const unscoped=await prepareReview(workspace,{baseline:baseline.id,goal:'Old project report',requirements:[]});await finishReview(workspace,unscoped,{status:'completed',text:'project report',model:'fixture'});
  const foreign=await listReviews(workspace,'another-task');assert.equal(foreign.items.length,1);assert.equal(foreign.items[0]?.scope,'legacy-workspace');assert(!JSON.stringify(foreign.items).includes('owned report'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('frozen source reports text clipping honestly rather than claiming unseen trailing lines',async()=>{
 const {root,workspace}=await fixture();try{
  await writeFile(join(root,'library','long.txt'),'x'.repeat(30000)+'\nsecond\n');const baseline=await workspace.checkpoint('long source'),snapshot=await prepareReview(workspace,{baseline:baseline.id,goal:'read long line',requirements:[]});
  const source=await readReviewSource(workspace,snapshot,'library','long.txt',1,3);assert.equal(source.endLine,1);assert.equal(source.totalLines,3);assert.equal(source.truncated,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('independent review reads frozen changes in a new context without shell or mutation tools', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('review baseline'));
    await writeFile(join(root, 'library', 'index.js'), 'export function greet(){return {message:"v2"};}\n');
    const before = await readFile(join(root, 'library', 'index.js'), 'utf8');
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    let visible = '';
    faux.setResponses([context => { visible = JSON.stringify(context); return fauxAssistantMessage([fauxToolCall('review_read', { repo: 'library', file: 'index.js' })], { stopReason: 'toolUse' }); },
      fauxAssistantMessage([fauxToolCall('write', { path: 'index.js', content: 'forbidden' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('library/index.js:1 changed its return to an object; sdk/index.js still returns the object directly. Check the application string contract.')]);
    const report = await runPiReview(workspace, { baseline: baseline.id, goal: 'Preserve app output', requirements: [{ text: 'A new return shape must be adapted by sdk.', reference: 'original user input' }] },
      { modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, agentDir });
    assert.equal(report.status, 'completed', JSON.stringify(report));
    assert(report.text.includes('sdk/index.js')); assert(visible.includes('review_read')); assert(!visible.includes('Execute bash commands'));
    assert.equal(await readFile(join(root, 'library', 'index.js'), 'utf8'), before);
    assert.notEqual(report.session, undefined);
    assert(report.limitations.some(limit => limit.includes('advisory')));
    assert.equal(report.requests,3);assert.equal(report.provider,faux.getModel().provider);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('independent review enforces real model request budgets without changing source or certifying completion',async()=>{
  const {root,workspace}=await fixture(),agentDir=join(root,'agent');
  try{
    const baseline=await workspace.checkpoint('bounded reviewer'),runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
    const faux=fauxProvider({models:[{id:'reviewer',contextWindow:100000,maxTokens:2000}]});runtime.registerNativeProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage([fauxToolCall('review_read',{repo:'library',file:'index.js'})],{stopReason:'toolUse'}),fauxAssistantMessage('This second request must not be dispatched.')]);
    let charged=0;const report=await runPiReview(workspace,{baseline:baseline.id,goal:'Check frozen source',requirements:[]},{modelRuntime:runtime,provider:faux.getModel().provider,model:faux.getModel().id,agentDir,maxRequests:1,onRequest:async()=>{charged++;}});
    assert.equal(report.status,'failed');assert.equal(report.requests,1);assert.equal(charged,1);assert.equal(faux.state.callCount,1);
    assert.equal(await readFile(join(root,'library/index.js'),'utf8'),'export function greet() { return "v1"; }\n');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('review reads retain captured source and its report becomes stale after an external edit', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('before review'));
    const frozen = await prepareReview(workspace, { baseline: baseline.id, goal: 'Check source', requirements: [] });
    await writeFile(join(root, 'library', 'index.js'), 'export const outside=true;\n');
    assert((await readReviewSource(workspace, frozen, 'library', 'index.js')).content.includes('greet'));
    await assert.rejects(readReviewSource(workspace, frozen, 'library', '../secret'), /outside/);
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    faux.setResponses([async () => { await writeFile(join(root, 'library', 'index.js'), 'export const changedDuringReview=true;\n'); return fauxAssistantMessage('Observed source requires a runtime check.'); }]);
    const report = await runPiReview(workspace, { baseline: baseline.id, goal: 'Check current delta', requirements: [] },
      { modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, agentDir });
    assert.equal(report.status, 'stale'); assert.equal(report.sourceCurrent, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelled independent review produces no completed verdict', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('cancelled review baseline'));
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    const controller = new AbortController(); controller.abort();
    const report = await runPiReview(workspace, { baseline: baseline.id, goal: 'Review cancelled', requirements: [] },
      { modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, agentDir, signal: controller.signal });
    assert.equal(report.status, 'cancelled'); assert.equal(faux.state.callCount, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
