import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {WebSocket} from 'ws';
import assert from 'node:assert/strict';
import {prepareEnigmaProfile} from './enigma-profile.mjs';
import {createInteractionLab} from './create-interaction-lab.mjs';

const app=path.resolve(process.argv[2]),lab=await createInteractionLab({parent:process.argv[3]});
const profile=path.join(lab.root,path.basename(lab.root)+'-desktop');
await prepareEnigmaProfile({dataRoot:profile,workspace:lab.root});
fs.mkdirSync(path.join(profile,'user'),{recursive:true});fs.writeFileSync(path.join(profile,'user/preferences.json'),JSON.stringify({setupComplete:true}));
const cacheName=path.basename(profile).replace(/^./,char=>char.toUpperCase());
const portFile=path.join(os.homedir(),'Library/Application Support',cacheName,'DevToolsActivePort');
const log=fs.openSync(path.join(lab.root,'app.log'),'w');
const env={...process.env,HANA_HOME:profile,ENIGMA_DESKTOP_DATA:profile,ENIGMA_DESKTOP_PRODUCT:'1'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.join(app,'Contents/MacOS/Enigma'),['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env,stdio:['ignore',log,log]});
const clients=[],steps=[];
async function until(fn,label,timeout=25000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch(error){last=error;}if(child.exitCode!==null)throw new Error('Candidate app exited');await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(label+(last?': '+last.message:''));}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});let sequence=0;const pending=new Map();
  socket.on('message',data=>{const value=JSON.parse(data);const item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(new Error(value.error.message)):item.resolve(value.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const client={socket,send,evaluate};clients.push(client);return client;
}
let main;
try {
  const port=await until(()=>fs.existsSync(portFile)&&Number(fs.readFileSync(portFile,'utf8').split('\n')[0]),'Debug port missing');
  const targets=async()=>await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const primary=await until(async()=>(await targets()).find(target=>target.type==='page'&&target.url.includes('/index.html')),'Main renderer missing');
  main=await connect(primary.webSocketDebuggerUrl);
  await until(()=>{const file=path.join(profile,'diagnostics/desktop-launch/renderer.log');return fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes('[hana-launch] app-ready');},'Application bootstrap did not finish');
  await until(()=>main.evaluate("!!document.querySelector('#tbTogglePreview') && !!window.hana.sidebarBrowserBind"),'Application did not initialize');
  const click=async(selector,label)=>{await until(()=>main.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),'Missing '+label);await main.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);steps.push(label);};
  await click('#tbTogglePreview','open preview');
  await until(()=>main.evaluate("document.querySelector('#previewPanel')?.getAttribute('data-preview-open')==='true'"),'Preview panel did not open');
  await click('[aria-label="打开网页浏览器"]','open sidebar browser');
  await until(()=>main.evaluate("document.querySelector('[aria-label=网页地址]')?.disabled===false"),'Sidebar browser failed to bind');
  const navigate=async url=>{
    await main.evaluate(`(()=>{const input=document.querySelector('[aria-label="网页地址"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(url)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await main.evaluate("document.querySelector('.enigma-browser-toolbar').requestSubmit()");
  };
  await navigate(lab.url);
  const browserTarget=await until(async()=>(await targets()).find(target=>target.url===lab.url+'/'),'New lab page missing');
  const page=await connect(browserTarget.webSocketDebuggerUrl);
  await until(()=>page.evaluate("!!document.querySelector('#name')"),'Lab page not loaded');
  await page.evaluate("document.querySelector('#name').value='保留页面输入';document.querySelector('#name').dispatchEvent(new Event('input',{bubbles:true}))");
  await click('[aria-label="收起预览面板"]','collapse preview');
  await click('#tbTogglePreview','restore preview');
  await until(()=>main.evaluate("!!document.querySelector('.enigma-sidebar-browser')"),'Preview did not restore');
  assert.equal(await page.evaluate("document.querySelector('#name').value"),'保留页面输入');steps.push('form survives close/reopen');
  await page.evaluate("[...document.querySelectorAll('a')].find(link=>link.textContent.includes('下载新建测试文本')).click()");
  await until(()=>main.evaluate("document.querySelector('.enigma-browser-downloads')?.textContent.includes('已完成')"),'Standalone browser download did not complete');
  await main.evaluate("document.querySelector('.enigma-browser-downloads summary').click()");
  await main.evaluate("[...document.querySelectorAll('.enigma-browser-download-row button')].find(button=>button.textContent==='预览').click()");
  await until(()=>main.evaluate("document.body.innerText.includes('Enigma 新建测试文本')"),'Downloaded file did not open in preview');
  steps.push('standalone browser download and file preview');
  await main.evaluate("[...document.querySelectorAll('#previewPanel [role=tab]')].find(tab=>tab.textContent.includes('网页')).click()");
  await until(()=>main.evaluate("!!document.querySelector('.enigma-sidebar-browser')"),'Browser preview did not return');
  const pendingPrompt=page.evaluate("window.prompt('新建包内弹窗','默认值')");pendingPrompt.catch(()=>{});
  await until(()=>main.evaluate("!!document.querySelector('[aria-label=网页弹窗输入]')"),'Prompt UI missing');
  await main.evaluate("(()=>{const input=document.querySelector('[aria-label=网页弹窗输入]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'包内中文');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await main.evaluate("[...document.querySelectorAll('.enigma-page-dialog button')].find(button=>button.textContent==='确定').click()");
  assert.equal(await pendingPrompt,'包内中文');steps.push('prompt user response');
  await main.evaluate("[...document.querySelectorAll('.enigma-browser-status button')].find(button=>button.textContent==='独立窗口').click()");
  await until(()=>main.evaluate("document.querySelector('.enigma-sidebar-browser').textContent.includes('放回侧栏')"),'Detach failed');
  assert.equal(await page.evaluate("document.querySelector('#name').value"),'保留页面输入');
  const viewerTarget=await until(async()=>(await targets()).find(target=>target.url.includes('/browser-viewer.html')),'Independent browser toolbar missing');
  const viewer=await connect(viewerTarget.webSocketDebuggerUrl);
  const viewerPrompt=page.evaluate("window.prompt('独立窗口测试','默认')");viewerPrompt.catch(()=>{});
  await until(()=>viewer.evaluate("!!document.querySelector('.enigma-page-dialog')"),'Independent prompt UI missing');
  await viewer.evaluate("[...document.querySelectorAll('.enigma-page-dialog button')].find(button=>button.textContent==='取消').click()");
  assert.equal(await viewerPrompt,null);steps.push('independent browser prompt cancellation');
  await main.evaluate("[...document.querySelectorAll('.enigma-sidebar-browser button')].find(button=>button.textContent==='放回侧栏').click()");
  await until(()=>main.evaluate("document.querySelector('[aria-label=网页地址]')?.disabled===false"),'Redock failed');steps.push('detach and redock without reload');
  const capture=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(lab.root,'page.png'),Buffer.from(capture.data,'base64'));
  fs.writeFileSync(path.join(lab.root,'packaged-browser-ui.json'),JSON.stringify({passed:true,steps,scope:'Real packaged renderer events, preload IPC and WebContentsView. Does not replace macOS AX/mouse occlusion validation.'},null,2));console.log(JSON.stringify({passed:true,root:lab.root,steps}));
}catch(error){const body=await main?.evaluate('document.body.innerText').catch(()=>null);fs.writeFileSync(path.join(lab.root,'packaged-browser-ui.json'),JSON.stringify({passed:false,error:error.message,steps,body},null,2));console.error(JSON.stringify({passed:false,root:lab.root,error:error.message}));process.exitCode=1;}
finally {for(const client of clients)client.socket.close();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});fs.closeSync(log);await lab.close();}
