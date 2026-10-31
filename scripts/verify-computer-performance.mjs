import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createComputerLabRuntime} from './interaction-computer-runtime.mjs';

// The caller supplies a newly built disposable native fixture, never an
// existing user app. Measure the actual plugin and helper, including snapshots.
const [parent,fixture,helper]=process.argv.slice(2);
if(!parent||!fixture||!helper)throw Error('Provide output parent, new fixture manifest and helper path');
const results=[];
for(const cursorEnabled of [false,true]){
 const lab=await createComputerLabRuntime({parent,fixture,helper,cursorEnabled});
 let text='',last;const steps=[];
 const call=async input=>{const start=performance.now();last=await lab.tool.execute('performance',input,undefined,undefined,lab.ctx);text=last.content.filter(v=>v.type==='text').map(v=>v.text).join('\n');steps.push({action:input.action,elapsedMs:Math.round((performance.now()-start)*10)/10,error:last.details?.errorCode||null});assert(!last.isError&&!last.details?.error,text);return last;};
 const element=label=>text.split('\n').find(line=>line.includes('"'+label+'"'))?.match(/^- (\d+):/)?.[1];
 try{
  const target=(await lab.host.listWindows(lab.ctx,lab.fixtureInfo.bundleId)).find(w=>w.isOnScreen&&w.bounds.height>400);assert(target);
  await call({action:'start',appId:lab.fixtureInfo.bundleId,windowId:target.windowId});
  for(let i=0;i<5;i++)await call({action:'get_app_state'});
  const field=element('原生姓名输入');assert(field);
  for(let i=0;i<5;i++)await call({action:'set_value',elementId:field,value:'速度验证'+i});
  for(let i=0;i<5;i++)await call({action:'click_element',elementId:element('保存新建回执')});
  const receipt=JSON.parse(fs.readFileSync(path.join(lab.root,'native-receipt.json'),'utf8'));assert.equal(receipt.name,'速度验证4');
  const stats={};for(const action of ['get_app_state','set_value','click_element']){const values=steps.filter(s=>s.action===action).map(s=>s.elapsedMs).sort((a,b)=>a-b);stats[action]={samples:values.length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.ceil(values.length*.95)-1]};}
  const result={passed:true,root:lab.root,cursorEnabled,stats,steps,scope:'Actual native fixture only; action timings include refreshed screenshot/AX state, exclude model inference.'};results.push(result);fs.writeFileSync(path.join(lab.root,'performance.json'),JSON.stringify(result,null,2));
 }finally{await lab.close();}
}
console.log(JSON.stringify({passed:true,results}));
