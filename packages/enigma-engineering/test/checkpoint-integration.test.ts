import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { CheckpointIntegrations } from '../src/checkpoint-integration.js';

test('selected code integration retains concurrent parent edits and verifies original current code',async()=>{
  const {root,workspace}=await fixture();
  try{
    await workspace.addCheck({id:'joint',repo:'app',joint:true,argv:[process.execPath,'-e','if(require("fs").readFileSync("../library/index.js","utf8").includes("v2")!==true)process.exit(1)']});
    const baseline=await workspace.exclusive(()=>workspace.checkpoint('common baseline'));
    const child=await workspace.forkCheckpoint(baseline.id,join(root,'selected-worker'));
    await child.restrictRuntime(['library'],['joint']);
    await writeFile(join(child.repo('library').root,'index.js'),'export function greet() { return "v2"; }\n');
    await writeFile(join(workspace.repo('app').root,'USER.md'),'Concurrent user content\n');
    const integrations=new CheckpointIntegrations(workspace),preview=await integrations.preview({owner:'manager',worker:'worker',childRoot:child.root,baseline:baseline.id,writeRepos:['library']});
    assert(preview.applyAllowed);assert.equal(await readFile(join(root,'library/index.js'),'utf8'),'export function greet() { return "v1"; }\n');
    await assert.rejects(integrations.apply(preview.id,'unrelated',['library']),/ownership/);
    await assert.rejects(integrations.apply(preview.id,'manager',[]),/grants/);
    const receipt=await integrations.apply(preview.id,'manager',['library']);assert.equal(receipt.verification.status,'verified');
    assert.equal((await workspace.evidenceStatus(receipt.verification.evidence)).valid,true);
    assert.equal(await readFile(join(root,'app/USER.md'),'utf8'),'Concurrent user content\n');
    await writeFile(join(root,'library/index.js'),'User edited after acceptance\n');
    assert.equal((await workspace.evidenceStatus(receipt.verification.evidence)).valid,false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('integration detects conflicting edits, changed child, changed acceptance and stale parent without applying',async()=>{
  const {root,workspace}=await fixture();
  try{
    await workspace.addCheck({id:'joint',repo:'app',argv:[process.execPath,'-e','process.exit(0)']});
    const baseline=await workspace.checkpoint('source');
    const child=await workspace.forkCheckpoint(baseline.id,join(root,'selected-worker'));
    await writeFile(join(child.repo('library').root,'index.js'),'Worker result\n');
    const integrations=new CheckpointIntegrations(workspace),input={owner:'manager',worker:'worker',childRoot:child.root,baseline:baseline.id,writeRepos:['library']};
    await writeFile(join(root,'library/index.js'),'User overlapping edit\n');
    const conflict=await integrations.preview(input);assert.equal(conflict.applyAllowed,false);assert.equal(conflict.changes[0]?.state,'conflict');
    await assert.rejects(integrations.apply(conflict.id,'manager',['library']),/conflicting/);
    await writeFile(join(root,'library/index.js'),'export function greet() { return "v1"; }\n');
    const first=await integrations.preview(input);
    await writeFile(join(child.repo('library').root,'index.js'),'Worker changed again\n');
    await assert.rejects(integrations.apply(first.id,'manager',['library']),/Worker changed/);
    const second=await integrations.preview(input);
    await workspace.addCheck({id:'added',repo:'app',argv:[process.execPath,'-e','process.exit(1)']});
    await assert.rejects(integrations.apply(second.id,'manager',['library']),/acceptance definitions changed/);
    const third=await integrations.preview(input);
    await writeFile(join(root,'app/USER.md'),'User edit after preview\n');
    await assert.rejects(integrations.apply(third.id,'manager',['library']),/External edits/);
    assert.equal(await readFile(join(root,'library/index.js'),'utf8'),'export function greet() { return "v1"; }\n');
  }finally{await rm(root,{recursive:true,force:true});}
});
