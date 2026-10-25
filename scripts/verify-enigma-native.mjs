import { homedir as userHomeDirectory } from 'node:os';
import { SubagentThreadStore } from '../lib/subagent-thread-store.ts';
import { SubagentRunStore } from '../lib/subagent-run-store.ts';
import { ActivityHub } from '../lib/activity-hub.ts';
import { DeferredResultStore } from '../lib/deferred-result-store.ts';
import { Hub } from '../hub/index.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import YAML from 'js-yaml';
import { HanaEngine } from '../core/engine.ts';
import { ensureFirstRun } from '../core/first-run.ts';
import { ConfirmStore } from '../lib/confirm-store.ts';
import { engineeringHost } from '../plugins/enigma/host.ts';
import { Workspace } from 'enigma-next';
import { runProcess } from 'enigma-next/process';
import { readJson } from 'enigma-next/storage';

const output=path.resolve(process.argv[2]), live=process.argv.includes('--gateway');
await fs.mkdir(output,{recursive:true});
const root=path.join(output,'workspace'), home=path.join(output,'home');
await fs.mkdir(root,{recursive:true}); await fs.mkdir(home,{recursive:true});
let calls=0, utilityCalls=0, engine, hub, gateway, report; const requestShapes=[];
const responses=[['workspace_graph',{}],['repo_read',{repo:'alpha',path:'value.txt'}],['repo_write',{repo:'alpha',path:'value.txt',content:'after\n'}],['workspace_verify',{}],['final','ENIGMA_NATIVE_DONE']];
let provider, model;
if (live) {
  const existing=JSON.parse(await fs.readFile(process.env.ENIGMA_GATEWAY_CONFIG || userHomeDirectory() + '/code/Enigma-next/.enigma-next/pi-agent/models.json','utf8'));
  provider=existing.providers.gateway; assert.equal(new URL(provider.baseUrl).hostname,'127.0.0.1');
  model=provider.models.find(item=>item.id==='gateway-gpt-6-1-sol'); assert(model);
} else {
  gateway=http.createServer(async(req,res)=>{
    if(req.url?.endsWith('/models')) { res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'native-fixture',object:'model'}]}));return; }
    if(!req.url?.includes('/chat/completions')) {res.writeHead(404);res.end();return;}
    const parts=[];for await(const part of req)parts.push(part);const request=JSON.parse(Buffer.concat(parts).toString());
    const toolNames=(request.tools || []).map(tool=>tool.function?.name || tool.name);
    requestShapes.push({keys:Object.keys(request),tools:toolNames,intent:request.messages?.at(-1)?.content?.slice?.(0,100)});
    const engineering=toolNames.includes('repo_write');
    const index=engineering?calls++:utilityCalls++, response=engineering?(responses[index] || ['final','ENIGMA_NATIVE_DONE']):['final','Fixture utility response'];
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
    const chunk=delta=>({id:`fixture-${index}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'native-fixture',choices:[{index:0,delta,finish_reason:null}]});
    res.write('data: '+JSON.stringify(chunk(response[0]==='final'?{role:'assistant',content:response[1]}:{role:'assistant',tool_calls:[{index:0,id:`call-${index}`,type:'function',function:{name:response[0],arguments:JSON.stringify(response[1])}}]}))+'\n\n');
    const end=chunk({});end.choices[0].finish_reason=response[0]==='final'?'stop':'tool_calls';end.usage={prompt_tokens:500,completion_tokens:30,total_tokens:530};res.write('data: '+JSON.stringify(end)+'\n\n');res.end('data: [DONE]\n\n');
  });await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  provider={api:'openai-completions',apiKey:'fixture-only',baseUrl:`http://127.0.0.1:${gateway.address().port}/v1`};
  model={id:'native-fixture',name:'Native fixture',contextWindow:100000,maxTokens:4000,reasoning:false};
}
const providerId=live?'gateway':'native-fixture';
await fs.writeFile(path.join(home,'added-models.yaml'),YAML.dump({providers:{[providerId]:{base_url:provider.baseUrl,api:provider.api,api_key:provider.apiKey,models:[{id:model.id,name:model.name,context:100000,maxOutput:4000,reasoning:live}]}}}),{mode:0o600});
const agentDir=path.join(home,'agents','enigma');await fs.mkdir(agentDir,{recursive:true});
const config=YAML.load(await fs.readFile(new URL('../lib/config.example.yaml',import.meta.url),'utf8'));
config.agent.name='Enigma';config.locale='zh';config.memory.enabled=false;config.experience.enabled=false;
config.models.chat={id:model.id,provider:providerId};config.models.utility={id:model.id,provider:providerId};config.models.utility_large={id:model.id,provider:providerId};
config.desk={...config.desk,home_folder:root,heartbeat_enabled:false};
await fs.writeFile(path.join(agentDir,'config.yaml'),YAML.dump(config),{mode:0o600});
await fs.writeFile(path.join(agentDir,'AGENTS.md'),'你是 Enigma 工程助理。根据用户要求在明确注册的仓库工作，遵循工具权限、保留源码依据和实际验收结果。');
const workspace=await Workspace.open(root);
for(const id of ['alpha','beta','gamma']) {
 const repo=path.join(root,id);await fs.mkdir(repo,{recursive:true});await fs.writeFile(path.join(repo,'value.txt'),'before\n');
 await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({name:id,version:'1.0.0',...(id==='beta'?{dependencies:{alpha:'*'}}:id==='gamma'?{dependencies:{beta:'*'}}:{})}));
 await fs.writeFile(path.join(repo,'index.js'),`export function ${id}Value() { return '${id}'; }\n`);
 if(id==='gamma') await fs.writeFile(path.join(repo,'check.cjs'),'const fs=require("fs");if(fs.readFileSync("../alpha/value.txt","utf8")!=="after\\n")process.exit(1);console.log("THREE_REPO_JOINT_OK");');
 for(const argv of [['git','init','-q'],['git','add','.'],['git','-c','user.name=Enigma fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture baseline']])assert.equal((await runProcess(argv,repo)).status,'passed');
 await workspace.addRepo(id,repo,{role:id==='alpha'?'producer':id==='beta'?'consumer':'joint verification',access:'write'});
}
await workspace.setDependencies('beta',['alpha']);await workspace.setDependencies('gamma',['beta']);await workspace.addCheck({id:'joint',repo:'gamma',argv:[process.execPath,'check.cjs'],joint:true});
try {
 ensureFirstRun(home,path.resolve('lib'));
 engine=new HanaEngine({hanakoHome:home,productDir:path.resolve('lib'),agentId:'enigma',appVersion:'0.450.0'});
 engine.setConfirmStore(new ConfirmStore({getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
 engine.setSubagentThreadStore(new SubagentThreadStore(path.join(home,'subagent-threads.json'),{getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
 engine.setSubagentRunStore(new SubagentRunStore(path.join(home,'subagent-runs.json'),{getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
 engine.setDeferredResultStore(new DeferredResultStore(null,path.join(home,'deferred-results.json')));
 engine.setActivityHub(new ActivityHub(null,null,{getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
 await engine.init();
 hub = new Hub({engine});
 await engine.initPlugins(hub.eventBus);
 const created=await engine.createSession(null,root,false,null,{visibleInSessionList:true,thinkingLevel:live?'low':'off'});
 created.session.sessionManager.appendMessage({role:'user',content:[{type:'text',text:'保留这个三仓背景，不能删改原联合检查。'}],timestamp:Date.now()});
 await engine.setSessionPermissionModeForSession(created.sessionPath,process.argv.includes('--auto')?'auto':'operate');
 const host=engineeringHost(engine);const connected=await host.connect(created.sessionPath,root,true);assert.equal(connected.connected,true);assert.equal(connected.overview.repositories.length,3);
 const native=engine.getSessionByPath(created.sessionPath);assert(native);const events=[];native.subscribe(event=>{if(['tool_execution_end','agent_settled','agent_end'].includes(event.type))events.push({type:event.type,tool:event.toolName,error:event.isError});});
 const timer=setTimeout(()=>native.abort(),120000);
 try {await native.prompt('这是受控三仓验收：先用 workspace_graph 阅读已注册三仓关系，再用 repo_read 读取 alpha 仓库的 value.txt，用 repo_write 将它写为精确的 after 加一个换行，然后调用 workspace_verify 执行已注册的 joint 检查。不能修改验收命令。最后回复 ENIGMA_NATIVE_DONE。');} finally {clearTimeout(timer);}
 assert.equal(await fs.readFile(path.join(root,'alpha','value.txt'),'utf8'),'after\n');assert(native.getLastAssistantText()?.includes('ENIGMA_NATIVE_DONE'));assert(native.isIdle);
 assert(events.some(event=>event.tool==='repo_write'&&!event.error),JSON.stringify(events));assert(events.some(event=>event.tool==='workspace_verify'&&!event.error),JSON.stringify(events));
 const state=await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`));assert.equal(state.lastVerification,'verified');assert(state.requests>=1);
 const overview=await host.data(created.sessionPath,'project','');assert.equal(overview.repositories.length,3);
 const panels={};
 for(const group of ['project','plan','reading','materials','artifacts','environment','collaboration','timeline','skills','memory','observer','review','handoff','choices']) {
   const value=await host.data(created.sessionPath,group,group==='observer'?'现在有有效进展吗':'');
   panels[group]=value===null?'empty':'available';
 }
 const checkpoints=await workspace.checkpoints(), baseline=checkpoints.find(item=>item.label==='session baseline'), expected=checkpoints.at(-1);
 assert(baseline?.entry); assert(expected);
 native.sessionManager.appendMessage({role:'user',content:[{type:'text',text:'LATEST_NATIVE_REQUIREMENT_KEEP_JOINT_CHECK'}],timestamp:Date.now()});native.refreshContext();
 native.sessionManager.appendMessage({role:'user',content:[{type:'text',text:`下面继续验收会话和恢复：保留原会话，将选定背景复制为另一个新任务；然后明确恢复代码到检查点 ${baseline.id}，预期当前检查点 ${expected.id}，允许 alpha/value.txt 由 after 回到 before，所有原联合检查保持不变。允许切换对应会话上下文并保留最新要求和累计预算。最后从该基线生成三仓隔离代码方案，记录到本次验证目录。`}],timestamp:Date.now()}); native.refreshContext();
 const used=state.requests, controller=await host.controller(created.sessionPath);
 const preFork=await fs.readFile(created.sessionPath,'utf8');
 const originalEntry=native.sessionManager.getBranch().find(entry=>entry.type==='message'&&entry.message.role==='user');
 const fork=await engine.forkSessionAtNode({sessionPath:created.sessionPath,target:{role:'user',entryId:originalEntry.id}});
 assert.equal(await fs.readFile(created.sessionPath,'utf8'),preFork);
 assert.equal((await host.binding(fork.sessionPath)).root,root);
 const forkNative=engine.getSessionByPath(fork.sessionPath);
 const forkState=await readJson(path.join(workspace.data,`session-${forkNative.sessionManager.getSessionId()}.json`));
 assert.equal(forkState.inheritedRequests,used);assert(forkState.requirements.includes('LATEST_NATIVE_REQUIREMENT_KEEP_JOINT_CHECK'));
 await controller.runCommand('new-context',JSON.stringify({goal:'使用选定背景调查另一个相关问题',entries:[{id:originalEntry.id}]}));
 const sessions=await engine.listSessions();
 const background=sessions.filter(item=>item.path!==created.sessionPath&&item.path!==fork.sessionPath).find(item=>item.cwd===root);
 assert(background,'Background context must be registered in Hana');
 const backgroundNative=engine.getSessionByPath(background.path);
 const backgroundState=await readJson(path.join(workspace.data,`session-${backgroundNative.sessionManager.getSessionId()}.json`));
 assert.equal(backgroundState.handoff.mode,'background');assert.equal(backgroundState.inheritedRequests,used);
 assert.equal((await fs.readFile(created.sessionPath,'utf8')),preFork);

 await controller.runCommand('enigma-restore',JSON.stringify({target:baseline.id,expected:expected.id,context:true}));
 assert.equal(await fs.readFile(path.join(root,'alpha','value.txt'),'utf8'),'before\n');
 const restoredState=await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`));
 assert.equal(restoredState.requests,used);assert.equal(restoredState.lastVerification,'unverified');assert(restoredState.reviewEntries.length>0);
 const recovery={physicalRestore:true,requirementsPending:restoredState.reviewEntries.length,requestsPreserved:true,nativeFork:true,backgroundContext:true};
 const alternativeRoot=path.join(root,'code-alternative');
 native.sessionManager.appendMessage({role:'user',content:[{type:'text',text:`明确授权：从检查点 ${baseline.id} 创建三仓独立 worktree 方案，目标目录是已授权工作区内的 ${alternativeRoot}。保持当前源会话、所有原检查和当前工作区代码不变。`}],timestamp:Date.now()}); native.refreshContext();
 const codeFork = await controller.runCommand('branch-code',JSON.stringify({checkpoint:baseline.id,destination:alternativeRoot}));
 assert(codeFork.createdSession?.sessionPath,'Independent code fork must register a native Hana conversation');
 const codeBinding = await host.binding(codeFork.createdSession.sessionPath);
 assert.equal(codeBinding.root,alternativeRoot);
 const alternative = await Workspace.open(codeBinding.root);
 assert.equal(alternative.config.repos.length,3);
 assert.equal(await fs.readFile(path.join(alternative.repo('alpha').root,'value.txt'),'utf8'),'before\n');
 recovery.nativeCodeAlternative=true;

 await engine.setSessionPermissionModeForSession(created.sessionPath,'ask');
 const pending=controller.runCommand('repo-add',JSON.stringify({id:'rejected',path:path.join(root,'alpha')}));
 let pendingError;pending.catch(error=>{pendingError=error;});
 const deadline=Date.now()+5000;while(!host.dialogs.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert(host.dialogs.size>0,'Native user approval must remain visible');
 await host.cancel(created.sessionPath);await pending.catch(()=>{});assert(pendingError);assert(!workspace.config.repos.some(repo=>repo.id==='rejected'));assert.equal(host.dialogs.size,0);
 await engine.setSessionPermissionModeForSession(created.sessionPath,'read_only');
 await assert.rejects(host.action(created.sessionPath,'repo-add',{id:'forbidden',path:path.join(root,'alpha')}),/read-only/);
 assert.equal(await host.confirm(created.sessionPath,{kind:'confirm',title:'read-only boundary',message:'must not dispatch'}),undefined);
 await engine.setSessionPermissionModeForSession(created.sessionPath,'operate');
 recovery.approvalCancelled=true;recovery.readOnlyDenied=true;


 report={status:'verified',pi:'1.4.0',transport:live?'actual Gateway':'controlled HTTP model',model:model.id,calls,utilityCalls,requestShapes,sessionPath:created.sessionPath,sessionId:created.sessionId,nativeSessionId:native.sessionManager.getSessionId(),events,panels,recovery,requests:state.requests,verification:state.lastVerification,scope:'Actual HanaEngine session creation/reload, registered engineering tools, three physical repositories, retained joint check and native settlement. Physical code/context restore retains request accounting and pending original requirements; all domain panel APIs are exercised. UI validation is separate.'};
} catch(error) {report={status:'failed',error:String(error.stack||error),calls,utilityCalls,requestShapes};process.exitCode=1;}
finally {if(hub)await hub.dispose();else if(engine)await engine.dispose();if(gateway)await new Promise(resolve=>gateway.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json')}));}
