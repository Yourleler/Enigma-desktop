import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBrowserLabRuntime } from './interaction-browser-runtime.mjs';
const runtime=await createBrowserLabRuntime({parent:process.argv[2]||os.tmpdir()});
const {lab,sessionPath,manager,files,tool}=runtime;
const steps=[];let state='';
const text=result=>result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')||'';
const identity=()=>({tabId:state.match(/Browser tabId \(copy exactly\): "([^"]+)"/)?.[1],snapshotId:state.match(/SnapshotId: ([\w-]+)/)?.[1]});
function ref(label){const row=state.split('\n').find(line=>line.includes(`"${label}"`));const value=row?.match(/\[(\d+)\]/)?.[1];if(!value)throw new Error(`No observed ref: ${label}`);return Number(value);}
async function call(input,{expectError=false}={}){
  const started=Date.now();const result=await tool.execute(`lab-${steps.length}`,input,undefined,undefined,{sessionPath,sessionId:'new-test-session',model:{input:['text','image']}});
  steps.push({action:input.action,elapsedMs:Date.now()-started,error:result.details?.error||null});
  if(!expectError&&(result.isError||result.details?.error))throw new Error(text(result));
  if(expectError&&!result.isError&&!result.details?.error)throw new Error('Expected a stale observation rejection');
  if(!expectError&&text(result).includes('SnapshotId:'))state=text(result);
  return result;
}
try{
  await call({action:'start'});await call({action:'navigate',url:lab.url});
  for(const [label,value] of [['姓名','林雨'],['数量','3'],['备注','第一行测试\n第二行测试']])await call({action:'type',...identity(),ref:ref(label),text:value});
  await call({action:'select',...identity(),ref:ref('颜色'),value:'blue'});
  await call({action:'click',...identity(),ref:ref('确认测试内容')});
  await call({action:'click',...identity(),ref:ref('生成测试回执')});
  if(!state.includes('回执已生成'))await call({action:'wait',tabId:identity().tabId,text:'回执已生成',timeout:5000});
  if(!state.includes('回执已生成'))throw new Error('The visible receipt was not generated');
  const receipt=JSON.parse(fs.readFileSync(path.join(lab.root,'receipts.jsonl'),'utf8').trim().split('\n').at(-1));
  if(receipt.data.name!=='林雨'||receipt.data.quantity!=='3'||receipt.data.color!=='blue'||receipt.data.note!=='第一行测试\n第二行测试')throw new Error('The saved receipt differs from the requested form');
  const old={...identity(),ref:ref('生成测试回执')};await call({action:'snapshot'});
  await call({action:'click',...old},{expectError:true});
  await call({action:'upload',...identity(),ref:ref('选择新建测试文件'),files:[path.join(lab.root,'sample.txt')]});
  if(!state.includes('已读取 sample.txt'))throw new Error('The uploaded file was not read by the page');
  const attachment=files.registerFile({sessionPath,sessionId:'new-test-session',filePath:path.join(lab.root,'sample.md'),origin:'user_upload'});
  await call({action:'upload',...identity(),ref:ref('选择新建测试文件'),fileIds:[attachment.id]});
  if(!state.includes('已读取 sample.md'))throw new Error('The attachment upload was not read by the page');
  await call({action:'double_click',...identity(),ref:ref('双击测试区域')});
  if(!state.includes('双击成功'))throw new Error('The real double click did not reach the page');
  const download=await call({action:'download',tabId:identity().tabId,url:lab.url+'/sample.txt'});
  const downloaded=download.details?.downloads?.find(item=>item.state==='completed');
  if(!downloaded?.file?.fileId)throw new Error('The download was not registered as a real session file');
  if(fs.readFileSync(downloaded.filePath,'utf8')!==fs.readFileSync(path.join(lab.root,'sample.txt'),'utf8'))throw new Error('The downloaded content does not match');
  await call({action:'downloads',tabId:identity().tabId});
  await call({action:'new_tab',url:lab.url+'/second.html'});
  if(!state.includes('第二个测试页面'))throw new Error('The new tab did not show the second page');
  const screenshot=await call({action:'screenshot',tabId:identity().tabId});
  const image=screenshot.content.find(item=>item.type==='image');if(!image?.data)throw new Error('No real browser screenshot');
  fs.writeFileSync(path.join(lab.root,'browser-final.jpg'),Buffer.from(image.data,'base64'));
  fs.writeFileSync(path.join(lab.root,'result.json'),JSON.stringify({passed:true,steps,receipt,scope:'real browser tool/manager and production observation/input module; model and full desktop viewer not tested here'},null,2));
  console.log(JSON.stringify({passed:true,root:lab.root,steps:steps.length}));
}catch(error){fs.writeFileSync(path.join(lab.root,'result.json'),JSON.stringify({passed:false,error:error.message,steps,lastObservation:state},null,2));console.error(JSON.stringify({passed:false,root:lab.root,error:error.message}));process.exitCode=1;}
finally{await runtime.close();}
