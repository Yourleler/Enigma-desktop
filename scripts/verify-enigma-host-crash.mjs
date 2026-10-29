import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'js-yaml';
import { Workspace } from 'enigma-next';
import { runProcess } from 'enigma-next/process';
import { readJson } from 'enigma-next/storage';

const repoRoot=fileURLToPath(new URL('..',import.meta.url));
const worker=process.argv[2]==='--worker',phase=worker?process.argv[3]:undefined;
const output=path.resolve(process.argv[worker?4:2]||'');
if(!process.argv[worker?4:2])throw Error('Provide a new isolated output directory');
const root=path.join(output,'workspace'),home=path.join(output,'home');
const definitions=[{key:'A',repo:'alpha',file:'CRASH_A.txt'},{key:'B',repo:'beta',file:'CRASH_B.txt'}];
const until=async(predicate,label,timeout=45000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(`Timed out: ${label}`);};

if(worker){
  const { HanaEngine }=await import('../core/engine.ts');
  const { ensureFirstRun }=await import('../core/first-run.ts');
  const { ConfirmStore }=await import('../lib/confirm-store.ts');
  const { SubagentThreadStore }=await import('../lib/subagent-thread-store.ts');
  const { SubagentRunStore }=await import('../lib/subagent-run-store.ts');
  const { DeferredResultStore }=await import('../lib/deferred-result-store.ts');
  const { ActivityHub }=await import('../lib/activity-hub.ts');
  const { Hub }=await import('../hub/index.ts');
  const { engineeringHost }=await import('../plugins/enigma/host.ts');
  ensureFirstRun(home,path.join(repoRoot,'lib'));
  const engine=new HanaEngine({hanakoHome:home,productDir:path.join(repoRoot,'lib'),agentId:'enigma',appVersion:'0.452.15'});
  engine.setConfirmStore(new ConfirmStore({getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
  engine.setSubagentThreadStore(new SubagentThreadStore(path.join(home,'subagent-threads.json'),{getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
  engine.setSubagentRunStore(new SubagentRunStore(path.join(home,'subagent-runs.json'),{getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
  engine.setDeferredResultStore(new DeferredResultStore(null,path.join(home,'deferred-results.json')));
  engine.setActivityHub(new ActivityHub(null,null,{getSessionIdForPath:file=>engine.getSessionIdForPath(file)}));
  let hub;
  const watchdog=setTimeout(()=>process.exit(2),120000);
  try{
    await engine.init();hub=new Hub({engine});await engine.initPlugins(hub.eventBus);
    // The verification driver, not a model, grants only this disposable fixture.
    engine.approvalGateway.review=async()=>({action:'allow',reason:'Controlled test authorizes only the isolated CRASH_A/B files under the declared write grants.'});
    const host=engineeringHost(engine);
    if(phase==='initial'){
      const source=await engine.createSession(null,root,false,null,{visibleInSessionList:true,thinkingLevel:'off'});
      await engine.setSessionPermissionModeForSession(source.sessionPath,'operate');await host.connect(source.sessionPath,root,false);
      const manager=await host.createConductor(source.sessionPath,{maxConcurrent:2,maxTasks:2,writableRepos:['alpha','beta'],allowRewind:false,allowedModels:['crash-fixture/model']});
      const conductor=host.conductor(manager.sessionPath),tasks=[];
      for(const def of definitions)tasks.push(await conductor.enqueue({title:`宿主中断验证 ${def.key}`,goal:`HOST_CRASH_${def.key}: write only ${def.repo}/${def.file} with first-${def.key} and a newline. Preserve all other source files and original checks.`,writeRepos:[def.repo],checks:[],requires:[]}));
      await until(()=>tasks.every(task=>task.root&&task.sessionPath&&task.piSessionId),'workers attached');
      const fixture={sourcePath:source.sessionPath,managerPath:manager.sessionPath,tasks:tasks.map(task=>({id:task.id,root:task.root,sessionPath:task.sessionPath,piSessionId:task.piSessionId,goal:task.goal}))};
      await fs.writeFile(path.join(output,'fixture.json'),JSON.stringify(fixture,null,2));process.send?.({type:'ready',pid:process.pid});
      process.on('message',()=>{});await new Promise(()=>{});
    }else{
      const fixture=await readJson(path.join(output,'fixture.json'));
      await engine.ensureSessionLoaded(fixture.managerPath);
      const conductor=host.conductor(fixture.managerPath),status=await conductor.status();
      const restored={pid:process.pid,tasks:status.tasks.map(task=>({id:task.id,status:task.status,error:task.error,root:task.root,sessionPath:task.sessionPath,progress:task.progress,executionActive:task.executionActive}))};
      await fs.writeFile(path.join(output,'restored.json'),JSON.stringify(restored,null,2));process.send?.({type:'restored',pid:process.pid});
      await new Promise(resolve=>process.once('message',message=>{assert.equal(message,'resume');resolve();}));
      for(const task of fixture.tasks)await conductor.resume(task.id,'Inspect the existing first value; change first to second only. Keep the same task, file and original checks.');
      await until(async()=>{const ledger=await conductor.load();return ledger.tasks.every(task=>['completed','failed','cancelled','blocked'].includes(task.status))&&conductor.active.size===0;},'resumed workers settled');
      const final=await conductor.status(),proof=[];
      for(const task of final.tasks){
        assert.equal(task.status,'completed',task.error);const prior=fixture.tasks.find(item=>item.id===task.id);assert.equal(task.root,prior.root);assert.equal(task.sessionPath,prior.sessionPath);
        const native=engine.getSessionByPath(task.sessionPath);assert.equal(native.sessionManager.getSessionId(),prior.piSessionId);
        const child=await Workspace.open(task.root),def=definitions.find(d=>task.goal.includes(`HOST_CRASH_${d.key}`));
        const text=await fs.readFile(path.join(child.repo(def.repo).root,def.file),'utf8');assert.equal(text,`second-${def.key}\n`);
        const accounting=await readJson(path.join(child.data,`session-${prior.piSessionId}.json`));
        const users=native.sessionManager.getBranch().filter(entry=>entry.type==='message'&&entry.message.role==='user');
        assert(JSON.stringify(users).includes(`HOST_CRASH_${def.key}`));
        proof.push({id:task.id,root:task.root,sessionPath:task.sessionPath,piSessionId:prior.piSessionId,requests:accounting.requests,entries:native.sessionManager.getBranch().length,originalUserRequirementRetained:true,text});
      }
      await fs.writeFile(path.join(output,'resumed.json'),JSON.stringify({verified:true,pid:process.pid,tasks:proof},null,2));
      process.send?.({type:'completed',pid:process.pid});
    }
  }catch(error){await fs.writeFile(path.join(output,`${phase}-error.txt`),String(error.stack||error));process.exitCode=1;}
  finally{clearTimeout(watchdog);if(hub)await hub.dispose();else await engine.dispose();process.disconnect?.();}
}else{
  await fs.mkdir(output);await fs.mkdir(root);await fs.mkdir(home);
  let mode='initial',counter=0;const held=new Map(),calls={initial:{A:0,B:0},resume:{A:0,B:0}};
  const gateway=http.createServer(async(req,res)=>{
    if(req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'model'}]}));return;}
    if(!req.url?.includes('/chat/completions')){res.writeHead(404);res.end();return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks)),tools=(request.tools||[]).map(tool=>tool.function?.name);
    const def=tools.includes('repo_write')&&definitions.find(d=>JSON.stringify(request.messages).includes(`HOST_CRASH_${d.key}`));
    let action=['final','Controlled utility result'];
    if(def){const n=calls[mode][def.key]++;if(mode==='initial'&&n>0){held.set(def.key,res);return;}
      action=mode==='initial'?['repo_write',{repo:def.repo,path:def.file,content:`first-${def.key}\n`}]
        :n===0?['repo_read',{repo:def.repo,path:def.file}]:n===1?['repo_edit',{repo:def.repo,path:def.file,edits:[{oldText:`first-${def.key}`,newText:`second-${def.key}`}]}]:['final',`HOST_CRASH_${def.key}_RESUMED`];
    }
    const id=++counter,delta=action[0]==='final'?{role:'assistant',content:action[1]}:{role:'assistant',tool_calls:[{index:0,id:`crash-${id}`,type:'function',function:{name:action[0],arguments:JSON.stringify(action[1])}}]};
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({id:`response-${id}`,object:'chat.completion.chunk',model:'model',choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
    res.write(`data: ${JSON.stringify({id:`response-${id}`,object:'chat.completion.chunk',model:'model',choices:[{index:0,delta:{},finish_reason:action[0]==='final'?'stop':'tool_calls'}],usage:{prompt_tokens:500,completion_tokens:30,total_tokens:530}})}\n\n`);res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  const provider={base_url:`http://127.0.0.1:${gateway.address().port}/v1`,api:'openai-completions',api_key:'fixture-only',models:[{id:'model',name:'Host crash fixture',context:100000,maxOutput:4000,reasoning:false}]};
  await fs.writeFile(path.join(home,'added-models.yaml'),YAML.dump({providers:{'crash-fixture':provider}}));
  const config=YAML.load(await fs.readFile(path.join(repoRoot,'lib/config.example.yaml'),'utf8'));config.agent.name='Enigma';config.locale='zh';config.memory.enabled=false;config.experience.enabled=false;
  config.models.chat={id:'model',provider:'crash-fixture'};config.models.utility={...config.models.chat};config.models.utility_large={...config.models.chat};config.desk={...config.desk,home_folder:root,heartbeat_enabled:false};
  const agentDir=path.join(home,'agents/enigma');await fs.mkdir(agentDir,{recursive:true});await fs.writeFile(path.join(agentDir,'config.yaml'),YAML.dump(config));await fs.writeFile(path.join(agentDir,'AGENTS.md'),'Preserve original requirements, existing files and registered checks. This is an isolated controlled verification fixture.');
  const workspace=await Workspace.open(root);
  for(const id of ['alpha','beta','gamma']){const dir=path.join(root,id);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:id,type:'module'}));await fs.writeFile(path.join(dir,'index.js'),'export const original = true;\n');
    assert.equal((await runProcess(['git','init','-q'],dir)).status,'passed');await workspace.addRepo(id,dir,{access:'write'});}
  await workspace.addCheck({id:'original-check',repo:'gamma',argv:[process.execPath,'--check','index.js'],joint:true});const sourceBefore=await workspace.observe();
  let child;const events=[];let exitInfo;
  async function start(stage){const log=await fs.open(path.join(output,`${stage}.log`),'a');child=fork(fileURLToPath(import.meta.url),['--worker',stage,output],{cwd:repoRoot,env:{...process.env,HANA_HOME:home,ENIGMA_DESKTOP_PRODUCT:'1'},execArgv:[],stdio:['ignore',log.fd,log.fd,'ipc']});await log.close();exitInfo=undefined;child.on('message',m=>events.push(m));child.on('exit',(code,signal)=>{exitInfo={code,signal};});return child;}
  let report;
  try{
    await start('initial');await until(()=>{if(exitInfo)throw Error('Initial host exited: '+JSON.stringify(exitInfo));return events.some(e=>e.type==='ready')&&definitions.every(d=>held.has(d.key));},'both workers wrote and are waiting for a model response');
    const fixture=await readJson(path.join(output,'fixture.json')),before=[];
    for(const task of fixture.tasks){const w=await Workspace.open(task.root),def=definitions.find(d=>task.goal.includes(`HOST_CRASH_${d.key}`)),text=await fs.readFile(path.join(w.repo(def.repo).root,def.file),'utf8');assert.equal(text,`first-${def.key}\n`);const state=await readJson(path.join(w.data,`session-${task.piSessionId}.json`));before.push({...task,requests:state.requests,entries:(await fs.readFile(task.sessionPath,'utf8')).trim().split('\n').length-1});}
    assert(definitions.every(d=>!held.get(d.key).destroyed));const initialPid=child.pid;child.kill('SIGKILL');await until(()=>exitInfo,'confirmed host process exit');assert.equal(exitInfo.signal,'SIGKILL');assert.deepEqual(await workspace.observe(),sourceBefore);
    mode='resume';await start('resume');await until(()=>{if(exitInfo)throw Error('Recovery host exited: '+JSON.stringify(exitInfo));return events.some(e=>e.type==='restored');},'new host loaded interrupted tasks');
    const restored=await readJson(path.join(output,'restored.json'));assert.notEqual(restored.pid,initialPid);assert(restored.tasks.every(task=>task.status==='blocked'&&!task.executionActive));assert.deepEqual(calls.resume,{A:0,B:0});
    for(const task of restored.tasks)assert.equal(task.progress?.requests,before.find(original=>original.id===task.id).requests,'Cold task status must retain known request accounting without loading its runtime');
    child.send('resume');await until(()=>{if(exitInfo&&exitInfo.code!==0)throw Error('Resume failed: '+JSON.stringify(exitInfo));return events.some(e=>e.type==='completed');},'both tasks resumed in the new host');
    const resumed=await readJson(path.join(output,'resumed.json'));for(const task of resumed.tasks){const original=before.find(t=>t.id===task.id);assert(task.requests>original.requests);assert(task.entries>original.entries);}
    assert.deepEqual(await workspace.observe(),sourceBefore);await until(()=>exitInfo,'recovery host shutdown');assert.equal(exitInfo.code,0);
    report={verified:true,scope:'Entire HanaEngine and engineering plugin host process killed with SIGKILL, then cold-started; controlled HTTP model and fixture-only approval',initialPid,recoveredPid:restored.pid,noAutomaticModelReplay:true,interruptedStatuses:restored.tasks.map(t=>t.status),coldStatusHasAccounting:restored.tasks.every(t=>!!t.progress),parentUnchanged:true,before:before.map(t=>({id:t.id,requests:t.requests,entries:t.entries})),after:resumed.tasks.map(t=>({id:t.id,requests:t.requests,entries:t.entries,originalUserRequirementRetained:t.originalUserRequirementRetained})),calls};
  }catch(error){report={verified:false,error:String(error.stack||error),calls};process.exitCode=1;}
  finally{if(child&&!exitInfo){child.kill('SIGKILL');await until(()=>exitInfo,'test host cleanup').catch(()=>{});}gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
