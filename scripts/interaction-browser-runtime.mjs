import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import readline from 'node:readline';
import {createInteractionLab} from './create-interaction-lab.mjs';
import {BrowserManager} from '../lib/browser/browser-manager.ts';
import createBrowserTool from '../plugins/browser-control/native-tools/browser.ts';
import {createBrowserTool as createHostBrowserTool} from '../lib/tools/browser-tool.ts';
import {SessionFileRegistry} from '../lib/session-files/session-file-registry.ts';

/** One isolated lab per process. Its files and profile never overlap the
 * user's application/browser profile. Uses the shipped plugin entry point. */
export async function createBrowserLabRuntime({parent=os.tmpdir()}={}) {
  const require=createRequire(import.meta.url);
  const lab=await createInteractionLab({parent});
  const sessionPath=path.join(lab.root,'new-test-session.jsonl');fs.writeFileSync(sessionPath,'');
  const stderr=fs.openSync(path.join(lab.root,'electron-stderr.log'),'w');
  const env={...process.env,ENIGMA_LAB_ROOT:lab.root,ENIGMA_LAB_URL:lab.url};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[path.resolve('tests/fixtures/interaction-lab/electron-driver.cjs')],{env,stdio:['pipe','pipe',stderr]});
  const wire=new EventEmitter();wire.readyState=1;wire.send=data=>child.stdin.write(data+'\n');
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const startup=setTimeout(()=>readyReject(new Error('Test browser did not start')),20000);
  readline.createInterface({input:child.stdout}).on('line',line=>{
    if(!line.startsWith('ENIGMA_INTERACTION '))return;
    const msg=JSON.parse(line.slice('ENIGMA_INTERACTION '.length));
    if(msg.type==='ready'){clearTimeout(startup);readyResolve();}else wire.emit('message',Buffer.from(JSON.stringify(msg)));
  });
  child.on('error',readyReject);child.on('exit',code=>{wire.readyState=3;readyReject(new Error(`Test browser exited: ${code}`));});
  BrowserManager.setHanakoHome(lab.root);const manager=BrowserManager.instance();
  const files=new SessionFileRegistry({managedCacheRoot:lab.root,getSessionIdForPath:()=> 'new-test-session'});
  const tool=createBrowserTool(()=>sessionPath,{getHanakoHome:()=>lab.root,getSessionIdForPath:()=> 'new-test-session',registerSessionFile:entry=>files.registerFile(entry),getAuthorizedFolders:()=>[lab.root],resolveSessionFile:(id,ctx)=>files.get(id,ctx)}, {createBrowserTool:createHostBrowserTool});
  let closing;
  const close=()=>closing??=(async()=>{
    clearTimeout(startup);
    try{await manager.runWithSignal(AbortSignal.timeout(2500),()=>manager.close(sessionPath));}catch{}
    manager.setWsTransport(null);
    let forcedExit=false;
    if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{
      const timer=setTimeout(()=>{forcedExit=true;child.kill('SIGKILL');},2000);
      child.once('exit',()=>{clearTimeout(timer);resolve();});
      if(!child.stdin.destroyed)child.stdin.end(JSON.stringify({type:'shutdown'})+'\n');
      else child.kill('SIGTERM');
    });
    await lab.close();fs.closeSync(stderr);
    fs.writeFileSync(path.join(lab.root,'lifecycle.json'),JSON.stringify({closed:true,forcedExit}));
  })();
  try { await ready;manager.setWsTransport(wire);return {lab,sessionPath,manager,files,tool,close}; }
  catch(error){await close();throw error;}
}
