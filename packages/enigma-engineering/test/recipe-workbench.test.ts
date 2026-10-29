import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from './fixtures.js';
import {RecipeStore} from '../src/recipes.js';
import {domainAction,domainChoices} from '../src/workbench-domain.js';
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {createEnigmaExtension} from '../src/pi-extension.js';
import {createReuseExtension} from '../src/pi-reuse.js';
import {PlanStore} from '../src/planning.js';
const controller=(workspace:any)=>({options:{workspace},chat:{session:'task-a'},runtime:{session:{sessionManager:{getLeafId:()=> 'entry',getBranch:()=>[]}}}}) as any;
test('successful-plan proposals keep readable provenance, isolate tasks and distinguish saved recipes',async()=>{
 const {root,workspace}=await fixture(),recipes=new RecipeStore(workspace),plans=new PlanStore(workspace);
 try{
  await workspace.addCheck({id:'syntax',repo:'app',argv:[process.execPath,'--check','index.js']});
  const plan=await plans.create({goal:'检查应用入口',steps:[{id:'entry',repo:'app',goal:'入口语法正确',checks:['syntax']}]});
  await assert.rejects(recipes.propose(plan,'task-a'),/fully verified/);
  const check=await workspace.exclusive(()=>workspace.verify()),done=await plans.advance('entry',plan.revision,{phase:'verified',evidence:check.evidence},plan.id);
  const proposal=await recipes.propose(done,'task-a');
  assert.equal((await recipes.proposals('task-b')).items.length,0);
  const pending=(await recipes.proposals('task-a')).items[0]!;assert.equal(pending.sourceCurrent,true);assert.equal(pending.savedRecipe,undefined);assert.equal(pending.goals[0]?.goal,'入口语法正确');
  await recipes.save(proposal.input);
  const saved=(await recipes.proposals('task-a')).items[0]!;assert.equal(saved.savedRecipe?.revision,1);assert.equal(saved.sourceCurrent,false);assert.equal((await recipes.runs()).length,0);
  await rm(join(workspace.data,'evidence',check.evidence+'.json'));assert.equal((await recipes.proposals('task-a')).items.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a killed recipe owner is reconciled once, keeps unknown file effects and never replays later steps',{timeout:30000},async()=>{
 const {root,workspace}=await fixture(),recipes=new RecipeStore(workspace);let worker:ReturnType<typeof spawn>|undefined,commandPid:number|undefined;
 try{
  await workspace.addCheck({id:'syntax',repo:'app',argv:[process.execPath,'--check','index.js']});
  await recipes.save({id:'interrupted',label:'被中断的配方',steps:[{id:'wait',kind:'command',repo:'app',argv:[process.execPath,'-e','require("fs").writeFileSync("STARTED.json",JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)']},{id:'later',kind:'command',repo:'app',argv:[process.execPath,'-e','require("fs").writeFileSync("LATE.txt","wrong")']},{id:'verify',kind:'verify'}]});
  const source=`import {Workspace} from ${JSON.stringify(new URL('../src/workspace.js',import.meta.url).href)};import {RecipeStore} from ${JSON.stringify(new URL('../src/recipes.js',import.meta.url).href)};const workspace=await Workspace.open(${JSON.stringify(root)});await new RecipeStore(workspace).run('interrupted',{}, {task:'task-a'});`;
  worker=spawn(process.execPath,['--input-type=module','-e',source],{stdio:'ignore'});const exited=new Promise(resolve=>worker!.once('exit',resolve));
  const deadline=Date.now()+6000;while(Date.now()<deadline){try{commandPid=JSON.parse(await readFile(join(root,'app','STARTED.json'),'utf8')).pid;break;}catch{await delay(20);}}
  assert(commandPid);const active=await recipes.interruption();assert(active);assert.equal(active.canReconcile,false);
  await assert.rejects(recipes.reconcileLock('原进程仍运行',active.token),/仍在运行/);
  worker.kill('SIGKILL');await exited;process.kill(commandPid,'SIGKILL');commandPid=undefined;
  assert.equal((await recipes.runs('task-a'))[0]?.status,'unknown');assert.equal((await recipes.interruption())?.canReconcile,true);
  await assert.rejects(recipes.reconcileLock('旧表单','different-owner'),/占用已变化/);
  const outcome=await recipes.reconcileLock('原进程和命令已退出，STARTED.json保留，后续步骤未执行。',active.token);assert.equal(outcome.unresolved,1);assert.equal(await recipes.interruption(),null);
  await assert.rejects(recipes.reconcileLock('重复核对',active.token),/无需重复/);
  assert.equal((await recipes.runs('task-a'))[0]?.status,'unknown');await assert.rejects(readFile(join(root,'app','LATE.txt')),/ENOENT/);
  const recovery=await workspace.recover();assert.equal(recovery.pending.length,1);
  await workspace.acknowledgeOperation(recovery.pending[0]!.id,'已核对命令退出，只有STARTED.json写入，后续步骤未执行。');
  assert.equal((await workspace.exclusive(()=>workspace.verify())).status,'verified');
 }finally{worker?.kill('SIGKILL');if(commandPid)try{process.kill(commandPid,'SIGKILL');}catch{}await rm(root,{recursive:true,force:true});}
});
test('native recipe execution shares the final check evidence with the owning task state',async()=>{
 const {root,workspace}=await fixture(),agentDir=join(root,'agent'),manager=SessionManager.inMemory(root);let session:any;
 try{
  await workspace.addCheck({id:'syntax',repo:'library',argv:[process.execPath,'--check','index.js']});await new RecipeStore(workspace).save({id:'check',label:'check',steps:[{id:'verify',kind:'verify'}]});
  const runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false}),faux=fauxProvider({models:[{id:'fixture',contextWindow:100000,maxTokens:2000}]});runtime.registerNativeProvider(faux.provider);
  const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noSkills:true,noContextFiles:true,extensionFactories:[createEnigmaExtension({workspace,managed:true,approval:'auto'}),createReuseExtension({workspace,approval:'auto'})]});await loader.reload();
  ({session}=await createAgentSession({cwd:root,agentDir,modelRuntime:runtime,model:faux.getModel(),settingsManager:settings,sessionManager:manager,resourceLoader:loader}));await session.bindExtensions({});
  faux.setResponses([fauxAssistantMessage([fauxToolCall('recipe_manage',{action:'run',id:'check'})],{stopReason:'toolUse'}),fauxAssistantMessage('Checked')]);await session.prompt('Run the saved check recipe.');
  const runs=await new RecipeStore(workspace).runs(manager.getSessionId());assert.equal(runs.length,1);assert.equal(runs[0]?.status,'passed');
  const state=JSON.parse(await readFile(join(workspace.data,`session-${manager.getSessionId()}.json`),'utf8'));assert.equal(state.lastCheckEvidence,runs[0]?.run.evidence);assert.equal(state.lastVerification,'verified');
 }finally{session?.dispose();await rm(root,{recursive:true,force:true});}
});
test('workbench edits preserve revision and parameter definitions, reject stale execution and retain current run evidence',async()=>{
 const {root,workspace}=await fixture(),recipes=new RecipeStore(workspace),ctx=controller(workspace),signal=new AbortController().signal;
 try{
  await writeFile(join(root,'library','say.cjs'),'require("fs").writeFileSync("result.txt",process.argv[2]);console.log("VALUE:"+process.argv[2]);');
  await workspace.addCheck({id:'syntax',repo:'library',argv:[process.execPath,'--check','index.js']});
  const input={id:'migration',label:'迁移检查',parameters:[{name:'message',description:'要写入的文本',default:''}],steps:[{id:'write',kind:'command',repo:'library',argv:[process.execPath,'say.cjs','{{message}}']},{id:'acceptance',kind:'verify'}]};
  const original=await domainAction(ctx,'recipe-save',input,signal) as any;assert.equal(original.revision,1);assert.equal(original.parameters.message.default,'');
  const updated=await domainAction(ctx,'recipe-save',{...input,label:'改好的配方',revision:1},signal) as any;assert.equal(updated.revision,2);
  await assert.rejects(domainAction(ctx,'recipe-save',{...input,revision:1},signal),/已被更新/);
  await assert.rejects(domainAction(ctx,'recipe-run',{id:input.id,version:original.version,parameters:{message:'wrong'}},signal),/已变化/);await assert.rejects(readFile(join(root,'library','result.txt')),/ENOENT/);
  const result=await domainAction(ctx,'recipe-run',{id:input.id,version:updated.version,parameters:{message:'空格 和 $() 按原样'}},signal) as any;assert.equal(result.status,'passed');assert.equal(result.current,true);assert.equal(await readFile(join(root,'library','result.txt'),'utf8'),'空格 和 $() 按原样');
  await recipes.save({...updated,label:'后来改名'},updated.revision);const historical=await domainAction(ctx,'recipe-report',{id:result.run.id},signal) as any;assert.equal(historical.recipeReport,true);assert.equal(historical.recipeLabel,'改好的配方');
  const choices=await domainChoices(ctx,['recipeRuns']) as any;assert.equal(choices.recipeRuns[0].id,result.run.id);assert(choices.recipeRuns[0].label.includes('改好的配方'));
  await rm(join(workspace.data,'evidence',result.run.evidence+'.json'));assert.equal((await recipes.readRun(result.run.id,'task-a')).current,false);
  await assert.rejects(recipes.readRun(result.run.id,'task-b'),/ownership/);
  await assert.rejects(domainAction(ctx,'recipe-save',{...input,id:'duplicates',parameters:[{name:'same'},{name:'same'}]},signal),/唯一/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('cancelling an active recipe stops its command, keeps the original check and does not dispatch later steps',async()=>{
 const {root,workspace}=await fixture(),recipes=new RecipeStore(workspace),controller=new AbortController();
 try{
  await workspace.addCheck({id:'original',repo:'library',argv:[process.execPath,'--check','index.js']});
  const definition=await recipes.save({id:'long',label:'long recipe',steps:[{id:'wait',kind:'command',repo:'library',argv:[process.execPath,'-e','console.log("STARTED");setInterval(()=>{},1000)']},{id:'later',kind:'command',repo:'library',argv:[process.execPath,'-e','require("fs").writeFileSync("LATE.txt","wrong")']},{id:'verify',kind:'verify'}]});
  const before=JSON.stringify(workspace.config.checks);const run=recipes.run(definition.id,{}, {task:'task-a',expectedVersion:definition.version,signal:controller.signal});
  const deadline=Date.now()+3000;while(Date.now()<deadline){const runs=await recipes.runs('task-a');if(runs.some(item=>item.run.steps.some(step=>step.state==='running'))){controller.abort();break;}await new Promise(resolve=>setTimeout(resolve,15));}
  const stopped=await run;assert.equal(stopped.status,'cancelled');assert.equal(stopped.run.steps.length,1);await assert.rejects(readFile(join(root,'library','LATE.txt')),/ENOENT/);assert.equal(JSON.stringify(workspace.config.checks),before);await assert.rejects(readFile(join(workspace.data,'recipe.lock')),/ENOENT/);
 }finally{controller.abort();await rm(root,{recursive:true,force:true});}
});
