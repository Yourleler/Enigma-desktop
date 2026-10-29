import assert from 'node:assert/strict';
import {rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {fixture} from './fixtures.js';
import {exportHandoff} from '../src/handoff.js';
import {exportDifferentialHandoff,inspectDifferentialHandoff,inspectPortableHandoff} from '../src/differential-handoff.js';
test('differential handoff retains all user requirements and current code provenance while omitting previously shared background',async()=>{
  const {root,workspace}=await fixture();try{
    const requirement={role:'user' as const,kind:'requirement' as const,text:'Preserve the public string contract',reference:'user-entry'},background={role:'source' as const,kind:'background' as const,text:'Existing consumer structure',reference:'source-old'};
    const input={mode:'continue' as const,goal:'Continue original migration',source:{agent:'pi',session:'source-session'},notes:[requirement,background]};const base=await exportHandoff(workspace,join(root,'base'),input);
    await writeFile(join(root,'library/index.js'),'export function greet(){return "v2";}\n');
    const delta=await exportDifferentialHandoff(workspace,join(root,'base'),join(root,'delta'),{...input,notes:[...input.notes,{role:'assistant',kind:'observation',text:'Producer has changed; consumer requires verification.',reference:'new-observation'}]});
    assert.equal(delta.delta.base.id,base.id);assert.equal(delta.delta.omittedUnchangedBackground,1);assert.equal(delta.delta.changedRepositories.length,1);assert(delta.manifest.notes.some(note=>note.reference==='user-entry'));assert(!delta.manifest.notes.some(note=>note.reference==='source-old'));
    const inspected=await inspectDifferentialHandoff(workspace,join(root,'delta'));assert.equal(inspected.code.every(repo=>repo.state==='current'),true);assert(inspected.prompt.includes('new-observation'));assert((await readFile(join(root,'delta/handoff.md'),'utf8')).includes('Preserve the public string contract'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a delta retains omitted original user requirements and imports without the base directory',async()=>{
  const {root,workspace}=await fixture();try{
    const requirement={role:'user' as const,kind:'requirement' as const,text:'Never change the API return type',reference:'user-1'};
    const background={role:'source' as const,kind:'background' as const,text:'SDK entry is greet',reference:'source-1'};
    const input={mode:'continue' as const,goal:'Continue safely',source:{agent:'pi',session:'original'},notes:[requirement,background]};
    await exportHandoff(workspace,join(root,'base'),input);
    const result=await exportDifferentialHandoff(workspace,join(root,'base'),join(root,'delta'),{...input,notes:[background,{role:'assistant',kind:'observation',text:'New work completed',reference:'new'}]});
    assert(result.manifest.notes.some(note=>note.reference==='user-1'));assert.equal(result.delta.omittedUnchangedBackground,1);
    await rm(join(root,'base'),{recursive:true,force:true});
    const inspected=await inspectPortableHandoff(workspace,join(root,'delta'));assert(inspected.prompt.includes(requirement.text));assert(inspected.prompt.includes('do not invent omitted content'));
    const {importPiHandoff}=await import('../src/pi-session.js');const target=await importPiHandoff(workspace,inspected);assert(target.sessionId);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('delta validation rejects foreign baselines, changed original roles, and corrupted metadata',async()=>{
  const {root,workspace}=await fixture();try{
    const note={role:'user' as const,kind:'requirement' as const,text:'Keep tests',reference:'user-1'},input={mode:'continue' as const,goal:'Continue',source:{agent:'pi',session:'same'},notes:[note]};
    await exportHandoff(workspace,join(root,'base'),input);
    await assert.rejects(exportDifferentialHandoff(workspace,join(root,'base'),join(root,'bad'),{...input,source:{agent:'pi',session:'other'}}),/same source/);
    await assert.rejects(exportDifferentialHandoff(workspace,join(root,'base'),join(root,'bad'),{...input,notes:[{...note,role:'assistant'}]}),/provenance changed/);
    await exportDifferentialHandoff(workspace,join(root,'base'),join(root,'delta'),input);
    const file=join(root,'delta','delta.json'),metadata=JSON.parse(await readFile(file,'utf8'));metadata.base.documentHash='_'.repeat(64);await writeFile(file,JSON.stringify(metadata));
    await assert.rejects(inspectPortableHandoff(workspace,join(root,'delta')),/provenance/);
  }finally{await rm(root,{recursive:true,force:true});}
});
