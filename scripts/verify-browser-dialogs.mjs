import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createBrowserLabRuntime} from './interaction-browser-runtime.mjs';
const runtime=await createBrowserLabRuntime({parent:process.argv[2]});
const {lab,tool,sessionPath}=runtime;
let text='',tabId;
const steps=[];
async function call(input,expectedError=false){
  const started=Date.now();
  const result=await tool.execute(`dialog-${steps.length}`,input,undefined,undefined,{sessionPath,sessionId:'new-test-session',model:{input:['text','image']}});
  const output=result.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'';
  steps.push({input,elapsedMs:Date.now()-started,output,error:result.details?.error});
  assert.equal(!!(result.isError||result.details?.error),expectedError,output);
  if(!expectedError){text=output;tabId ||= result.details?.tabId;}
  return output;
}
const ref=label=>{const row=text.split('\n').find(line=>line.includes(`"${label}"`));assert(row,label);return Number(row.match(/\[(\d+)\]/)[1]);};
const snapshot=()=>text.match(/SnapshotId: ([\w-]+)/)?.[1];
try{
  await call({action:'navigate',url:lab.url});
  for(const [label,type,accept,value,expected] of [
    ['打开 alert 测试','alert',true,undefined,'提示已关闭'],
    ['打开 confirm 测试','confirm',false,undefined,'确认已拒绝'],
    ['打开 confirm 测试','confirm',true,undefined,'确认已接受'],
    ['打开 prompt 测试','prompt',true,'中文备注','备注：中文备注'],
    ['打开 prompt 测试','prompt',false,undefined,'输入已取消'],
  ]){
    const started=Date.now();
    await call({action:'click',tabId,snapshotId:snapshot(),ref:ref(label)});
    assert(Date.now()-started<8000,'A dialog must not stall the tool loop');
    const {dialog}=JSON.parse(await call({action:'dialog',tabId}));
    assert.equal(dialog.type,type);assert(dialog.dialogId);
    await call({action:'handle_dialog',tabId,dialogId:'stale',accept:true},true);
    await call({action:'handle_dialog',tabId,dialogId:dialog.dialogId,accept,...(value?{text:value}:{})});
    assert(text.includes(expected),text);
  }
  fs.writeFileSync(path.join(lab.root,'dialog-result.json'),JSON.stringify({passed:true,steps},null,2));console.log(JSON.stringify({passed:true,root:lab.root,steps:steps.length}));
}catch(error){fs.writeFileSync(path.join(lab.root,'dialog-result.json'),JSON.stringify({passed:false,error:error.message,steps},null,2));console.error(JSON.stringify({passed:false,root:lab.root,error:error.message}));process.exitCode=1;}
finally{await runtime.close();}
