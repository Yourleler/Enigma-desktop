import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {PluginManager} from '../core/plugin-manager.ts';
import {EventBus} from '../hub/event-bus.ts';
import {createBrowserTool} from '../lib/tools/browser-tool.ts';
import {createBrowserLabRuntime} from './interaction-browser-runtime.mjs';
const runtime=await createBrowserLabRuntime({parent:process.argv[2]});
const {lab,sessionPath}=runtime;
const builtin=path.join(lab.root,'plugins-builtin'),community=path.join(lab.root,'plugins-community');
fs.mkdirSync(builtin);fs.mkdirSync(community);
for(const name of ['browser-control','computer-control'])fs.cpSync(path.join('plugins',name),path.join(builtin,name),{recursive:true});
let disabled=[];
const manager=new PluginManager({pluginsDirs:[builtin,community],dataDir:path.join(lab.root,'plugin-data'),bus:new EventBus(),appVersion:'0.452.70',preferencesManager:{getDisabledPlugins:()=>disabled,setDisabledPlugins:next=>{disabled=next;},getAllowFullAccessPlugins:()=>true}});
const results=[];
try {
  manager.scan();await manager.loadAll();
  const contribution=manager.getNativeToolContribution('browser');assert(contribution);
  const tool=manager.createNativeTool(contribution,[()=>sessionPath,{}],{createBrowserTool});
  const ctx={sessionPath,sessionId:'new-test-session',model:{input:['text','image']}};
  let result=await tool.execute('start',{action:'navigate',url:lab.url},undefined,undefined,ctx);
  assert(!result.isError);const tabId=result.details.tabId;
  const started=Date.now();
  const running=tool.execute('slow-navigation',{action:'navigate',tabId,url:lab.url+'/delayed.html'},undefined,undefined,ctx);
  await new Promise(resolve=>setTimeout(resolve,250));
  await manager.disablePlugin('browser-control',{source:'builtin'});
  result=await running;
  results.push({case:'disable-active-navigation',elapsedMs:Date.now()-started,error:result.details?.error});
  assert(Date.now()-started<5000);assert(result.isError||result.details?.error);
  assert.equal(manager.getPlugin('computer-control',{source:'builtin'}).status,'loaded');
  const blocked=await tool.execute('held-tool',{action:'snapshot',tabId},undefined,undefined,ctx);
  assert.equal(blocked.details.errorCode,'INTERACTION_PLUGIN_DISABLED');results.push({case:'old-session-revoked',passed:true});
  await manager.enablePlugin('browser-control',{source:'builtin'});
  result=await tool.execute('resume',{action:'navigate',tabId,url:lab.url},undefined,undefined,ctx);
  assert(!result.isError);assert(JSON.stringify(result.content).includes('新建交互验收页'));results.push({case:'reenable-restores-operation',passed:true});
  assert.equal(runtime.manager._pending.size,0);
  fs.writeFileSync(path.join(lab.root,'plugin-cancel-result.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,root:lab.root,results}));
}catch(error){fs.writeFileSync(path.join(lab.root,'plugin-cancel-result.json'),JSON.stringify({passed:false,error:error.message,results},null,2));console.error(JSON.stringify({passed:false,root:lab.root,error:error.message}));process.exitCode=1;}
finally{for(const plugin of manager.listPlugins())await manager.unloadPlugin(plugin.id,{pluginKey:plugin.pluginKey});await runtime.close();}
