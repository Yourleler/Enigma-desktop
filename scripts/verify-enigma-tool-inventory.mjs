import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import YAML from 'js-yaml';
import {HanaEngine} from '../core/engine.ts';
import {ensureFirstRun} from '../core/first-run.ts';
import {ConfirmStore} from '../lib/confirm-store.ts';
import {Hub} from '../hub/index.ts';
import {engineeringHost} from '../plugins/enigma/host.ts';
import {Workspace} from 'enigma-next';
import {runProcess} from 'enigma-next/process';
import {computeReminderLiveToolAvailability} from '../core/tool-availability.ts';
if(!process.argv[2])throw Error('Provide a new isolated output folder');
const out=path.resolve(process.argv[2]),home=out+'/home',root=out+'/workspace';await fs.mkdir(out);await fs.mkdir(root);await fs.mkdir(home);
let calls=0,engine,hub,report;const requests=[];
const gateway=http.createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);let body;try{body=JSON.parse(Buffer.concat(chunks));}catch{res.writeHead(404);res.end();return;}
 const names=(body.tools||[]).map(tool=>tool.function?.name),toolReply=body.messages?.some(message=>message.role==='tool');
 requests.push({toolNames:names,hasToolReply:toolReply});
 const delta=names.includes('repo_read')&&!toolReply?{role:'assistant',tool_calls:[{index:0,id:'inventory-call',type:'function',function:{name:'repo_read',arguments:JSON.stringify({repo:'source',file:'value.txt'})}}]}:{role:'assistant',content:'INVENTORY_OK'};
 calls++;res.writeHead(200,{'content-type':'text/event-stream'});
 const packet=(delta,finish_reason)=>({id:`inventory-${calls}`,object:'chat.completion.chunk',model:'model',choices:[{index:0,delta,finish_reason}]});
 res.write(`data: ${JSON.stringify(packet(delta,null))}\n\n`);res.write(`data: ${JSON.stringify(packet({},delta.tool_calls?'tool_calls':'stop'))}\n\n`);res.end('data: [DONE]\n\n');
});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
const config=YAML.load(await fs.readFile('lib/config.example.yaml','utf8'));config.agent.name='Enigma';config.locale='zh';config.memory.enabled=false;config.experience.enabled=false;config.models.chat={provider:'inventory-fixture',id:'model'};config.models.utility={...config.models.chat};config.models.utility_large={...config.models.chat};config.desk={...config.desk,home_folder:root,heartbeat_enabled:false};
await fs.mkdir(home+'/agents/enigma',{recursive:true});await fs.writeFile(home+'/agents/enigma/config.yaml',YAML.dump(config));await fs.writeFile(home+'/agents/enigma/AGENTS.md','Use the registered repository tools and preserve original files.');
await fs.writeFile(home+'/added-models.yaml',YAML.dump({providers:{'inventory-fixture':{base_url:`http://127.0.0.1:${gateway.address().port}/v1`,api:'openai-completions',api_key:'fixture-only',models:[{id:'model',name:'Inventory fixture',context:100000,maxOutput:2000,reasoning:false}]}}}));
await fs.mkdir(root+'/source');await fs.writeFile(root+'/source/value.txt','INVENTORY_SOURCE\n');await runProcess(['git','init','-q'],root+'/source');const workspace=await Workspace.open(root);await workspace.addRepo('source',root+'/source',{access:'read'});
try{
 ensureFirstRun(home,path.resolve('lib'));engine=new HanaEngine({hanakoHome:home,productDir:path.resolve('lib'),agentId:'enigma',appVersion:'0.452.18'});engine.setConfirmStore(new ConfirmStore({getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));await engine.init();hub=new Hub({engine});await engine.initPlugins(hub.eventBus);
 const created=await engine.createSession(null,root,false,null,{visibleInSessionList:true,thinkingLevel:'off'});await engine.setSessionPermissionModeForSession(created.sessionPath,'operate');await engineeringHost(engine).connect(created.sessionPath,root,false);
 const native=engine.getSessionByPath(created.sessionPath),entry=engine._sessionCoord._getSessionEntryByPath(created.sessionPath),frozen=[...entry.toolNames],active=native.getActiveToolNames(),callable=new Set(native.getCallableToolNames());
 const extensions=native.extensionRunner.getAllRegisteredTools().map(tool=>tool.definition.name).filter(name=>callable.has(name));
 const unavailable=engine._sessionCoord._computeReminderUnavailableToolNamesForEntry(entry,created.sessionPath),falseOutages=unavailable.filter(name=>extensions.includes(name));
 const reminderUnavailable=engine.renderSessionReminderBlock(created.sessionPath)?.receipt?.unavailableToolNames||[];
 const hostInput=engine._sessionCoord._buildLiveToolAvailabilityInputForEntry(entry,created.sessionPath,{allowGlobalModelFallback:false}),hostOnly=new Set(computeReminderLiveToolAvailability(hostInput.allToolObjects,hostInput.agent.config,hostInput.context).availableToolNames),hostOnlyFalseOutages=frozen.filter(name=>!hostOnly.has(name)&&extensions.includes(name));
 assert.deepEqual(entry.toolNames,frozen);assert.deepEqual(native.getActiveToolNames(),active);
 const events=[];native.subscribe(event=>{if(event.type==='tool_execution_end')events.push({name:event.toolName,error:event.isError,result:JSON.stringify(event.result)?.slice(0,400)});});
 report={verified:false,activeExtensions:extensions.length,hostOnlyFalseOutages,falseOutages,unavailable,reminderUnavailable,requests,events};
 const timer=setTimeout(()=>native.abort(),15000);try{await native.prompt('Read source/value.txt with repo_read and reply INVENTORY_OK. Do not modify files.');}finally{clearTimeout(timer);}
 assert(events.some(event=>event.name==='repo_read'&&!event.error));assert.equal(await fs.readFile(root+'/source/value.txt','utf8'),'INVENTORY_SOURCE\n');
 report={verified:falseOutages.length===0,pi:'1.4.0',activeExtensions:extensions.length,hostOnlyFalseOutages,falseOutages,unavailable,reminderUnavailable,actualRepoReadSucceeded:true,frozenAndActiveToolsUnchanged:true,calls,requests,events};
 assert(!reminderUnavailable.some(name=>extensions.includes(name)),'Model-input reminder must agree with callable extensions');
 if(!process.argv.includes('--observe'))assert.equal(falseOutages.length,0,'Registered callable Pi tools must not be reported unavailable');
}catch(error){report={...report,verified:false,error:String(error.stack||error)};process.exitCode=1;}
finally{if(hub)await hub.dispose();else await engine?.dispose();gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
