import assert from 'node:assert/strict';
import test from 'node:test';
import {synthesisMaterial,validateReadingSynthesis} from '../src/reading-synthesis.js';
import {synthesizeReadingMaterial} from '../src/reading-material.js';

function fixture(){
 const nodes=Array.from({length:410},(_,i)=>({id:`n${i}`,source:{repo:'api',file:`f${i}.ts`,line:1,snippet:'source'},role:'implementation',responsibility:'fixture'}));
 const chapters=[{id:'batch-1',title:'Behavior',summary:'Source group one',nodes:nodes.slice(0,205).map(n=>n.id),authority:'model-inference' as const},{id:'batch-2',title:'Behavior',summary:'Source group two',nodes:nodes.slice(205).map(n=>n.id),authority:'model-inference' as const}];
 const insights=[{title:'Caller risk',text:'Callers need verification',anchors:['n1'],kind:'risk' as const,authority:'model-inference' as const}];
 const report:any={nodes,edges:[{from:'n0',to:'n409',kind:'reference',confidence:'confirmed'}],chapters,insights,goal:'Read changed behavior'};
 const coverage:any={status:'complete',requests:2,completedRequests:2,plannedRequests:2,nodes:410,totalNodes:410,changes:410,totalChanges:410,edges:0,totalEdges:1,characters:50000,clippedNodes:0,clippedPatches:0};
 const answer={chapters:[{title:'One behavior across batches',summary:'Grouped by observed behavior',groups:['batch-1','batch-2']}],insights:[{title:'Caller risk',text:'This is a risk, not a test result',groups:['insight-1'],anchors:['n1'],kind:'risk'}]};
 return{report,chapters,insights,coverage,answer,material:synthesisMaterial(report,chapters,insights)};
}
test('synthesis expands every source group, retaining all nodes even beyond one chapter limit',()=>{
 const f=fixture(),result=validateReadingSynthesis(f.answer,f.material);
 assert.equal(result.chapters.length,2);assert.equal(new Set(result.chapters.flatMap(c=>c.nodes)).size,410);
 assert.equal(f.material.relationships[0]!.to,'n409');
 assert.throws(()=>validateReadingSynthesis({...f.answer,chapters:[]},f.material),/遗漏/);
 assert.throws(()=>validateReadingSynthesis({...f.answer,insights:[{...f.answer.insights[0],anchors:['n409']}]},f.material),/来源组/);
 assert.throws(()=>validateReadingSynthesis({...f.answer,chapters:[f.answer.chapters[0],f.answer.chapters[0]]},f.material),/重复/);
 assert.throws(()=>validateReadingSynthesis({...f.answer,insights:[{...f.answer.insights[0],kind:'explanation'}]},f.material),/风险/);
});
test('synthesis failure preserves completed source coverage and original notes',async()=>{
 const f=fixture();let latest:any;let calls=0;
 await assert.rejects(synthesizeReadingMaterial(f.report,{chapters:f.chapters,insights:f.insights,modelCoverage:f.coverage},{contextWindow:100000,onProgress:async value=>{latest=value;},request:async()=>{calls++;return 'malformed';}}),/有效JSON/);
 assert.equal(calls,1);assert.equal(latest.modelCoverage.status,'complete');assert.equal(latest.modelSynthesis.status,'failed');assert.deepEqual(latest.chapters,f.chapters);
});
test('a denied synthesis request cannot erase batch results or dispatch a model call',async()=>{
 const f=fixture();let latest:any;let requests=0;
 await assert.rejects(synthesizeReadingMaterial(f.report,{chapters:f.chapters,insights:f.insights,modelCoverage:f.coverage},{contextWindow:100000,onRequest:async()=>{throw Error('budget');},onProgress:async value=>{latest=value;},request:async()=>{requests++;return JSON.stringify(f.answer);}}),/budget/);
 assert.equal(requests,0);assert.equal(latest.modelSynthesis.requests,0);assert.equal(latest.modelCoverage.completedRequests,2);
});
test('synthesis uses one separately counted request and can reuse prior completed material',async()=>{
 const f=fixture();let requests=0;
 const result=await synthesizeReadingMaterial(f.report,{chapters:f.chapters,insights:f.insights,modelCoverage:f.coverage},{contextWindow:100000,request:async(input,validate)=>{requests++;assert.equal(input.phase,'synthesis');validate(JSON.stringify(f.answer));return JSON.stringify(f.answer);}});
 assert.equal(requests,1);assert.equal(result.modelCoverage.requests,2);assert.equal(result.modelSynthesis?.requests,1);assert.equal(result.modelSynthesis?.status,'complete');assert.equal(result.modelSynthesis?.chapters.length,2);
});
