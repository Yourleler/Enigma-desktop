import assert from'node:assert/strict';
import{writeFile,readFile,rm}from'node:fs/promises';
import{join}from'node:path';
import test from'node:test';
import{fixture}from'./fixtures.js';
import{dependencyCheckpoint}from'../src/dependency-checkpoint.js';
import{CheckpointIntegrations}from'../src/checkpoint-integration.js';

test('downstream starts with exact upstream code while parent stays unchanged and integration requires upstream selection first',async()=>{
 const{root,workspace}=await fixture();try{
  const original=await workspace.checkpoint('parent'),up=await workspace.forkCheckpoint(original.id,join(root,'upstream'));
  await writeFile(join(up.repo('library').root,'index.js'),'export function greet(){return "v2";}\n');
  const prepared=await dependencyCheckpoint(workspace,'down',[{task:'up',root:up.root,baseline:original.id,writeRepos:['library']}]);
  assert(!(await workspace.checkpoints()).some(point=>point.id===prepared.checkpoint.id),'Derived inputs are not actual parent restore baselines');
  assert.equal((await workspace.loadCheckpoint(prepared.checkpoint.id)).purpose,'dependency-input');
  assert((await readFile(join(root,'library/index.js'),'utf8')).includes('v1'));assert.equal(prepared.inputs.length,1);
  const down=await workspace.forkCheckpoint(prepared.checkpoint.id,join(root,'downstream'));await down.restrictRuntime(['app'],[]);
  assert((await readFile(join(down.repo('library').root,'index.js'),'utf8')).includes('v2'));await writeFile(join(down.repo('app').root,'GUIDE.md'),'Expected result is v2.\n');
  const integrations=new CheckpointIntegrations(workspace),input={owner:'manager',worker:'down',childRoot:down.root,baseline:prepared.checkpoint.id,writeRepos:['app'],inputs:prepared.inputs};
  const blocked=await integrations.preview(input);assert.equal(blocked.applyAllowed,false);assert(blocked.changes.some(c=>c.reason?.includes('Upstream input')));
  assert(!(await workspace.checkpoints()).some(point=>point.id===blocked.proposed),'Unapplied proposals are not current code snapshots');
  const upPreview=await integrations.preview({owner:'manager',worker:'up',childRoot:up.root,baseline:original.id,writeRepos:['library']});await integrations.apply(upPreview.id,'manager',['library']);
  const ready=await integrations.preview(input);assert.equal(ready.applyAllowed,true);assert.deepEqual(ready.changes.map(c=>c.file),['GUIDE.md']);await integrations.apply(ready.id,'manager',['app']);
  assert((await readFile(join(root,'library/index.js'),'utf8')).includes('v2'));assert.equal(await readFile(join(root,'app/GUIDE.md'),'utf8'),'Expected result is v2.\n');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('conflicting upstream outputs and unauthorized child changes cannot be smuggled into downstream code',async()=>{
 const{root,workspace}=await fixture();try{
  const base=await workspace.checkpoint('base'),a=await workspace.forkCheckpoint(base.id,join(root,'a')),b=await workspace.forkCheckpoint(base.id,join(root,'b'));
  await writeFile(join(a.repo('library').root,'index.js'),'export const value="a";');await writeFile(join(b.repo('library').root,'index.js'),'export const value="b";');
  const sources=[{task:'a',root:a.root,baseline:base.id,writeRepos:['library']},{task:'b',root:b.root,baseline:base.id,writeRepos:['library']}];
  await assert.rejects(dependencyCheckpoint(workspace,'down',sources),/conflicts/);
  await assert.rejects(dependencyCheckpoint(workspace,'down',[{...sources[0]!,writeRepos:[]}]),/outside its grant/);
  assert((await readFile(join(root,'library/index.js'),'utf8')).includes('v1'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('transitive dependencies retain ancestor inputs without claiming them as downstream-owned changes',async()=>{
 const{root,workspace}=await fixture();try{
  const base=await workspace.checkpoint('base'),a=await workspace.forkCheckpoint(base.id,join(root,'a'));await writeFile(join(a.repo('library').root,'index.js'),'export function greet(){return "v2";}\n');
  const first=await dependencyCheckpoint(workspace,'b',[{task:'a',root:a.root,baseline:base.id,writeRepos:['library']}]),b=await workspace.forkCheckpoint(first.checkpoint.id,join(root,'b'));await writeFile(join(b.repo('sdk').root,'GUIDE.md'),'v2');
  const second=await dependencyCheckpoint(workspace,'c',[{task:'b',root:b.root,baseline:first.checkpoint.id,writeRepos:['sdk'],inputs:first.inputs}]),c=await workspace.forkCheckpoint(second.checkpoint.id,join(root,'c'));
  assert.equal(second.inputs.length,2);assert((await readFile(join(c.repo('library').root,'index.js'),'utf8')).includes('v2'));assert.equal(await readFile(join(c.repo('sdk').root,'GUIDE.md'),'utf8'),'v2');
 }finally{await rm(root,{recursive:true,force:true});}
});
