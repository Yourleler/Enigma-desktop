import { loadValidationModel } from './validation-model.mjs';
import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Workspace,DocumentationStore,Artifacts,TaskPackages} from 'enigma-next';
import {Delegations} from '../packages/enigma-engineering/dist/src/delegation.js';
import {TaskReadingStore} from '../packages/enigma-engineering/dist/src/task-reading.js';
import {PlanStore} from '../packages/enigma-engineering/dist/src/planning.js';
import {crossLanguageFixture,actualGreeting} from '../packages/enigma-engineering/dist/test/cross-language-fixtures.js';
import {hash} from 'enigma-next/storage';
import {withNativeEngineeringExecution} from '../plugins/enigma/execution-policy.ts';

// Uses only newly created repositories. Never points a worker at the caller's
// project or copies its native conversation. The model configuration stays local.
const output=path.resolve(process.argv[2]);await fs.mkdir(output);
const {root,workspace}=await crossLanguageFixture(path.join(output,'workspace'));
const report={status:'running',startedAt:new Date().toISOString(),root,mode:'actual Gateway Pi worker plus operator-driven parent domain workflow',phases:[]};
const save=async()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const phase=async(name,details={})=>{report.phases.push({phase:name,at:new Date().toISOString(),...details});await save();console.log(JSON.stringify({phase:name,...details}));};
const task='cross-language-parent',agentDir=path.join(output,'agent');await fs.mkdir(agentDir);
const { provider: configuredProvider, model: configuredModel } = await loadValidationModel();
await fs.writeFile(path.join(agentDir,'models.json'),JSON.stringify({providers:{gateway:configuredProvider}}),{mode:0o600});
const engine={hanakoHome:path.join(output,'host'),getEngineeringExecutionPreferences:()=>({sandbox:true,network:true,localServers:true})};
const sessionPath=path.join(engine.hanakoHome,'agents','verifier','sessions','parent.jsonl');await fs.mkdir(path.dirname(sessionPath),{recursive:true});
const run=action=>withNativeEngineeringExecution(engine,workspace,sessionPath,action);
let active;
const delegates=new Delegations(workspace),plans=new PlanStore(workspace),reading=new TaskReadingStore(workspace);
try{
  await workspace.setDependencies('sdk',['server']);await workspace.setDependencies('app',['sdk']);
  const original=await actualGreeting(root);assert.equal(original,'v1');
  const checker=`import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import * as sdk from '../sdk/index.js';
import {display} from './index.js';
const server=spawn(process.env.ENIGMA_PYTHON||'python3',['-u','server.py'],{cwd:fileURLToPath(new URL('../server/',import.meta.url)),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
let text='',errors='',ended=false;const exited=new Promise(resolve=>{server.once('exit',()=>{ended=true;resolve();});server.once('error',error=>{errors+=String(error);ended=true;resolve();});});
server.stdout.on('data',chunk=>text+=chunk);server.stderr.on('data',chunk=>errors+=chunk);
try{const deadline=Date.now()+10000;while(!text.includes('\\n')&&!ended&&Date.now()<deadline)await delay(20);const port=Number(text.trim());assert(Number.isInteger(port)&&port>0,errors||'server did not start');const base='http://127.0.0.1:'+port;
const response=await fetch(base+'/greet');assert.equal(response.status,200);const raw=await response.json();assert.deepEqual(raw,{data:{message:'v2'}});
assert.equal(typeof sdk.parseGreeting,'function');assert.equal(sdk.parseGreeting({message:'legacy'}),'legacy');assert.equal(sdk.parseGreeting({data:{message:'v2'}}),'v2');assert.equal(await sdk.getGreeting(base),'v2');assert.equal(await display(base),'app:v2');
console.log('HTTP3_REPO_OK raw=v2 sdk=v2 app=app:v2 legacy=legacy');
}finally{server.kill('SIGTERM');await exited;}
`;
  await fs.writeFile(path.join(root,'app','verify.mjs'),checker);
  await workspace.addCheck({id:'http-chain',repo:'app',joint:true,argv:[process.execPath,'verify.mjs'],timeoutMs:20000});
  const checkHash=hash(checker),checkDefinitions=JSON.stringify(workspace.config.checks);
  await phase('baseline',{actualResult:original,initialVerification:(await run(()=>workspace.exclusive(()=>workspace.verify()))).status});
  const map=await run(()=>reading.build({goal:'升级Python响应并保持JavaScript SDK兼容，调整应用显示和文档',task,queries:[{symbol:'greet',repo:'server'},{symbol:'getGreeting',repo:'sdk'},{symbol:'display',repo:'app'}],expectedRepos:['server','sdk','app'],requirements:[{id:'migration',text:'新服务返回data.message=v2，SDK兼容旧message，应用显示app:v2',checks:['http-chain']}],maxQueries:8}));
  assert.deepEqual(new Set(map.nodes.map(node=>node.source.repo)),new Set(['server','sdk','app']));
  await phase('source-reading',{map:map.id,nodes:map.nodes.length,staticRelations:map.edges.length,limitations:map.gaps});
  let plan=await plans.create({goal:'跨语言三仓接口迁移与文档交付',steps:[{id:'server',repo:'server',goal:'Python返回新信封',checks:['http-chain']},{id:'sdk',repo:'sdk',goal:'SDK兼容新旧结构',requires:['server'],checks:['http-chain']},{id:'app',repo:'app',goal:'应用显示与文档示例',requires:['sdk'],checks:['http-chain']}]});
  const before=await workspace.observe();
  const instruction='完成同一需求的三仓联动修改：server/model.py 的 greet 返回 {"data":{"message":"v2"}}；sdk/index.js 新增导出 parseGreeting(payload)，兼容旧 payload.message 和新 payload.data.message，getGreeting 使用它并保留非2xx错误处理；app/index.js display 显示 app: 加SDK结果。先阅读相关源码和原要求，修改后运行原 http-chain 联合检查，不能修改 app/verify.mjs、server/server.py、任何 package.json、.enigma-contracts.json 或检查定义。只在 server/model.py、sdk/index.js、app/index.js 和 app/MIGRATION.md 写入。文档使用明确的 ## 行为 与 ## 验证 两节，解释Python→SDK→应用的实际行为，在验证节写从app目录运行 node verify.mjs 以及其确切预期输出。执行测试后才能声称通过；不要递归创建任务。';
  active=await run(()=>delegates.start({target:'pi',goal:instruction,task,source:{agent:'operator',session:task},notes:[{role:'user',kind:'requirement',reference:'user:cross-language',text:instruction}],plan,writeRepos:['server','sdk','app'],checks:['http-chain'],maxRequests:36,timeoutMs:600000,provider:'gateway',model:configuredModel.id,agentDir}));
  await phase('worker-started',{id:active.spec.id,pid:active.state.workerPid,workspace:active.spec.workspace});
  const deadline=Date.now()+650000;let last='';
  do{active=await delegates.wait(active.spec.id,{task,timeoutMs:5000});const status=`${active.status}:${active.state.requests}:${active.state.tools}`;if(status!==last){last=status;await phase('worker-progress',{status:active.status,requests:active.state.requests,tools:active.state.tools});}if(!active.terminal)await delay(200);}while(!active.terminal&&Date.now()<deadline);
  if(!active.terminal){await delegates.cancel(active.spec.id,task);throw Error('Worker deadline exceeded');}
  assert.equal(active.status,'completed',active.diagnostic||active.state.error);assert.equal(active.state.verification?.status,'verified',JSON.stringify(active.state.verification));
  assert.deepEqual(await workspace.observe(),before,'Parent source changed before explicit integration');
  const child=await Workspace.open(active.spec.workspace);assert.equal(hash(await fs.readFile(path.join(child.repo('app').root,'verify.mjs'))),checkHash);
  assert.equal(JSON.stringify(workspace.config.checks),checkDefinitions);
  await fs.writeFile(path.join(root,'app','USER-NOTE.txt'),'并发用户备注，必须保留\n');
  const preview=await run(()=>delegates.preview(active.spec.id,task));assert(preview.applyAllowed,JSON.stringify(preview.conflicts));
  assert(preview.changes.every(change=>['server:model.py','sdk:index.js','app:index.js','app:MIGRATION.md'].includes(change.repo+':'+change.file)));
  assert.deepEqual(new Set(preview.changes.map(change=>change.repo)),new Set(['server','sdk','app']));
  await phase('integration-preview',{preview:preview.id,changes:preview.changes.map(change=>({repo:change.repo,file:change.file,state:change.state}))});
  const integrated=await run(()=>delegates.merge(preview.id,{task}));assert.equal(integrated.verification.status,'verified');assert.equal(await fs.readFile(path.join(root,'app','USER-NOTE.txt'),'utf8'),'并发用户备注，必须保留\n');assert.equal(hash(await fs.readFile(path.join(root,'app','verify.mjs'))),checkHash);
  for(const step of ['server','sdk','app'])plan=await plans.advance(step,plan.revision,{phase:'verified',evidence:integrated.verification.evidence},plan.id);
  assert.equal((await plans.view()).completed,3);assert.equal((await reading.open(map.id,task)).current,false);
  await phase('integrated',{checkEvidence:integrated.verification.evidence,planCompleted:3,parentConcurrentNotePreserved:true,checksPreserved:true,oldReadingStale:true});
  const doc=await fs.readFile(path.join(root,'app','MIGRATION.md'),'utf8');assert(doc.includes('node verify.mjs')&&doc.includes('HTTP3_REPO_OK'),'Migration guide must contain the actual executable example');
  const behavior=doc.split('## 行为\n')[1]?.split('\n## ')[0]?.split('\n').find(line=>line.trim()&&!line.startsWith('#')&&/Python|server|SDK/.test(line));assert(behavior,'Guide needs source-grounded behavior');
  const anchors=await Promise.all([['server','model.py'],['sdk','index.js'],['app','index.js']].map(async([repo,file])=>({repo,file,start:1,end:(await fs.readFile(path.join(root,repo,file),'utf8')).trimEnd().split('\n').length})));
  const documents=new DocumentationStore(workspace),document=await documents.register({repo:'app',file:'MIGRATION.md',title:'跨语言接口迁移',claims:[{id:'behavior',section:'## 行为',text:behavior,authority:'source',sources:anchors}],examples:[{id:'http',section:'## 验证',repo:'app',argv:[process.execPath,'verify.mjs'],expected:'HTTP3_REPO_OK raw=v2 sdk=v2 app=app:v2 legacy=legacy',timeoutMs:20000}]});
  const example=await run(()=>documents.runExample(document.id,'http'));assert.equal(example.status,'passed');
  const artifact=await new Artifacts(workspace).add({title:'跨语言迁移指南',kind:'document',repo:'app',file:'MIGRATION.md',task,evidence:[integrated.verification.evidence]});
  await phase('delivery',{document:document.id,example:example.id,status:example.status,artifact:artifact.id});
  const observer=await run(()=>delegates.start({target:'pi',goal:'仅根据 app/MIGRATION.md 里的验证说明检查交付质量。读文档，实际运行其中的 node verify.mjs 例子，报告确切输出；不得修改任何文件或原检查。不要把来源已通过当成本次执行。',task,source:{agent:'operator',session:task},notes:[{role:'user',kind:'requirement',reference:'user:doc-follower',text:'独立上下文照迁移文档执行，不修改代码。'}],writeRepos:['app'],checks:['http-chain'],maxRequests:16,timeoutMs:240000,provider:'gateway',model:configuredModel.id,agentDir}));
  active=observer;await phase('independent-reader-started',{id:observer.spec.id});
  do{active=await delegates.wait(active.spec.id,{task,timeoutMs:5000});if(!active.terminal)await delay(200);}while(!active.terminal);
  assert.equal(active.status,'completed',active.state.error);assert(active.state.answer?.includes('HTTP3_REPO_OK'));const readerWorkspace=await Workspace.open(active.spec.workspace),readerSource=await TaskPackages.inspect(active.spec.package);
  const readerEntries=(await fs.readFile(active.state.session,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert(readerEntries.some(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&['repo_run','workspace_verify'].includes(entry.message.toolName)&&JSON.stringify(entry.message).includes('HTTP3_REPO_OK')),'Reader must produce actual command output, not just repeat expected text');
  for(const entry of readerSource.manifest.repos){const current=await readerWorkspace.snapshotRepo(entry.repo.id,false);assert.deepEqual(Object.keys(current.files).sort(),Object.keys(entry.files).sort(),'Independent reader added or removed a source file');for(const [file,version]of Object.entries(entry.files))assert.equal(hash(await fs.readFile(path.join(readerWorkspace.repo(entry.repo.id).root,file))),version.hash,'Independent reader modified a source file');}
  await phase('independent-reader',{requests:active.state.requests,tools:active.state.tools,answer:active.state.answer});
  report.status='verified';report.finishedAt=new Date().toISOString();report.requests=report.phases.filter(item=>item.phase==='worker-progress').at(-1)?.requests;await save();
}catch(error){report.status='failed';report.error=String(error);await save();throw error;}
finally{if(active&&!active.terminal)await delegates.cancel(active.spec.id,task).catch(()=>{});if(active)await delegates.drain(active.spec.id,{task,timeoutMs:5000}).catch(()=>{});}
