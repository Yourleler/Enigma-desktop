import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {prepareEnigmaProfile} from './enigma-profile.mjs';
const require=createRequire(import.meta.url);
const root=fs.mkdtempSync(path.join(path.resolve(process.argv[2]),'workbench-markdown-'));
const profile=path.join(root,'new-profile'),files=path.join(root,'new-files');
await prepareEnigmaProfile({dataRoot:profile,workspace:files});
fs.mkdirSync(path.join(files,'images'));fs.mkdirSync(path.join(files,'docs'));
fs.writeFileSync(path.join(files,'start.md'),'# 远端 Markdown 测试\n\n![新建远端图片](./images/picture.svg)\n\n[下一份文档](./docs/next.md)\n');
fs.writeFileSync(path.join(files,'images/picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="purple"/></svg>');
fs.writeFileSync(path.join(files,'docs/next.md'),'# 远端链接打开成功\n\n这份内容只存在于新建的测试文件。\n');
const fd=fs.openSync(path.join(root,'server.log'),'w');
const server=spawn(process.execPath,['server/main-full.ts'],{env:{...process.env,HANA_HOME:profile,ENIGMA_DESKTOP_DATA:profile,ENIGMA_DESKTOP_PRODUCT:'1',HANA_PORT:'0'},stdio:['ignore',fd,fd]});
try {
  let info;
  for(let i=0;i<200;i++) {
    if(server.exitCode!==null)throw new Error('Test server exited');
    try {info=JSON.parse(fs.readFileSync(path.join(profile,'server-info.json')));if(info.port)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!info?.port)throw new Error('Test server did not start');
  const env={...process.env,ENIGMA_PREVIEW_TEST_ROOT:root,ENIGMA_PREVIEW_TEST_HOME:profile};delete env.ELECTRON_RUN_AS_NODE;
  const code=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),['scripts/verify-workbench-markdown-runtime.cjs'],{env,stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw new Error('Remote Markdown interaction failed');
  console.log(JSON.stringify({passed:true,root}));
}catch(error){console.error(JSON.stringify({passed:false,root,error:error.message}));process.exitCode=1;}
finally{await new Promise(resolve=>{if(server.exitCode!==null)return resolve();const timer=setTimeout(()=>server.kill('SIGKILL'),4000);server.once('exit',()=>{clearTimeout(timer);resolve()});server.kill('SIGTERM')});fs.closeSync(fd);}
