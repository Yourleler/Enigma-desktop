import assert from 'node:assert/strict';
import test from 'node:test';
import {workbenchOperationHistory,workbenchVerificationEvidence,workbenchRequests,hasWorkbenchGoal}from'../src/operation-history.js';
import {hash} from '../src/storage.js';
test('operation history keeps failed outcomes distinct from successful command settlement and supports older clipped payloads',()=>{
 const history=workbenchOperationHistory([
  {type:'message',message:{role:'user',content:'enigma.workbench-operation'}},
  {type:'custom_message',customType:'enigma.workbench-operation',timestamp:'2026-10-26T01:00:00Z',content:JSON.stringify({id:'valid',title:'运行检查',state:'completed',outcome:'failed',result:{output:'actual error'}})},
  {type:'custom_message',customType:'enigma.workbench-operation',timestamp:'2026-10-26T02:00:00Z',content:'{"truncated":',details:{operation:'clipped',title:'旧检查',state:'completed'}}
 ]);
 assert.equal(history.length,2);assert.equal(history[0]?.payloadIncomplete,true);assert.equal(history[0]?.outcome,undefined);assert.equal(history[1]?.state,'completed');assert.equal(history[1]?.outcome,'failed');assert.equal(history[1]?.output,'actual error');
});
test('current manual checks remain discoverable after clipped output, while failed checks or later agent work supersede them',()=>{
 const old={type:'custom_message',customType:'enigma.workbench-operation',content:JSON.stringify({state:'completed',result:{status:'verified',results:[{}],evidence:'manual-proof'}})};
 assert.equal(workbenchVerificationEvidence([old],'native-before'),'manual-proof');
 const clipped={type:'custom_message',customType:'enigma.workbench-operation',content:'{"clipped":',details:{state:'completed',verificationAttempt:true,verificationEvidence:'large-proof'}};
 assert.equal(workbenchVerificationEvidence([old,clipped],'native-before'),'large-proof');
 const failed={...clipped,details:{state:'failed',verificationAttempt:true}};assert.equal(workbenchVerificationEvidence([old,failed],'native-before'),undefined);
 assert.equal(workbenchVerificationEvidence([old,{type:'message',message:{role:'assistant'}}],'native-after'),'native-after');
 assert.equal(workbenchVerificationEvidence([old,{type:'message',message:{role:'user'}}]),'manual-proof');
 const recipe={...old,content:JSON.stringify({state:'completed',result:{run:{steps:[{kind:'verify',data:{status:'verified',results:[{}],evidence:'recipe-proof'}}]}}})};
 assert.equal(workbenchVerificationEvidence([old,recipe]),'recipe-proof');
});
test('routine operation classification requires exact app metadata and never hides typed or edited user messages',()=>{
 const user={id:'u',parentId:'previous',type:'message',message:{role:'user',content:'请执行工作台操作：预览合并。'}};
 const marker={id:'m',parentId:'u',type:'custom',customType:'enigma.workbench-request',data:{entry:'u',sourceHash:hash(user.message.content),operation:'op',action:'delegate-preview',title:'预览合并',goal:false}};
 const receipt={id:'r',parentId:'m',type:'custom_message',customType:'enigma.workbench-operation',content:'{"clipped":',details:{operation:'op',state:'completed',title:'预览合并'}};
 assert.equal(workbenchRequests([user]).length,0);assert.equal(workbenchRequests([user,marker,receipt])[0]?.state,'completed');
 assert.equal(workbenchRequests([{...user,message:{...user.message,content:'请执行工作台操作：预览合并。额外保留我的数据。'}},marker,receipt]).length,0);
 assert.equal(workbenchRequests([{...user,message:{role:'user',content:[{type:'text',text:user.message.content},{type:'image',data:'added-requirement'}]}},marker,receipt]).length,0);
 assert.equal(workbenchRequests([user,{...marker,parentId:'unrelated'},receipt]).length,0);
 assert.equal(workbenchRequests([user,marker])[0]?.state,'unknown');
 assert(hasWorkbenchGoal({steps:[{goal:'保留接口兼容性'}]}));assert(!hasWorkbenchGoal({query:'goal',title:'查看'}));
});
test('legacy app requests require an exact parent chain and preserve goal-bearing inputs',()=>{
 const meta={id:'m',type:'custom',customType:'enigma.operation-request',data:{title:'查看',request:{action:'code-read',args:{query:'value'}}}};
 const user={id:'u',parentId:'m',type:'message',message:{role:'user',content:'请执行工作台操作：查看。'}};
 const receipt={id:'r',parentId:'u',type:'custom_message',customType:'enigma.workbench-operation',content:JSON.stringify({id:'op',title:'查看',state:'failed',error:'read failed'})};
 assert.equal(workbenchRequests([meta,user,receipt])[0]?.state,'failed');
 assert.equal(workbenchRequests([meta,user,{...receipt,parentId:'other'}]).length,0);
 assert.equal(workbenchRequests([meta,user,{id:'typed',parentId:'u',type:'message',message:{role:'user',content:'还有另一个要求'}},receipt]).length,0);
 const goalMeta={...meta,data:{title:'计划',request:{action:'plan-create',args:{goal:'升级接口'}}}},goalUser={...user,message:{role:'user',content:'请执行工作台操作：计划。\n目标：升级接口'}},goalReceipt={...receipt,content:JSON.stringify({id:'plan-op',title:'计划',state:'completed'})};
 assert.equal(workbenchRequests([goalMeta,goalUser,goalReceipt])[0]?.goal,true);
});
