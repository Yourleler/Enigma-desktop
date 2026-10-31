import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ComputerHost} from '../core/computer-use/computer-host.ts';
import {ComputerProviderRegistry} from '../core/computer-use/provider-registry.ts';
import {createMacosCuaProvider} from '../core/computer-use/providers/macos-cua-provider.ts';
import {createComputerUseTool} from '../lib/tools/computer-use-tool.ts';
import computerPlugin from '../plugins/computer-control/native-tools/computer.ts';
import {createCommandRunner} from '../core/computer-use/providers/command-runner.ts';

/** Real native fixture and shipped plugin. Never reads another app's content,
 * shares a driver socket, or changes the user's saved configuration. */
export async function createComputerLabRuntime({parent,fixture,helper,cursorEnabled=false}) {
  fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'computer-native-'));
  const socketRoot=fs.mkdtempSync(path.join(os.tmpdir(),'enigma-native-'));
  const sessionPath=path.join(root,'new-session.jsonl');fs.writeFileSync(sessionPath,'');
  const fixtureInfo=JSON.parse(fs.readFileSync(fixture));
  const log=fs.openSync(path.join(root,'native-app.log'),'w');
  const child=spawn(fixtureInfo.executable,[root],{stdio:['ignore',log,log]});
  const foregroundChildren=new Set();
  const baseRunner=createCommandRunner({spawnImpl:(command,args,options)=>{
    const process=spawn(command,args,options);
    if(args[0]==='drag_foreground') {foregroundChildren.add(process);process.once('close',()=>foregroundChildren.delete(process));}
    return process;
  }});
  const runner={...baseRunner,run:async(command,args,options)=>{
    const result=await baseRunner.run(command,args,options);
    if(args[0]==='drag_foreground')fs.appendFileSync(path.join(root,'native-command-results.jsonl'),JSON.stringify({...result,aborted:options.signal?.aborted===true})+'\n');
    return result;
  }};
  const provider=createMacosCuaProvider({command:helper,socketPath:path.join(socketRoot,'driver.sock'),cursorEnabled,runner});
  const providers=new ComputerProviderRegistry();providers.register(provider);
  const host=new ComputerHost({providers,defaultProviderId:provider.providerId,getAccessMode:()=> 'operate',getSettings:()=>({enabled:true,app_approvals:[{providerId:provider.providerId,appId:fixtureInfo.bundleId}]})});
  const tool=computerPlugin({getComputerHost:()=>host,getSessionAccessMode:()=> 'operate'},{createComputerUseTool});
  const ctx={sessionPath,sessionId:'new-native-session',sessionManager:{getSessionFile:()=>sessionPath},agentId:'enigma',cwd:root,model:{input:['text','image']}};
  let closed=false;
  const close=async()=>{
    if(closed)return;closed=true;
    await host.dispose();
    if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2500);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
    fs.closeSync(log);fs.rmSync(socketRoot,{recursive:true,force:true});
  };
  fs.writeFileSync(path.join(root,'runtime.json'),JSON.stringify({fixtureApp:fixtureInfo.app,bundleId:fixtureInfo.bundleId,pid:child.pid,root,helper},null,2));
  try {
    let ready=false;
    for(let attempt=0;attempt<50;attempt++) {
      const windows=await host.listWindows(ctx,fixtureInfo.bundleId);
      if(windows.some(window=>window.isOnScreen&&window.bounds?.height>400)){ready=true;break;}
      if(child.exitCode!==null)throw new Error('Native fixture exited during startup');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready)throw new Error('New native fixture did not show its window');
  }catch(error){await close();throw error;}
  return {root,sessionPath,ctx,host,provider,tool,child,fixtureInfo,foregroundChildren,close};
}
