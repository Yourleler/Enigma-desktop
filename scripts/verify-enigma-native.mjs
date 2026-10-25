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
const alternateModel={...model,id:live?model.id:'native-alternate'};
const providerId=live?'gateway':'native-fixture';
await fs.writeFile(path.join(home,'added-models.yaml'),YAML.dump({providers:{[providerId]:{base_url:provider.baseUrl,api:provider.api,api_key:provider.apiKey,models:[{id:model.id,name:model.name,context:100000,maxOutput:4000,reasoning:live},...(!live?[{id:alternateModel.id,name:'Alternate fixture',context:100000,maxOutput:4000,reasoning:false}]:[])]}}}),{mode:0o600});
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
 await fs.writeFile(path.join(repo,'index.js'),id==='alpha'?"export function alphaValue() { return 'alpha'; }\n":id==='beta'?"import {alphaValue} from '../alpha/index.js';\nexport function betaValue() { return `beta:${alphaValue()}`; }\n":"import {betaValue} from '../beta/index.js';\nexport function gammaValue() { return `gamma:${betaValue()}`; }\n");
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
 let liveSwitch;
 if(process.argv.includes('--switch-model')) {
   assert(!live,'The boundary switch protocol probe uses two controlled models');
   native.subscribe(event=>{if(event.type==='tool_execution_end'&&event.toolName==='workspace_graph')liveSwitch=host.requestModel(created.sessionPath,providerId,alternateModel.id);});
 }
 const timer=setTimeout(()=>native.abort(),120000);
 try {await native.prompt('这是受控三仓验收：先用 workspace_graph 阅读已注册三仓关系，再用 repo_read 读取 alpha 仓库的 value.txt，用 repo_write 将它写为精确的 after 加一个换行，然后调用 workspace_verify 执行已注册的 joint 检查。不能修改验收命令。最后回复 ENIGMA_NATIVE_DONE。');} finally {clearTimeout(timer);}
 assert.equal(await fs.readFile(path.join(root,'alpha','value.txt'),'utf8'),'after\n');assert(native.getLastAssistantText()?.includes('ENIGMA_NATIVE_DONE'));assert(native.isIdle);
 assert(events.some(event=>event.tool==='repo_write'&&!event.error),JSON.stringify(events));assert(events.some(event=>event.tool==='workspace_verify'&&!event.error),JSON.stringify(events));
 const state=await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`));assert.equal(state.lastVerification,'verified');assert(state.requests>=1);
 if(process.argv.includes('--switch-model')) {await liveSwitch;assert.equal(native.model.id,alternateModel.id);assert(native.sessionManager.getBranch().some(entry=>entry.type==='message'&&entry.message.role==='assistant'&&entry.message.model===alternateModel.id));}
 let modelRewind;
 let changeReading;
 let conductor;
 if(process.argv.includes('--conductor-integration')) {
   assert(live,'Managed source/document integration practice uses actual Gateway');
   await workspace.addCheck({id:'consumer-chain',repo:'gamma',argv:[process.execPath,'--input-type=module','-e',"import {gammaValue} from './index.js'; if(gammaValue()!=='gamma:beta:alpha-v2')process.exit(1); console.log('ACTUAL_CONSUMER_CHAIN_OK');"],joint:true});
   const checkDefinitions=JSON.stringify(workspace.config.checks),before=await workspace.observe();
   const manager=await host.createConductor(created.sessionPath,{maxConcurrent:2,maxTasks:3,writableRepos:['alpha','beta'],allowRewind:false,allowedModels:[`${providerId}/${model.id}`]});
   const managerNative=engine.getSessionByPath(manager.sessionPath),coordinator=host.conductor(manager.sessionPath);
   const prompt=async(text)=>{const settle=Date.now()+90000;while(!engine.getSessionByPath(manager.sessionPath).isIdle&&Date.now()<settle)await new Promise(resolve=>setTimeout(resolve,250));assert(engine.getSessionByPath(manager.sessionPath).isIdle,'Manager completion callbacks must settle before the next user input');const timer=setTimeout(()=>engine.abortSession(manager.sessionPath),180000);try{return await engine.promptSession(manager.sessionPath,text);}finally{clearTimeout(timer);}};
   await prompt('实践代码与迁移文档协同：创建一个“上游升级与文档”项目，安排两个独立工作对话并发。第一项只可写 alpha，只把 index.js 的 alphaValue 返回值从 alpha 改为 alpha-v2，保留其他源码和原检查；writeRepos=["alpha"]，checks=[]。第二项只可写 beta，在 beta 新建 MIGRATION.md，根据现有源码说明上游返回值的变更、beta/gamma 的消费链，并给出从 gamma 仓库运行 gammaValue 的确切命令和升级后的预期输出；writeRepos=["beta"]，checks=[]。两个任务 requires=[]，放入同一个项目。不要新建第三个任务，也不要写原仓库。两项结束后先总结结果，暂不整合或验收，等待我下一条要求。');
   const deadline=Date.now()+180000;while(coordinator.active.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
   const ready=await coordinator.status();assert.equal(ready.tasks.length,2);assert(ready.tasks.every(task=>task.status==='completed'),JSON.stringify(ready.tasks.map(task=>({title:task.title,status:task.status,error:task.error}))));
   assert.equal(JSON.stringify(await workspace.observe()),JSON.stringify(before),'Original source must remain unchanged before explicit selection');
   assert(ready.tasks.every(task=>task.changes.length>0),'Source-grounded worker changes must be visible');
   const first=ready.tasks.find(task=>task.writeRepos.includes('alpha')),second=ready.tasks.find(task=>task.writeRepos.includes('beta'));
   const parallelOverlap=Math.max(Date.parse(first.startedAt),Date.parse(second.startedAt))<Math.min(Date.parse(first.finishedAt),Date.parse(second.finishedAt));assert(parallelOverlap);
   await prompt('现在选择两个工作成果：分别用 conductor preview 预览，确认没有冲突后用 integrate 整合到原工作区。不要修改任何原检查或扩展权限。第一次整合时 consumer-chain 应真实验证函数链，第二次整合后再 verify 核对原 joint 和 consumer-chain，然后 report 保存有来源的工作报告。未通过不能声称完成。最后回复 ENIGMA_CONDUCTOR_INTEGRATION_DONE。');
   const done=await coordinator.status();assert(done.acceptance?.valid&&done.acceptance.status==='verified',JSON.stringify(done.acceptance));
   assert.equal(JSON.stringify((await Workspace.open(root)).config.checks),checkDefinitions);
   assert((await fs.readFile(path.join(root,'alpha/index.js'),'utf8')).includes('alpha-v2'));
   const documentation=await fs.readFile(path.join(root,'beta/MIGRATION.md'),'utf8');assert(documentation.includes('gamma:beta:alpha-v2'));assert(documentation.includes('gammaValue'));
   assert(done.reportId,'Report artifact must be registered');const artifacts=await host.registerArtifacts(manager.sessionPath);assert(artifacts.length>0,'Report must be registered in native session files');
   conductor={status:'verified',scenario:'source upgrade plus migration documentation plus actual consumer acceptance',manager,parallelOverlap,originalSourcePreservedUntilSelection:true,workerChanges:ready.tasks.map(task=>({id:task.id,title:task.title,changes:task.changes})),acceptance:done.acceptance,reportId:done.reportId,nativeArtifactFiles:artifacts.length,checksRetained:true,parentAcceptanceNotForged:done.complete===false};
 }
 if(process.argv.includes('--conductor')) {
   assert(live,'Conductor practice uses real Gateway worker conversations');
   const manager=await host.createConductor(created.sessionPath,{maxConcurrent:2,maxTasks:3,writableRepos:[],allowRewind:false,allowedModels:[`${providerId}/${model.id}`]});
   const managerNative=engine.getSessionByPath(manager.sessionPath),beforeFiles=await workspace.observe();
   const managerTimer=setTimeout(()=>managerNative.abort(),180000);
   try {await managerNative.prompt('请实践任务编排管家：用 conductor 创建一个叫“只读双视角核查”的项目，再安排两个独立工作对话并发，只读现有 alpha/beta/gamma 三仓库。任务一读取实际源码，解释函数调用链和项目依赖；任务二读取 package.json 和原 check.cjs，说明当前验收能证明什么和不能证明什么。两个任务的 writeRepos=[]、checks=[]、requires=[]，不修改代码，不新建第三个任务。把两个对话都放到刚创建的项目。不要忙轮询，完成通知会回来。收到结果后核对任务群状态并总结两种视角的互补点，最后回复 ENIGMA_CONDUCTOR_PRACTICE_DONE。');} finally {clearTimeout(managerTimer);}
   const coordinator=host.conductor(manager.sessionPath),deadline=Date.now()+180000;
   while(coordinator.active.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
   const status=await coordinator.status();assert.equal(status.tasks.length,2,JSON.stringify(status.tasks));
   assert(status.tasks.every(task=>task.status==='completed'),JSON.stringify(status.tasks.map(task=>({title:task.title,status:task.status,error:task.error}))));
   assert(status.tasks.every(task=>task.sessionPath&&task.projectId&&task.result));
   const [first,second]=status.tasks;
   const overlap=Math.max(Date.parse(first.startedAt),Date.parse(second.startedAt))<Math.min(Date.parse(first.finishedAt),Date.parse(second.finishedAt));
   assert(overlap,'Actual worker execution intervals must overlap');
   assert.equal(JSON.stringify(await workspace.observe()),JSON.stringify(beforeFiles));
   conductor={status:'verified',manager,projects:status.projects,tasks:status.tasks.map(task=>({id:task.id,title:task.title,sessionId:task.sessionId,status:task.status,result:task.result,startedAt:task.startedAt,finishedAt:task.finishedAt})),parallelOverlap:overlap,originalSourcePreserved:true,parentAcceptanceNotForged:status.complete===false};
 }
 if(process.argv.includes('--change-reading')) {
   assert(live,'Smart-reading probe uses the actual Gateway model');
   const checkRules=JSON.stringify(workspace.config.checks), readingTimer=setTimeout(()=>native.abort(),180000);
   try {await native.prompt('完成这项真实变更阅读验收：使用工程工具读取 alpha/index.js，把 alphaValue 的返回值从 alpha 改为 alpha-v2；不能修改 beta/gamma 源码和原 joint 检查。使用 repo_stage 在 alpha 仓库仅暂存 index.js，然后调用 change_reading action=build kind=staged，目标为“升级 alpha 返回值并说明 beta/gamma 消费链的影响”，生成有源码锚点的中文智能阅读。阅读与全量 diff 需使用同一暂存版本，解释不能宣称已完成业务验收。运行原 joint 检查，最后回复 ENIGMA_SMART_READING_DONE。');} finally {clearTimeout(readingTimer);}
   const panel=await host.data(created.sessionPath,'reading',''), publication=panel.changeReading;
   assert(publication?.record.status==='ready',JSON.stringify(publication?.record.error));
   assert(publication.record.changes.some(file=>file.repo==='alpha'&&file.patch?.includes('alpha-v2')));
   assert(publication.record.reading.nodes.length>0);assert(publication.record.reading.chapters.length>0);
   assert(publication.record.reading.chapters.some(chapter=>chapter.authority==='model-inference'));
   assert.equal(JSON.stringify(workspace.config.checks),checkRules);
   changeReading={status:'verified',id:publication.record.id,version:publication.record.version,source:'staged',files:publication.record.changes.length,sourceNodes:publication.record.reading.nodes.length,chapters:publication.record.reading.chapters.map(chapter=>({title:chapter.title,authority:chapter.authority})),sharedDiffVersion:true};
   Object.assign(state,await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`)));
 }
 if(process.argv.includes('--time-machine')) {
   assert(live,'The time-machine probe uses the actual Gateway model');
   const checksBefore=JSON.stringify(workspace.config.checks);
   const rewindTimer=setTimeout(()=>native.abort(),120000);
   try {await native.prompt('这是模型主动纠偏验收：原目标仍为 alpha/value.txt 精确内容 after 加换行，原 joint 检查不许修改。先探索一条候选：将 alpha/value.txt 改为 before 加换行，再运行原 joint 检查，观察这条候选是否成立。如果检查否定该路线，调用 time_machine list，自己选择这次探索前的可用上下文检查点，然后以独立工具批次调用 time_machine rewind，说明失败原因、需要保留的经验和下一步。回溯后自动继续当前目标，读取实际文件，再改成 after 并跑原 joint。文件不会跟随上下文回溯；不能重放旧已结束操作，不能删除旧失败记录，最后回复 ENIGMA_MODEL_REWIND_DONE。');} finally {clearTimeout(rewindTimer);}
   assert.equal(await fs.readFile(path.join(root,'alpha','value.txt'),'utf8'),'after\n');
   assert.equal(JSON.stringify(workspace.config.checks),checksBefore);
   assert(native.getLastAssistantText()?.includes('ENIGMA_MODEL_REWIND_DONE'));
   const timeline=await host.data(created.sessionPath,'timeline','');
   assert(timeline.modelRewinds.length>0,'Actual model must call and complete context rewind');
   const latest=timeline.modelRewinds.at(-1);assert(latest.reason&&latest.lesson&&latest.nextStep);assert.equal(latest.codeRestored,false);
   const rewindState=await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`));assert.equal(rewindState.lastVerification,'verified');
   modelRewind={status:'verified',record:latest.id,reason:latest.reason,lesson:latest.lesson,nextStep:latest.nextStep,originalChecksRetained:true,currentFilesRetainedDuringRewind:true,automaticContinuation:true};
   Object.assign(state,rewindState);
 }
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


 report={status:'verified',pi:'1.4.0',transport:live?'actual Gateway':'controlled HTTP model',model:model.id,calls,utilityCalls,requestShapes,sessionPath:created.sessionPath,sessionId:created.sessionId,nativeSessionId:native.sessionManager.getSessionId(),events,panels,recovery,modelRewind,changeReading,conductor,requests:state.requests,verification:state.lastVerification,scope:'Actual HanaEngine session creation/reload, registered engineering tools, three physical repositories, retained joint check and native settlement. Physical code/context restore retains request accounting and pending original requirements; all domain panel APIs are exercised. UI validation is separate.'};
} catch(error) {report={status:'failed',error:String(error.stack||error),calls,utilityCalls,requestShapes};process.exitCode=1;}
finally {if(hub)await hub.dispose();else if(engine)await engine.dispose();if(gateway)await new Promise(resolve=>gateway.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json')}));}
