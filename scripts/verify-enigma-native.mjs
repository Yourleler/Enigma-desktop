import { loadValidationModel } from './validation-model.mjs';
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
import {ConversationConductor} from '../plugins/enigma/conductor.ts';
import { Workspace,MemoryStore,DocumentationStore,RunObserver,readObserverStatus,guardianConcern } from 'enigma-next';
import { runProcess } from 'enigma-next/process';
import { readJson } from 'enigma-next/storage';

const output=path.resolve(process.argv[2]), live=process.argv.includes('--gateway');
await fs.mkdir(output,{recursive:true});
const root=path.join(output,'workspace'), home=path.join(output,'home');
await fs.mkdir(root,{recursive:true}); await fs.mkdir(home,{recursive:true});
let calls=0, utilityCalls=0, engine, hub, gateway, report,policyCalls=0,reviewCalls=0,failCompaction=false,resumeInitial=0,resumeContinued=0; const requestShapes=[];
const policyResponses=[['repo_write',{repo:'alpha',path:'PLANNING_BYPASS.txt',content:'must be denied'}],['task_plan',{action:'create',goal:'POLICY_TRIAL preserve original check',steps:[{id:'upgrade',repo:'alpha',goal:'upgrade source after planning',checks:['joint']}]}],['agent_phase',{action:'execute'}],['repo_edit',{repo:'alpha',path:'index.js',edits:[{oldText:"return 'alpha';",newText:"return 'alpha-v2';"}]}],['agent_phase',{action:'review',reason:'Review alpha source change and unchanged consumer chain'}],['workspace_verify',{}],['final','ENIGMA_POLICY_DONE']];
const responses=[['workspace_graph',{}],['repo_read',{repo:'alpha',path:'value.txt'}],['repo_write',{repo:'alpha',path:'value.txt',content:'after\n'}],['workspace_verify',{}],['final','ENIGMA_NATIVE_DONE']];
let provider, model;
if (live) {
  const selected = await loadValidationModel();
  provider=selected.provider; model=selected.model;
} else {
  gateway=http.createServer(async(req,res)=>{
    if(req.url?.endsWith('/models')) { res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'native-fixture',object:'model'}]}));return; }
    if(!req.url?.includes('/chat/completions')) {res.writeHead(404);res.end();return;}
    const parts=[];for await(const part of req)parts.push(part);const request=JSON.parse(Buffer.concat(parts).toString());
    const toolNames=(request.tools || []).map(tool=>tool.function?.name || tool.name);
    if(failCompaction&&!toolNames.length){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'controlled compaction transport failure',type:'invalid_request_error'}}));return;}
    const policyTrial=process.argv.includes('--model-policy')&&JSON.stringify(request.messages).includes('POLICY_TRIAL');
    requestShapes.push({keys:Object.keys(request),tools:toolNames,model:request.model,policyTrial,intent:request.messages?.at(-1)?.content?.slice?.(0,100)});
    const engineering=toolNames.includes('repo_write');
    const index=engineering?calls++:utilityCalls++;
    let response=policyTrial&&engineering?(policyResponses[policyCalls++]||['final','ENIGMA_POLICY_DONE']):toolNames.includes('review_read')?(reviewCalls++===0?['review_read',{repo:'alpha',file:'index.js'}]:['final','Frozen alpha/index.js returns alpha-v2 and beta/gamma still consume the string. Original joint does not test this function chain.']):engineering?(responses[index] || ['final','ENIGMA_NATIVE_DONE']):['final','Fixture utility response'];
    if(process.argv.includes('--conductor-resume')&&engineering&&JSON.stringify(request.messages).includes('CONDUCTOR_RESUME_FIXTURE')){
      const resumed=JSON.stringify(request.messages).includes("Resume the user's managed task");
      response=resumed?(resumeContinued++===0?['repo_edit',{repo:'alpha',path:'RESUME.txt',edits:[{oldText:'first',newText:'second'}]}]:['final','WORKER_RESUMED']):(resumeInitial++===0?['repo_write',{repo:'alpha',path:'RESUME.txt',content:'first\n'}]:['final','WORKER_DONE']);
    }
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
 let modelPolicyProbe;
 let memoryDreamProbe;
 let documentationProbe;
 let guardianProbe;
 let compactionProbe;
 let repairProbe;
 let compactionFailureProbe;
 let dependencyProbe;
 let conductorResumeProbe;
 if(process.argv.includes('--conductor-resume')){
   assert(!live,'Coordinator recovery probe uses a controlled HTTP model');
   const manager=await host.createConductor(created.sessionPath,{maxConcurrent:1,maxTasks:2,writableRepos:['alpha'],allowRewind:false,allowedModels:[`${providerId}/${model.id}`]});
   const approval=engine.approvalGateway.review.bind(engine.approvalGateway);
   engine.approvalGateway.review=async()=>({action:'allow',reason:'Controlled fixture explicitly authorizes isolated alpha RESUME.txt only.'});
   let fresh;
   try{
     const original=await workspace.observe(),coordinator=host.conductor(manager.sessionPath),worker=await coordinator.enqueue({title:'接续文件验证',goal:'CONDUCTOR_RESUME_FIXTURE: create only alpha/RESUME.txt with first and a newline. Preserve all other files and checks.',writeRepos:['alpha'],checks:[],requires:[]});
     const until=Date.now()+15000;while((!['completed','failed','cancelled','blocked'].includes(worker.status)||coordinator.active.has(worker.id))&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,25));const initial=(await coordinator.status()).tasks.find(task=>task.id===worker.id);assert.equal(initial.status,'completed',initial.error);
     const child=await Workspace.open(initial.root),file=path.join(child.repo('alpha').root,'RESUME.txt');assert.equal(await fs.readFile(file,'utf8'),'first\n');
     const oldNative=engine.getSessionByPath(initial.sessionPath),sessionId=oldNative.sessionManager.getSessionId(),statePath=path.join(child.data,`session-${sessionId}.json`),previousRequests=(await readJson(statePath)).requests,previousEntries=oldNative.sessionManager.getBranch().length;
     await coordinator.shutdown();await engine.reloadSessionRuntime(initial.sessionPath,{refreshCapabilitySnapshots:true});fresh=new ConversationConductor(host,manager.sessionPath);
     const restored=await fresh.load();assert.equal(restored.tasks[0].sessionPath,initial.sessionPath);assert.equal(restored.tasks[0].root,initial.root);
     await fresh.resume(initial.id,'CONDUCTOR_RESUME_FIXTURE: inspect existing first, replace only that word with second. Preserve original checks and existing files.');
     const complete=Date.now()+15000;while((!['completed','failed','cancelled','blocked'].includes(restored.tasks[0].status)||fresh.active.has(initial.id))&&Date.now()<complete)await new Promise(resolve=>setTimeout(resolve,25));const resumed=(await fresh.status()).tasks.find(task=>task.id===initial.id);assert.equal(resumed.status,'completed',resumed.error);
     assert.equal(await fs.readFile(file,'utf8'),'second\n');assert.equal(engine.getSessionByPath(initial.sessionPath).sessionManager.getSessionId(),sessionId);assert(engine.getSessionByPath(initial.sessionPath).sessionManager.getBranch().length>previousEntries);assert((await readJson(statePath)).requests>previousRequests);assert.deepEqual(await workspace.observe(),original);
     const project=await fresh.project('接续验证项目');await fresh.move(initial.id,project.id);assert.equal((await fresh.load()).tasks[0].projectId,project.id);
     await fresh.restrictLimits({writableRepos:[]});assert.equal((await Workspace.open(child.root)).repo('alpha').access,'read');assert.equal(await fs.readFile(file,'utf8'),'second\n');
     conductorResumeProbe={status:'verified',transport:'controlled HTTP',scope:'fresh coordinator and actual native runtime reload; no whole-host crash simulated',workspaceRetained:true,sessionRetained:true,requestsBefore:previousRequests,requestsAfter:(await readJson(statePath)).requests,parentUnchanged:true,projectMove:true,narrowedRepoReadOnly:true};
   }finally{engine.approvalGateway.review=approval;await fresh?.shutdown();}
 }
 if(process.argv.includes('--dependency-chain')){
   assert(live,'Dependency propagation uses actual Gateway workers');
   const before=await workspace.observe(),checkDefinitions=JSON.stringify(workspace.config.checks);
   const manager=await host.createConductor(created.sessionPath,{maxConcurrent:2,maxTasks:2,writableRepos:['alpha','gamma'],allowRewind:false,allowedModels:[`${providerId}/${model.id}`]});
   const managerNative=engine.getSessionByPath(manager.sessionPath);
   managerNative.sessionManager.appendMessage({role:'user',content:[{type:'text',text:'授权这组隔离任务：上游只改alpha/index.js，把alphaValue返回字符串alpha升级成alpha-v2；后续任务依赖上游实际代码，只可写gamma/UPSTREAM_RESULT.txt，读取并运行gammaValue，把真实stdout写入该文件。保留所有原检查和其他源码，任务结束前不整合父目录。'}],timestamp:Date.now()});managerNative.refreshContext();
   const coordinator=host.conductor(manager.sessionPath),upstream=await coordinator.enqueue({title:'升级上游返回值',goal:'Only edit alpha/index.js: change alphaValue return from alpha to alpha-v2. Keep other files and original checks.',writeRepos:['alpha'],checks:[],requires:[]});
   const downstream=await coordinator.enqueue({title:'用上游实际代码验证消费链',goal:'The upstream task has changed alphaValue to alpha-v2. Read actual local alpha/index.js and gamma/index.js, then run gammaValue from the gamma repository using repo_run and Node. Write only actual stdout to gamma/UPSTREAM_RESULT.txt with a trailing newline. Expected stdout is gamma:beta:alpha-v2. Do not modify any original source or check.',writeRepos:['gamma'],checks:[],requires:[upstream.id]});
   const until=Date.now()+240000;while(coordinator.active.size&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,250));
   const status=await coordinator.status(),up=status.tasks.find(t=>t.id===upstream.id),down=status.tasks.find(t=>t.id===downstream.id);assert.equal(up.status,'completed',up.error);assert.equal(down.status,'completed',down.error);assert.deepEqual(await workspace.observe(),before);
   const child=await Workspace.open(down.root);assert((await fs.readFile(path.join(child.repo('alpha').root,'index.js'),'utf8')).includes('alpha-v2'));assert.equal(await fs.readFile(path.join(child.repo('gamma').root,'UPSTREAM_RESULT.txt'),'utf8'),'gamma:beta:alpha-v2\n');
   const early=await coordinator.preview(down.id);assert.equal(early.applyAllowed,false);assert(early.changes.some(c=>c.reason?.includes('Upstream input')));
   managerNative.sessionManager.appendMessage({role:'user',content:[{type:'text',text:'现在授权按依赖顺序预览并整合：先选择上游alpha改动，再选择下游gamma结果文件。保留全部原检查，每次整合都运行原联合检查。'}],timestamp:Date.now()});managerNative.refreshContext();
   const first=await coordinator.preview(up.id);assert(first.applyAllowed);await coordinator.integrate(first.id);const second=await coordinator.preview(down.id);assert(second.applyAllowed);await coordinator.integrate(second.id);assert.equal(JSON.stringify((await Workspace.open(root)).config.checks),checkDefinitions);
   assert.equal(await fs.readFile(path.join(root,'gamma/UPSTREAM_RESULT.txt'),'utf8'),'gamma:beta:alpha-v2\n');
   dependencyProbe={status:'verified',actualGatewayWorkers:true,downstreamUsesUpstreamCode:true,parentUnchangedUntilSelection:true,downstreamIntegrationRequiresUpstream:true,originalChecksRetained:true};
 }
 if(process.argv.includes('--compaction-failure')){
   assert(!live,'The failure probe uses a controlled HTTP provider');
   const before=await workspace.observe(),checks=JSON.stringify(workspace.config.checks);
   failCompaction=true;let failure;try{await native.compact('Preserve original checks.');}catch(error){failure=String(error);}finally{failCompaction=false;}
   assert(failure,'Actual compaction HTTP failure must reject');
   let observation;const until=Date.now()+3000;do{observation=await readObserverStatus(root,undefined,native.sessionManager.getSessionId());if(observation.available&&observation.recent.some(e=>e.stage==='compaction'&&e.status==='failed'))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);
   assert(observation.available);assert.equal(guardianConcern(observation,1000)?.kind,'compaction');
   const binding=await host.binding(created.sessionPath);binding.guardianEnabled=true;binding.guardian={mode:'managed',stageDeadlineMs:1000,maxInterventions:1,allowedActions:['cancel-and-resume']};await host.saveBinding(created.sessionPath,binding);
   const priorCalls=calls;await host.guardian.act(created.sessionPath,{requestId:'compaction-failure-recovery',action:'cancel-and-resume',reason:'Actual manual compaction failed at HTTP transport. Preserve original requirements and files; report the current state without further edits.',observationId:observation.id,run:observation.run});
   const continued=Date.now()+10000;while((calls===priorCalls||!native.isIdle)&&Date.now()<continued)await new Promise(r=>setTimeout(r,100));assert(calls>priorCalls);assert(native.isIdle);assert.deepEqual(await workspace.observe(),before);assert.equal(JSON.stringify(workspace.config.checks),checks);
   await host.guardian.stop(created.sessionPath);Object.assign(state,await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`)));
   compactionFailureProbe={status:'verified',actualHttpFailure:true,detectedAsCompactionFailure:true,actualMainContinuation:true,originalFilesAndChecksRetained:true};
 }
 if(process.argv.includes('--guardian-repair')){
   assert(live,'Isolated repair uses the actual Gateway worker');
   const component=path.join(root,'alpha/runtime-phase.cjs'),check=path.join(root,'gamma/runtime-check.cjs');
   await fs.writeFile(component,'exports.describe = phase => phase === "done" ? "running" : "running";\n');
   await fs.writeFile(check,'const assert=require("node:assert/strict");const runtime=require("../alpha/runtime-phase.cjs");assert.equal(runtime.describe("done"),"completed");assert.equal(runtime.describe("busy"),"running");console.log("RUNTIME_COMPONENT_OK");\n');
   await workspace.exclusive(()=>workspace.addCheck({id:'runtime-phase',repo:'gamma',argv:[process.execPath,'runtime-check.cjs'],joint:true}));
   const failure=await runProcess([process.execPath,'runtime-check.cjs'],path.join(root,'gamma'));assert.equal(failure.status,'failed');
   const original=await workspace.observe(),checks=JSON.stringify(workspace.config.checks),componentBytes=await fs.readFile(component,'utf8');
   native.sessionManager.appendMessage({role:'user',content:[{type:'text',text:'隔离维修验收授权：alpha/runtime-phase.cjs 的 describe(done) 错误返回 running，gamma/runtime-check.cjs 的原检查已实际失败。允许独立管家创建一个隔离维修工作对话，修正该模块并验证全部原检查；禁止修改检查命令、检查源码或直接整合到原仓库。只返回维修成果供预览。'}],timestamp:Date.now()});native.refreshContext();
   const control=http.createServer(async(request,response)=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({answer:'隔离验收已手动指定维修入口，请只观察',action:'notify',usedModel:false}));});
   await new Promise(resolve=>control.listen(0,'127.0.0.1',resolve));
   try{
     await fs.writeFile(path.join(home,'server-info.json'),JSON.stringify({pid:process.pid,port:control.address().port,token:'repair-fixture-only'}),{mode:0o600});
     await host.guardian.start(created.sessionPath,{mode:'managed',stageDeadlineMs:1000,maxInterventions:1,allowedActions:['propose-repair']});
     const proposed=await host.guardian.act(created.sessionPath,{requestId:'isolated-repair-one',action:'propose-repair',reason:'Actual gamma/runtime-check.cjs failed: alpha/runtime-phase.cjs describe(done) returned running instead of completed. Reproduce using the unchanged original check, repair only runtime-phase.cjs in the isolated child, preserve all other files and the joint check. Do not integrate into original source.'});
     const coordinator=host.conductor(proposed.manager.sessionPath),until=Date.now()+180000;
     while(coordinator.active.size&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,250));
     const report=await coordinator.status(),task=report.tasks.find(task=>task.id===proposed.task);assert.equal(task.status,'completed',task.error||task.result);assert(task.changes.some(change=>change.file==='runtime-phase.cjs'));
     assert.deepEqual(await workspace.observe(),original);assert.equal(await fs.readFile(component,'utf8'),componentBytes);assert.equal(JSON.stringify(workspace.config.checks),checks);
     const childWorkspace=await Workspace.open(task.root),verified=await childWorkspace.exclusive(()=>childWorkspace.verify());assert.equal(verified.status,'verified');
     const beforeDuplicate=report.tasks.length;const duplicate=await host.guardian.act(created.sessionPath,{requestId:'isolated-repair-one',action:'propose-repair',reason:'Actual gamma/runtime-check.cjs failed: alpha/runtime-phase.cjs describe(done) returned running instead of completed. Reproduce using the unchanged original check, repair only runtime-phase.cjs in the isolated child, preserve all other files and the joint check. Do not integrate into original source.'});assert.equal(duplicate.task,proposed.task);assert.equal((await coordinator.status()).tasks.length,beforeDuplicate);
     repairProbe={status:'verified',actualInitialFailure:true,actualGatewayRepairWorker:true,childChecks:verified.status,parentUnchanged:true,requestReplayDoesNotDuplicate:true,changedFiles:task.changes};
     await workspace.exclusive(()=>workspace.checkpoint('after isolated repair fixture',{session:native.sessionManager.getSessionId(),entry:native.sessionManager.getLeafId()||undefined}));
   }finally{await host.guardian.stop(created.sessionPath);control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}
 }
 if(process.argv.includes('--guardian')){
   assert(live,'Guardian recovery practice uses actual Gateway runtime');
   native.sessionManager.appendMessage({role:'user',content:[{type:'text',text:'允许启动独立托管管家，最多两次自动处理。监测到明确的失败阶段或重复失败后允许保留源码和原要求接续，禁止更改或回放原外部操作。此轮检查后只报告当前源码与原检查覆盖，不再修改任何源码。'}],timestamp:Date.now()});native.refreshContext();
   const control=http.createServer(async(request,response)=>{
     if(request.headers.authorization!=='Bearer guardian-fixture-token'){response.writeHead(403);response.end();return;}
     const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
     try{const result=request.url.endsWith('/diagnose')?await host.guardian.diagnose(created.sessionPath,body.question):await host.guardian.act(created.sessionPath,body);response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(result));}catch(error){response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({error:String(error)}));}
   });await new Promise(resolve=>control.listen(0,'127.0.0.1',resolve));
   const observer=await RunObserver.create(root,native.sessionManager.getSessionId(),{heartbeatMs:100});
   const before=await workspace.observe();
   const completedAnswers=session=>session?.sessionManager.getBranch().filter(entry=>entry.type==='message'&&entry.message.role==='assistant'&&entry.message.stopReason==='stop').length||0;
   const answersBefore=completedAnswers(engine.getSessionByPath(created.sessionPath));
   try{
     await fs.writeFile(path.join(home,'server-info.json'),JSON.stringify({pid:process.pid,port:control.address().port,token:'guardian-fixture-token'}),{mode:0o600});
     const started=await host.guardian.start(created.sessionPath,{mode:'managed',stageDeadlineMs:1000,maxInterventions:2,allowedActions:['notify','cancel-and-resume']});assert(started.pid!==process.pid);
     observer.record({kind:'start',stage:'run',id:'guardian-practice'});
     for(let attempt=0;attempt<3;attempt++){const result=await runProcess([process.execPath,'-e','process.stderr.write("controlled failure\\n");process.exit(1)'],root);assert.equal(result.status,'failed');observer.record({kind:'fact',stage:'tool.failed',reference:'controlled-check',fingerprint:'controlled-error',detail:'actual command failed with exit code 1'});}
     await observer.flush();const diagnosis=await host.guardian.diagnose(created.sessionPath,'这些记录能证明什么？应该怎样保留原文件恢复任务？');assert(diagnosis.usedModel);assert(diagnosis.basis.observation.available);
     // Let the separate guardian perform the intervention. A second manual
     // action here races it and correctly fails the stale-observation check.
     // Capability refresh temporarily removes the old runtime. Wait for a new
     // successful answer, not an idle gap or a transient null session lookup.
     const settled=()=>{const session=engine.getSessionByPath(created.sessionPath);return session?.isIdle&&completedAnswers(session)>answersBefore;};
     const deadline=Date.now()+120000;while(!settled()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
     assert(settled(),'Guardian must finish an actual resumed model turn');assert.deepEqual(await workspace.observe(),before);
     const automatic=await host.guardian.status(created.sessionPath);
     assert(automatic?.events.some(event=>event.action==='cancel-and-resume'),'Separate guardian must record its actual recovery');
     await host.guardian.stop(created.sessionPath);assert.equal((await host.binding(created.sessionPath)).guardianEnabled,false);
     guardianProbe={status:'verified',separateProcess:true,automaticRecovery:true,actualFailures:3,independentModelDiagnosis:true,continuedActualMainSession:true,currentFilesPreserved:true,originalRequestsPreserved:true,shutdown:true};
   }finally{await host.guardian.stop(created.sessionPath).catch(()=>{});await observer.close();control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}
   Object.assign(state,await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`)));
 }
 if(process.argv.includes('--documents')){
   assert(live,'Document writing and clean follower practice uses the actual Gateway model');
   const checksBefore=JSON.stringify(workspace.config.checks);
   const timer=setTimeout(()=>native.abort(),180000);try{await engine.promptSession(created.sessionPath,'完成文档专精实践：先读取 alpha/beta/gamma/index.js，使用 repo_edit 把 alphaValue 返回值升级到 alpha-v2，保留 beta/gamma 源码与原检查。仅在 beta 新建 MIGRATION.md，解释本次返回值变化和真实函数消费链，必须有“## 升级步骤”标题。在该章节提供从 gamma 仓库运行的确切 Node 命令与期望 gamma:beta:alpha-v2，不要使用绝对路径或编造设计动机。用 document_work register 登记该章节的一条 source 声明及三个源码行锚点，并登记从 gamma 运行 gammaValue、expected 为 gamma:beta:alpha-v2 的示例。调用 document_work example 实际执行例子，再运行原 workspace_verify，最后回复 ENIGMA_DOCUMENTS_READY。');}finally{clearTimeout(timer);}
   const documents=new DocumentationStore(workspace),registered=await documents.list();assert.equal(registered.length,1,JSON.stringify(registered));
   const document=registered[0];assert(document.examples.some(example=>example.valid),'A real executable example must be current');assert(document.claims.some(claim=>claim.supported));assert.equal(JSON.stringify(workspace.config.checks),checksBefore);
   const manager=await host.createConductor(created.sessionPath,{maxConcurrent:1,maxTasks:1,writableRepos:['gamma'],allowRewind:false,allowedModels:[`${providerId}/${model.id}`]});
   const managerNative=engine.getSessionByPath(manager.sessionPath);managerNative.sessionManager.appendMessage({role:'user',content:[{type:'text',text:'允许一个独立工作对话仅阅读 beta/MIGRATION.md，按里面的迁移步骤从 gamma 运行命令，验证实际输出；仅 gamma 可运行，没有代码修改，也不改原检查。'}],timestamp:Date.now()});managerNative.refreshContext();
   const coordinator=host.conductor(manager.sessionPath),worker=await coordinator.enqueue({title:'独立照迁移文档执行',goal:'Only use beta/MIGRATION.md as task instructions/background. Read the document and follow its exact example from the gamma repo with repo_run. Report the actual command, output and any missing/incorrect steps. Do not edit any source or original checks, do not read the writer transcript, do not claim a static inference as execution. Expected output must come from the document.',writeRepos:['gamma'],checks:[],requires:[]});
   const deadline=Date.now()+180000;while(['queued','creating','running'].includes((await coordinator.load()).tasks.find(task=>task.id===worker.id)?.status)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
   const final=await coordinator.status(),task=final.tasks[0];assert.equal(task.status,'completed',JSON.stringify(task));assert(task.result.includes('gamma:beta:alpha-v2'));assert.equal(task.changes.length,0);
   const entries=engine.getSessionByPath(task.sessionPath).sessionManager.getBranch();assert(entries.some(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='repo_run'&&!entry.message.isError));
   await fs.writeFile(path.join(root,'alpha/index.js'),"export function alphaValue() { return 'alpha-v3'; }\n");const stale=await documents.read(document.record.id);assert(stale.affectedSections.includes('## 升级步骤'));assert(stale.examples.every(example=>!example.valid));
   documentationProbe={status:'verified',transport:'actual Gateway',sourceClaims:document.claims.length,actualExample:true,cleanFollower:true,followerSourceChanges:task.changes.length,sourceVersionInvalidatesClaimAndExample:true,checksRetained:true};
   await workspace.exclusive(()=>workspace.checkpoint('after documentation source invalidation',{session:native.sessionManager.getSessionId(),entry:native.sessionManager.getLeafId()||undefined}));
   Object.assign(state,await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`)));
 }
 if(process.argv.includes('--memory-dream')){
   assert(live,'Memory consolidation uses the actual configured Gateway model');
   const store=await MemoryStore.open(workspace),source=await store.save({kind:'contract',scope:{type:'repositories',repos:['alpha','beta','gamma']},title:'跨仓函数消费链',content:'alpha/index.js 的 alphaValue 返回 alpha。beta 导入 alphaValue，返回 beta 前缀；gamma 导入 betaValue，返回 gamma 前缀。迁移上游返回值需要验证 gammaValue 的真实调用，现有 check.cjs 只检查 alpha/value.txt。',appliesWhen:'这些源码与当前版本一致时进行返回值迁移',origin:{kind:'source',reference:'actual-native-source'},sources:[{repo:'alpha',file:'index.js'},{repo:'beta',file:'index.js'},{repo:'gamma',file:'index.js'}]});
   const run=await host.memoryWork.start(created.sessionPath,[source.id],2),deadline=Date.now()+70000;let status;
   do{await new Promise(resolve=>setTimeout(resolve,250));status=(await host.memoryWork.list(created.sessionPath)).find(item=>item.id===run.id);}while((status?.status==='running'||status?.status==='queued')&&Date.now()<deadline);
   assert.equal(status.status,'ready',JSON.stringify(status));assert(status.candidates.length>0);
   const published=await host.memoryWork.action(created.sessionPath,run.id,'publish');assert(published.memories.length>0);
   const derived=await store.read(published.memories[0]);assert.equal(derived.freshness,'current');assert.equal(derived.record.status,'candidate');assert.equal(derived.record.derivedFrom[0].id,source.id);assert(derived.record.appliesWhen);
   await store.forget(source.id);assert.equal((await store.read(derived.record.id)).freshness,'stale');assert.equal(await store.visible(derived.record.id),false);
   memoryDreamProbe={status:'verified',transport:'actual Gateway',requests:status.requests,candidates:published.memories.length,conditionRetained:true,sourceDeletionInvalidatesSummary:true,scopeRetained:derived.record.scope};
 }
 if(process.argv.includes('--model-policy')){
   assert(!live,'Role-boundary probe deliberately uses controlled physical models');
   await host.configureModelPolicy(created.sessionPath,{mode:'plan-execute',execution:{provider:providerId,id:model.id,thinking:'off'},planning:{provider:providerId,id:alternateModel.id,thinking:'off'},review:{provider:providerId,id:alternateModel.id,thinking:'off'},maxRequests:20});
   const beforeMessages=native.sessionManager.getBranch().length;
   await engine.promptSession(created.sessionPath,'POLICY_TRIAL: first prove planning cannot write; then form the original task plan, execute an alpha source upgrade, request independent review, and verify the unchanged original check.');
   await assert.rejects(fs.access(path.join(root,'alpha/PLANNING_BYPASS.txt')),/ENOENT/);
   assert((await fs.readFile(path.join(root,'alpha/index.js'),'utf8')).includes('alpha-v2'));
   const binding=await host.binding(created.sessionPath),reviewEntry=native.sessionManager.getBranch().findLast(entry=>entry.type==='custom'&&entry.customType==='enigma.independent-model-review');
   assert.equal(binding.modelPolicy.phase,'execution');assert.equal(native.model.id,model.id);assert.equal(reviewEntry.data.status,'completed');assert.equal(reviewEntry.data.requests,2);assert.notEqual(reviewEntry.data.session,created.sessionPath);
   const mainModels=requestShapes.filter(shape=>shape.policyTrial&&shape.tools.includes('repo_write')).map(shape=>shape.model);
   assert.deepEqual(mainModels.slice(0,3),[alternateModel.id,alternateModel.id,alternateModel.id]);assert(mainModels.slice(3).every(id=>id===model.id));
   const reviewer=requestShapes.filter(shape=>shape.tools.includes('review_read'));assert.equal(reviewer.length,2);assert(reviewer.every(shape=>shape.model===alternateModel.id&&!shape.tools.includes('repo_write')));
   assert.equal(binding.modelPolicy.requests,9);
   const used=binding.modelPolicy.requests;await host.configureModelPolicy(created.sessionPath,{mode:'single',execution:{provider:providerId,id:model.id,thinking:'off'}});assert.equal((await host.binding(created.sessionPath)).modelPolicy.requests,used);assert.equal((await host.binding(created.sessionPath)).modelPolicy.maxRequests,20);
   modelPolicyProbe={status:'verified',planningWriteDenied:true,mainModels,reviewerModels:reviewer.map(shape=>shape.model),independentReview:true,mainContextRetained:native.sessionManager.getBranch().length>beforeMessages,sharedRequests:used,budgetRetained:true};
   Object.assign(state,await readJson(path.join(workspace.data,`session-${native.sessionManager.getSessionId()}.json`)));
 }
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
 if(process.argv.includes('--compaction-handoff')){
   assert(live,'Compaction practice requires an actual model summary');
   const requirements=Array.from({length:12},(_,index)=>`长期要求 KEEP_${String(index+1).padStart(2,'0')}: 保留三仓中的原始联合检查。该条验收编号应在压缩后仍能回查，不得用摘要替代来源，不要求创建任何新文件。`);
   for(const text of requirements)native.sessionManager.appendMessage({role:'user',content:[{type:'text',text}],timestamp:Date.now()});
   native.refreshContext();const before=await workspace.observe(),checks=JSON.stringify(workspace.config.checks);
   const timeout=setTimeout(()=>native.abort(),180000);
   try{await native.compact('Summarize this isolated test conversation. Preserve every KEEP_01 through KEEP_12 requirement and the actual original checks. Do not execute or invent new work.');}finally{clearTimeout(timeout);}
   assert(native.sessionManager.getBranch().some(entry=>entry.type==='compaction'),'Native compaction must actually create a summary entry');
   const acceptance=await host.data(created.sessionPath,'acceptance','');
   for(const text of requirements)assert(acceptance.requirements.some(item=>item.text===text),'Original requirement must remain exact in acceptance after compression');
   assert.equal(acceptance.readyForReview,false,'Unassessed original requirements cannot be silently marked complete');
   assert.deepEqual(await workspace.observe(),before);assert.equal(JSON.stringify(workspace.config.checks),checks);
   compactionProbe={status:'verified',originalRequirementCount:requirements.length,exactSourceRetained:true,actualModelCompaction:true,unassessedRequirementsBlockCompletion:true,requirements};
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
 if(compactionProbe){for(const text of compactionProbe.requirements)assert(forkState.requirements.includes(text),'Fork before original updates must retain later requirements');delete compactionProbe.requirements;compactionProbe.nativeForkRetainsLatestRequirements=true;}
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


 report={status:'verified',pi:'1.4.0',transport:live?'actual Gateway':'controlled HTTP model',model:model.id,calls,utilityCalls,requestShapes,sessionPath:created.sessionPath,sessionId:created.sessionId,nativeSessionId:native.sessionManager.getSessionId(),events,panels,recovery,modelRewind,changeReading,conductor,modelPolicyProbe,memoryDreamProbe,documentationProbe,guardianProbe,compactionProbe,repairProbe,compactionFailureProbe,dependencyProbe,conductorResumeProbe,requests:state.requests,verification:state.lastVerification,scope:'Actual HanaEngine session creation/reload, registered engineering tools, three physical repositories, retained joint check and native settlement. Physical code/context restore retains request accounting and pending original requirements; all domain panel APIs are exercised. UI validation is separate.'};
} catch(error) {report={status:'failed',error:String(error.stack||error),calls,utilityCalls,requestShapes};process.exitCode=1;}
finally {if(hub)await hub.dispose();else if(engine)await engine.dispose();if(gateway)await new Promise(resolve=>gateway.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json')}));}
