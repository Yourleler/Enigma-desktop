import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import YAML from 'js-yaml';
import { ModelManager } from '../core/model-manager.ts';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, Type, emitSessionShutdown } from '../lib/pi-sdk/index.ts';

const output=resolve(process.argv[2]);await mkdir(output,{recursive:true});
const home=join(output,'home'), workspace=join(output,'workspace');await mkdir(home,{recursive:true});await mkdir(workspace,{recursive:true});
const existing=JSON.parse(await readFile(userHomeDirectory() + '/code/Enigma-next/.enigma-next/pi-agent/models.json','utf8'));
const provider=existing.providers.gateway;assert.equal(new URL(provider.baseUrl).hostname,'127.0.0.1');
const selected=provider.models.find(model=>model.id==='gateway-gpt-6-1-sol');assert(selected);
await writeFile(join(home,'added-models.yaml'),YAML.dump({providers:{gateway:{base_url:provider.baseUrl,api:provider.api,api_key:provider.apiKey,models:[{id:selected.id,name:selected.name,context:selected.contextWindow,maxOutput:4000,reasoning:true}]}}}),{mode:0o600});
const marker='HANA_PI_140_ACTUAL_TOOL_OK';await writeFile(join(workspace,'fixture.txt'),marker);
let runtime,report,readCalls=0,writeCalls=0;const events=[];
try{
 const manager=new ModelManager({hanakoHome:home});manager.init();await manager.refreshAvailable();const model=manager.availableModels.find(model=>model.provider==='gateway'&&model.id===selected.id);assert(model);
 const settings=SettingsManager.inMemory({compaction:{enabled:true},retry:{enabled:false}}), loader=new DefaultResourceLoader({cwd:workspace,agentDir:home,settingsManager:settings,noContextFiles:true,noExtensions:true,noSkills:true,noPromptTemplates:true});await loader.reload();
 runtime=(await createAgentSession({cwd:workspace,agentDir:home,modelRegistry:manager.modelRegistry,authStorage:manager.authStorage,model,thinkingLevel:'low',settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.create(workspace,join(home,'sessions')),noTools:'builtin',customTools:[{
  name:'hana_pi140_fixture_read',label:'Read isolated fixture',description:'Read the one fixed validation fixture.',parameters:Type.Object({}),async execute(){readCalls++;return{content:[{type:'text',text:await readFile(join(workspace,'fixture.txt'),'utf8')}],details:{fixture:'fixture.txt'}};}
 },{
  name:'hana_pi140_fixture_write',label:'Write isolated result',description:'Save the specified text to this validation fixture only.',parameters:Type.Object({text:Type.String()}),async execute(_id,{text}){writeCalls++;await writeFile(join(workspace,'result.txt'),text);return{content:[{type:'text',text:'Isolated result saved.'}],details:{fixture:'result.txt'}};}
 }]})).session;
 runtime.subscribe(event=>{if(['tool_execution_start','tool_execution_end','agent_settled','agent_end','message_end'].includes(event.type))events.push({type:event.type,tool:event.toolName,error:event.isError});});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);controller.signal.addEventListener('abort',()=>runtime.abort(),{once:true});
 try{await runtime.prompt('这是隔离验证任务。先调用 hana_pi140_fixture_read 读取标记，然后调用 hana_pi140_fixture_write 将完全相同的标记写入结果文件。最后只回复标记。不需要其他操作。');}finally{clearTimeout(timer);}
 assert.equal(readCalls,1);assert.equal(writeCalls,1);assert.equal(await readFile(join(workspace,'result.txt'),'utf8'),marker);assert(runtime.getLastAssistantText().includes(marker));assert(runtime.isIdle);assert(events.some(e=>e.type==='agent_settled'));
 const sessionFile=runtime.sessionManager.getSessionFile();await emitSessionShutdown(runtime);runtime.dispose();runtime=undefined;
 const restored=(await createAgentSession({cwd:workspace,agentDir:home,modelRegistry:manager.modelRegistry,authStorage:manager.authStorage,model,settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.open(sessionFile),noTools:'all'})).session;
 assert(restored.getLastAssistantText().includes(marker));await emitSessionShutdown(restored);restored.dispose();
 report={status:'verified',at:new Date().toISOString(),pi:'1.4.0',hana:'0.450.0',model:selected.id,readCalls,writeCalls,workspace,sessionFile,events,restored:true,scope:'Hana ModelManager and SDK adapter, actual configured Gateway model, isolated physical read/write, settlement and persisted-session reopen. Not full Enigma feature migration or universal provider acceptance.'};
}catch(error){report={status:'failed',error:String(error),readCalls,writeCalls,events};process.exitCode=1;}
finally{if(runtime){await runtime.abort();await emitSessionShutdown(runtime);runtime.dispose();}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:join(output,'report.json')}));}
