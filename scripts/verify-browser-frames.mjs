import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createBrowserLabRuntime} from './interaction-browser-runtime.mjs';
const runtime=await createBrowserLabRuntime({parent:process.argv[2]});
const {lab,tool,sessionPath}=runtime;
let state='',tabId;
const results=[];
async function call(input, expectedError) {
  const result=await tool.execute(`frame-${results.length}`,input,undefined,undefined,{sessionPath,sessionId:'new-test-session',model:{input:['text','image']}});
  const text=result.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'';
  results.push({input,text,error:result.details?.error});
  if(expectedError){assert(result.isError||result.details?.error,text);assert.match(text,expectedError);return text;}
  assert(!result.isError&&!result.details?.error,text);
  if(text.includes('SnapshotId:'))state=text;
  tabId ||= result.details?.tabId;
  return text;
}
function ref(label) {const line=state.split('\n').find(line=>line.includes(`"${label}"`));assert(line,label);return Number(line.match(/\[(\d+)\]/)[1]);}
const snapshotId=()=>state.match(/SnapshotId: ([\w-]+)/)?.[1];
try {
  await call({action:'navigate',url:lab.url+'/frames.html'});
  const frames=JSON.parse(await call({action:'frames',tabId})).frames.filter(x=>x.url.includes('/frame.html'));
  assert.equal(frames.length,3,'Same-origin, cross-origin and nested frames must be observed');
  for(const frame of frames) {
    const frameId=frame.frameId;
    await call({action:'snapshot',tabId,frameId});
    await call({action:'type',tabId,frameId,snapshotId:snapshotId(),ref:ref('子页面姓名'),text:'子页面中文'});
    await call({action:'key',tabId,frameId,snapshotId:snapshotId(),key:process.platform==='darwin'?'Meta+a':'Control+a'});
    await call({action:'type',tabId,frameId,snapshotId:snapshotId(),ref:ref('子页面姓名'),text:'子页面中文',mode:'append'});
    await call({action:'select',tabId,frameId,snapshotId:snapshotId(),ref:ref('子页面颜色'),value:'green'});
    await call({action:'click',tabId,frameId,snapshotId:snapshotId(),ref:ref('保存子页面')});
    assert(state.includes('已保存：子页面中文；green；可信点击：true'),state);
    await call({action:'upload',tabId,frameId,snapshotId:snapshotId(),ref:ref('子页面上传'),files:[path.join(lab.root,'sample.txt')]});
    assert(state.includes('子页面已读取：Enigma 新建测试文本'),state);
    await call({action:'drag',tabId,frameId,snapshotId:snapshotId(),ref:ref('子页面卡片'),targetRef:ref('子页面落点')});
    assert(state.includes('子页面拖拽成功'),state);
  }
  const oldId=frames[0].frameId;
  await call({action:'snapshot',tabId});
  await call({action:'click',tabId,snapshotId:snapshotId(),ref:ref('移除所有子页面')});
  await call({action:'snapshot',tabId,frameId:oldId},/FRAME_GONE/);
  fs.writeFileSync(path.join(lab.root,'frame-result.json'),JSON.stringify({passed:true,frames,results},null,2));
  console.log(JSON.stringify({passed:true,root:lab.root,frames:frames.length}));
} catch(error) {fs.writeFileSync(path.join(lab.root,'frame-result.json'),JSON.stringify({passed:false,error:error.message,results},null,2));console.error(JSON.stringify({passed:false,root:lab.root,error:error.message}));process.exitCode=1;}
finally {await runtime.close();}
