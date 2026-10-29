import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {prepareEnigmaProfile} from './enigma-profile.mjs';
import {createPreviewDocuments} from './create-preview-documents.mjs';
const require=createRequire(import.meta.url);
const root=fs.mkdtempSync(path.join(path.resolve(process.argv[2]),'preview-roundtrip-'));
const profile=path.join(root,'server-profile'),files=path.join(root,'new-files');
await prepareEnigmaProfile({dataRoot:profile,workspace:files});
await createPreviewDocuments(files);
const wav=fs.readFileSync(path.join(files,'new.wav')),audio=Buffer.concat([wav.subarray(0,44),...Array.from({length:8},()=>wav.subarray(44))]);audio.writeUInt32LE(audio.length-8,4);audio.writeUInt32LE(audio.length-44,40);fs.writeFileSync(path.join(files,'new.wav'),audio);
const videoEnv={...process.env,ENIGMA_PREVIEW_VIDEO_ROOT:root};delete videoEnv.ELECTRON_RUN_AS_NODE;
const videoCode=await new Promise(resolve=>spawn(require('electron'),['scripts/create-preview-video.cjs'],{env:videoEnv,stdio:'inherit'}).on('exit',resolve));
if(videoCode!==0)throw new Error('Test video creation failed');
fs.writeFileSync(path.join(files,'preview.html'),'<meta charset="utf-8"><h1>新建 HTML 预览</h1><label>备注<input></label><button>测试按钮</button><output></output><img src="./picture.svg" alt="新建测试图片"><script src="./preview-test.js"></script>');
fs.writeFileSync(path.join(files,'preview-test.js'),"document.querySelector('button').onclick=()=>document.querySelector('output').textContent='已点击';");
fs.writeFileSync(path.join(files,'picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="purple"/></svg>');
const fd=fs.openSync(path.join(root,'server.log'),'w');
const server=spawn(process.execPath,['server/main-full.ts'],{env:{...process.env,HANA_HOME:profile,ENIGMA_DESKTOP_DATA:profile,ENIGMA_DESKTOP_PRODUCT:'1',HANA_PORT:'0'},stdio:['ignore',fd,fd]});
try {
  let info;
  for(let i=0;i<200;i++) {
    if(server.exitCode!==null)throw new Error('Preview test server exited');
    try {info=JSON.parse(fs.readFileSync(path.join(profile,'server-info.json')));if(info.port)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!info?.port)throw new Error('Preview test server did not start');
  const env={...process.env,ENIGMA_PREVIEW_TEST_ROOT:root,ENIGMA_PREVIEW_TEST_HOME:profile};delete env.ELECTRON_RUN_AS_NODE;
  const code=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),['scripts/verify-media-controls-runtime.cjs'],{env,stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw new Error('Media controls verification failed');
  console.log(JSON.stringify({passed:true,root}));
} catch(error) {fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:false,error:error.message}));console.error(JSON.stringify({passed:false,root,error:error.message}));process.exitCode=1;}
finally {await new Promise(resolve=>{if(server.exitCode!==null)return resolve();const timer=setTimeout(()=>server.kill('SIGKILL'),4000);server.once('exit',()=>{clearTimeout(timer);resolve();});server.kill('SIGTERM');});fs.closeSync(fd);}
