import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {fauxProvider} from '@earendil-works/pi-ai';
import {Workbench} from '../src/workbench.js';
import {workbenchVerificationEvidence,workbenchRequests} from '../src/operation-history.js';
import {domainAction} from '../src/workbench-domain.js';
import {fixture} from './fixtures.js';
test('manual verification stores a current evidence link outside a clipped large operation transcript', {timeout:30000}, async()=>{
 const {root,workspace}=await fixture(),agentDir=join(root,'agent');let host:Workbench|undefined;
 try{
  await workspace.addCheck({id:'verbose',repo:'library',argv:[process.execPath,'-e','console.log("X".repeat(25000))']});
  const runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:null,refreshOnCreate:false}),faux=fauxProvider();runtime.registerNativeProvider(faux.provider);
  host=await Workbench.open(root,{agentDir,modelRuntime:runtime,provider:faux.getModel().provider,model:faux.getModel().id});
  const chat=await host.create('Manual verification'),controller=await host.conversation(chat.id);
  await controller.perform('运行全部检查',signal=>domainAction(controller,'verify',{},signal),{action:'verify',args:{}});
  assert.equal(controller.operation?.state,'completed');
  const branch=controller.runtime.session.sessionManager.getBranch(),receipt=branch.findLast(entry=>entry.type==='custom_message'&&entry.customType==='enigma.workbench-operation') as any;
  assert.throws(()=>JSON.parse(receipt.content));assert.equal(receipt.details.verificationAttempt,true);
  const evidence=workbenchVerificationEvidence(branch);assert(evidence);assert.equal(receipt.details.verificationEvidence,evidence);
  const requests=workbenchRequests(branch);assert.equal(requests.length,1);assert.equal(requests[0]?.goal,false);assert.equal(requests[0]?.state,'completed');assert.equal(requests[0]?.outcome,'verified');
  assert.equal((await workspace.reusableVerification(evidence))?.status,'verified');
 }finally{await host?.close();await rm(root,{recursive:true,force:true});}
});
