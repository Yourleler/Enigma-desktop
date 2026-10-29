import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {Workspace} from '../src/workspace.js';
import {domainChoices} from '../src/workbench-domain.js';
import {fixture} from './fixtures.js';
test('plan acceptance choices include current passed checks, excluding reading evidence and stale source versions',async()=>{
 const {root,workspace:w}=await fixture();
 try{
  await w.addCheck({id:'syntax',repo:'library',argv:[process.execPath,'--check','index.js']});
  const proof=await w.exclusive(()=>w.verify());await w.exclusive(()=>w.evidence('reading',{status:'verified',results:[{check:'syntax',status:'passed'}]}));
  const controller={options:{workspace:w},chat:{session:'task'}} as any;
  const choices=await domainChoices(controller,['checkEvidence']);assert.deepEqual((choices.checkEvidence as any[]).map(item=>item.id),[proof.evidence]);
  await writeFile(join(root,'library','index.js'),'export const changed = true;');
  assert.deepEqual((await domainChoices(controller,['checkEvidence'])).checkEvidence,[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('form choices read only selected sources rather than global project observations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'enigma-choices-'));
 try{
  const w=await Workspace.open(root);
  await mkdir(join(w.data,'delegations','broken'),{recursive:true});
  await writeFile(join(w.data,'delegations','broken','spec.json'),'corrupt unrelated data');
  const controller={options:{workspace:w},chat:{session:'task'},snapshot:()=>({messages:[{id:'m',text:'user background'}]})} as any;
  const choices=await domainChoices(controller,['repos','checks','entries']);
  assert.deepEqual(Object.keys(choices),['repos','checks','entries']);assert.equal((choices.entries as any[])[0].id,'m');
  await assert.rejects(()=>domainChoices(controller,['__proto__']),/Unsupported/);
 }finally{await rm(root,{recursive:true,force:true});}
});
