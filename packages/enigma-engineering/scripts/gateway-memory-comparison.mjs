import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { crossLanguageFixture } from '../dist/test/cross-language-fixtures.js';
import { configureGateway } from '../dist/src/model-config.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createMemoryExtension } from '../dist/src/pi-memory.js';
import { MemoryStore } from '../dist/src/memory.js';

const directory = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/memory-comparison');
await mkdir(directory, { recursive: true });
const { root, workspace } = await crossLanguageFixture(); const agentDir = await configureGateway(workspace.data);
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false });
const model = modelRuntime.getModels('gateway')[0]; assert(model);
const store = await MemoryStore.open(workspace);
const prior = 'Project decision from a previous session: documentation must call the public endpoint GREETING-CONTRACT, never legacy-output. For technical facts, verify actual source. For this isolated project, the term is a documentation convention, not a wire-level field.';
const startedBuild = performance.now();
const memory = await store.save({ kind: 'convention', scope: { type: 'project' }, title: 'GREETING-CONTRACT 文档约定', content: prior, appliesWhen: '接口文档 wording convention', tags: ['GREETING-CONTRACT', 'endpoint', '接口', '文档'], origin: { kind: 'user', reference: 'prior session explicit project convention' } }, { userStated: true });
const indexed = await store.index(); const buildMs = performance.now() - startedBuild;
const prompts = [
  { name: 'contract-doc', goal: 'Create sdk/COMPARE-contract.md documenting current method/path, producer, consumer and response field. Follow the prior project documentation convention; read actual source. Keep API code unchanged.', file: 'COMPARE-contract.md' },
  { name: 'consumer-doc', goal: 'Create sdk/COMPARE-consumer.md documenting what the SDK returns and how app consumes it. Use the prior endpoint documentation label; verify actual source. Keep API code unchanged.', file: 'COMPARE-consumer.md' },
];
const rows=[];
for (const strategy of ['full-history-no-memory','raw-history-search','scoped-memory']) for (const task of prompts) {
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const raw = pi => pi.registerTool({ name: 'source_history', label: 'Original history', description: 'Read the original prior-session convention, not a generated memory.', parameters: (awaitType()),
    async execute(){return { content:[{type:'text',text:prior}],details:{source:'original user entry'}};}});
  function awaitType(){return globalType.Object({});}
  const {Type:globalType}=await import('typebox');
  const resources = new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noSkills:true,noContextFiles:true,noExtensions:true,
    extensionFactories:[createEnigmaExtension({workspace,managed: strategy !== 'raw-history-search',approval:'auto'}), ...(strategy==='scoped-memory'?[createMemoryExtension({workspace,enabled:true})]:strategy==='raw-history-search'?[raw]:[])]});
  await resources.reload(); const manager=SessionManager.create(root,join(workspace.data,'comparison-sessions'));
  if(strategy==='full-history-no-memory') manager.appendMessage({role:'user',content:[{type:'text',text:prior}],timestamp:Date.now()});
  const {session}=await createAgentSession({cwd:root,agentDir,modelRuntime,model,settingsManager:settings,resourceLoader:resources,sessionManager:manager,tools:strategy==='raw-history-search'?['repo_files','repo_read','repo_write','workspace_repos','source_history']:strategy==='scoped-memory'?['repo_files','repo_read','repo_write','workspace_repos','memory_search','memory_read']:['repo_files','repo_read','repo_write','workspace_repos']});
  const events=[],errors=[];session.subscribe(event=>{if(event.type==='tool_execution_end'){events.push({tool:event.toolName,error:event.isError});process.stderr.write(strategy+' '+event.toolName+'\n');}});await session.bindExtensions({onError:error=>errors.push(error)});
  const start=performance.now(),timer=setTimeout(()=>{void session.abort();},120000);
  try {
    const convention=strategy==='raw-history-search'?'Prior context is available from source_history.':strategy==='scoped-memory'?'Recall the prior project convention with memory_search then read its current note.':'The earlier user message contains the prior convention.';
    await session.prompt(task.goal+' '+convention);
    let physical='';try{physical=await readFile(join(root,'sdk',task.file),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    const success=physical.includes('GREETING-CONTRACT') && physical.toLowerCase().includes('message') && !(await readFile(join(root,'server','model.py'),'utf8')).includes('data');
    const messages=manager.getBranch().filter(entry=>entry.type==='message'&&entry.message.role==='assistant').map(entry=>entry.message);
    const usage=messages.reduce((total,message)=>({input:total.input+(message.usage?.input??0),output:total.output+(message.usage?.output??0),cacheRead:total.cacheRead+(message.usage?.cacheRead??0),reportedCost:total.reportedCost+(message.usage?.cost?.total??0)}),{input:0,output:0,cacheRead:0,reportedCost:0});
    rows.push({strategy,task:task.name,success,wallMs:performance.now()-start,tools:events,usage,artifact:physical,errors,session:manager.getSessionFile()});
    // Separate output names remain physical evidence; no repeated task overwrites masquerade as distinct results.
    if(physical)await (await import('node:fs/promises')).rename(join(root,'sdk',task.file),join(root,'sdk',strategy+'-'+task.file));
  }finally{clearTimeout(timer);session.dispose();}
  await writeFile(join(directory,'report.json'),JSON.stringify({kind:'real-small-sample-memory-comparison',workspace:root,model:model.id,buildMs,indexed:{refreshed:indexed.refreshed,reused:indexed.reused},memoryId:memory.id,rows,
    limitations:['two documentation tasks per condition; not a general speed or quality benchmark','same sources and prior convention; full-history vs retrieval placement differs','input/output and gateway-reported cost recorded without asserting billed price','memory build/index time included separately; no hidden extraction calls']},null,2));
}
assert(rows.every(row=>row.success),JSON.stringify(rows.map(row=>({strategy:row.strategy,task:row.task,success:row.success}))));
console.log(JSON.stringify({report:join(directory,'report.json'),rows:rows.map(row=>({strategy:row.strategy,task:row.task,success:row.success,wallMs:row.wallMs})),buildMs}));
