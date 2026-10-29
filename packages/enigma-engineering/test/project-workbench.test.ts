import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,rm,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './fixtures.js';
import {domainAction} from '../src/workbench-domain.js';
import {skillPaths} from '../src/skill-discovery.js';

test('adding skill discovery paths through the workbench preserves previously registered paths',async()=>{
 const {root,workspace}=await fixture();let reloads=0;
 const controller={options:{workspace},chat:{session:'task'},runtime:{session:{reload:async()=>{reloads++;},sessionManager:{getLeafId:()=>undefined,getBranch:()=>[]}}}} as any;
 try{
  for(const name of ['first','second']){await mkdir(join(root,name));await writeFile(join(root,name,'SKILL.md'),'# fixture');}
  for(const name of ['first','second']){const result=await domainAction(controller,'skills-paths',{paths:[join(root,name)]},new AbortController().signal) as any;assert.equal(result.skillPathsConfigured,true);}
  assert.deepEqual(await skillPaths(workspace),await Promise.all(['first','second'].map(name=>realpath(join(root,name)))));assert.equal(reloads,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
