import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {fixture} from './fixtures.js';
import {DocumentationStore} from '../src/documentation.js';
import {domainAction,domainChoices} from '../src/workbench-domain.js';
const content='# API guide\n\n## Current\nCurrent return value is v1.\n\n## History\nv0 remains documented here.\n';
test('document declarations retain source versions and examples execute actual consumer behavior, invalidating changed code',async()=>{
  const {root,workspace}=await fixture();try{
    await writeFile(join(root,'sdk/GUIDE.md'),content);const store=new DocumentationStore(workspace);
    const record=await store.register({repo:'sdk',file:'GUIDE.md',title:'Migration guide',claims:[{id:'return',section:'## Current',text:'Current return value is v1.',authority:'source',sources:[{repo:'library',file:'index.js',start:1,end:1}],fact:{key:'greet.return',version:'1',value:'v1'}}],examples:[{id:'consumer',section:'## Current',repo:'app',argv:[process.execPath,'--input-type=module','-e','import {main} from "./index.js";console.log(main());'],expected:'v1'}]});
    assert.equal((await store.read(record.id)).examples[0]?.valid,false);
    const receipt=await store.runExample(record.id,'consumer');assert.equal(receipt.status,'passed');assert(receipt.output.includes('v1'));
    assert.equal((await store.read(record.id)).claims[0]?.supported,true);assert.equal((await store.read(record.id)).examples[0]?.valid,true);
    await writeFile(join(root,'library/index.js'),'export function greet(){return "v2";}\n');const stale=await store.read(record.id);assert.equal(stale.claims[0]?.current,false);assert.deepEqual(stale.affectedSections,['## Current']);assert.equal(stale.examples[0]?.valid,false);
    const failure=await store.runExample(record.id,'consumer');assert.equal(failure.status,'failed');assert.equal(failure.expectedMatched,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('same-version document contradictions are detected and a scoped update preserves history and concurrent edits',async()=>{
  const {root,workspace}=await fixture();try{
    const store=new DocumentationStore(workspace);await writeFile(join(root,'sdk/GUIDE.md'),content);await writeFile(join(root,'app/README.md'),content.replace('v1.','v2.'));
    const register=(repo:string,file:string,value:string,version:string)=>store.register({repo,file,title:'Guide',claims:[{id:'value',section:'## Current',text:`Current return value is ${value}.`,authority:'inference',fact:{key:'greet.return',version,value}}]});
    const first=await register('sdk','GUIDE.md','v1','current');await register('app','README.md','v2','current');await register('app','README.md','v2','historical-v2');
    assert.equal((await store.consistency()).conflicts.length,1);assert.equal((await store.consistency()).conflicts[0]?.key,'greet.return@current');
    const updated=await store.updateSection(first.id,'## Current',first.documentHash,'## Current\nCurrent return value is v2.\n');assert(updated.updated);
    assert((await readFile(join(root,'sdk/GUIDE.md'),'utf8')).includes('## History\nv0 remains documented here.'));
    await assert.rejects(store.updateSection(first.id,'## Current',first.documentHash,'## Current\nwrong\n'),/changed after/);
    assert.equal((await store.read(first.id)).current,false);
    await assert.rejects(store.register({repo:'sdk',file:'GUIDE.md',title:'Wrong source',claims:[{id:'wrong',section:'## Current',text:'Current return value is v2.',authority:'source'}]}),/actual source/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('registered example operations disclose the actual command, support cancellation and return a persisted receipt',async()=>{
  const {root,workspace}=await fixture();try{
    await writeFile(join(root,'sdk/GUIDE.md'),content);const store=new DocumentationStore(workspace);
    const record=await store.register({repo:'sdk',file:'GUIDE.md',title:'运行示例',claims:[],examples:[{id:'slow',section:'## Current',repo:'app',argv:[process.execPath,'-e','setTimeout(()=>console.log("example-finished"),10000)'],expected:'example-finished',timeoutMs:20000}]});
    let confirmation='';let approved=false;
    const controller={options:{workspace},chat:{session:'task'},runtime:{session:{sessionManager:{getLeafId:()=>null,getBranch:()=>[]}}},confirmOperation:async(_title:string,message:string)=>{confirmation=message;return approved;}} as any;
    const choices=await domainChoices(controller,['documentExamples']);assert.deepEqual(choices.documentExamples,[{id:`${record.id}/slow`,label:'运行示例 · ## Current · slow'}]);
    await assert.rejects(domainAction(controller,'document-example',{selection:`${record.id}/slow`},new AbortController().signal),/已取消/);
    assert(confirmation.includes('example-finished'));assert.equal((await store.read(record.id)).examples[0]?.receipt,null);
    approved=true;const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),150);
    try{const receipt=await domainAction(controller,'document-example',{selection:`${record.id}/slow`},abort.signal) as any;assert.equal(receipt.status,'cancelled');assert.equal((await store.read(record.id)).examples[0]?.receipt?.status,'cancelled');}
    finally{clearTimeout(timer);}
  }finally{await rm(root,{recursive:true,force:true});}
});
