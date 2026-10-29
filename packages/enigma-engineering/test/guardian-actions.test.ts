import assert from 'node:assert/strict';
import{mkdtemp,rm}from'node:fs/promises';
import{join}from'node:path';
import{tmpdir}from'node:os';
import test from'node:test';
import{GuardianActions}from'../src/guardian-actions.js';
test('a repeated request returns the original result across host instances without repeating its side effect',async()=>{
 const root=await mkdtemp(join(tmpdir(),'enigma-guardian-receipt-'));try{
  let effects=0;const action=async()=>({task:`worker-${++effects}`}),input={action:'propose-repair',reason:'observed failure'};
  const result=await new GuardianActions(root,'session').run('one',input,action);
  const retry=await new GuardianActions(root,'session').run('one',input,action);
  assert.equal(result.task,'worker-1');assert.equal(retry.task,result.task);assert.equal(retry.replayed,true);assert.equal(effects,1);
  await assert.rejects(new GuardianActions(root,'session').run('one',{action:'different'},action),/different inputs/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unfinished and failed claims require inspection and cannot repeat uncertain effects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'enigma-guardian-unknown-'));try{
  const log=new GuardianActions(root,'session');let effects=0;
  await assert.rejects(log.run('interrupted',{action:'notify'},async()=>{effects++;throw new Error('reply failed');}),/reply failed/);
  const retry=await log.run('interrupted',{action:'notify'},async()=>{effects++;return {};});assert.equal(retry.needsUser,true);assert.equal(retry.requestState,'unknown');assert.equal(effects,1);
  let release!:()=>void;const original=log.run('pending',{action:'repair'},async()=>{await new Promise<void>(r=>{release=r;});return {task:'actual'};});
  const until=Date.now()+1000;while(!release&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert(release);
  const pending=await new GuardianActions(root,'session').run('pending',{action:'repair'},async()=>{effects++;return {};});assert.equal(pending.requestState,'unknown');release();await original;assert.equal(effects,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
