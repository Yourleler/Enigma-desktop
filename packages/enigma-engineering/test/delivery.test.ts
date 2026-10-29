import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { fixture } from './fixtures.js';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { createDeliveryExtension } from '../src/pi-delivery.js';
import { BackgroundRuns } from '../src/background.js';
import { TaskEvents } from '../src/task-events.js';

test('real Pi resumes once from an actual background event and does not replay its delivered result', { timeout: 30_000 }, async () => {
  const { root, workspace } = await fixture();
  const agentDir = join(workspace.data, 'agent');
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'test', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const manager = SessionManager.create(root, join(workspace.data, 'sessions')), settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true, extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createDeliveryExtension({ workspace, pollMs: 100 })] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), sessionManager: manager, resourceLoader: loader, settingsManager: settings });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  try {
    faux.setResponses([fauxAssistantMessage('Initialized task.')]); await session.prompt('Continue when the selected command completes.');
    faux.setResponses([fauxAssistantMessage('Resumed after actual background completion.')]);
    const run = await new BackgroundRuns(workspace).start({ repo: 'library', label: 'completion', task: manager.getSessionId(), argv: [process.execPath, '-e', 'setTimeout(()=>console.log("finished"),300)'] });
    const events = new TaskEvents(workspace); await events.start({ label: 'Resume task', task: manager.getSessionId(), entry: manager.getLeafId() ?? undefined, condition: { kind: 'background', run: run.spec.id }, resume: true, timeoutMs: 10000, pollMs: 250 });
    const deadline = Date.now() + 15000;
    while ((session.getLastAssistantText() !== 'Resumed after actual background completion.' || !session.isIdle) && Date.now() < deadline) await delay(50);
    assert.equal(session.getLastAssistantText(), 'Resumed after actual background completion.');
    assert(session.isIdle, 'The resumed Pi run must fully settle before source cleanup');
    await delay(500);
    const delivered = manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'enigma.event-delivery');
    assert.equal(delivered.length, 1); assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal((await events.delivery((await events.events(manager.getSessionId()))[0]!))?.state, 'enqueued');
  } finally { await session.abort(); session.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('a completed wait cancelled before delivery cannot restart the main task',async()=>{
 const {root,workspace}=await fixture(),waits=new TaskEvents(workspace),runs=new BackgroundRuns(workspace);let runId:string|undefined;
 const hooks=new Map<string,Function>(),sent:unknown[]=[];
 const pi:any={on:(name:string,handler:Function)=>hooks.set(name,handler),events:{emit(){}},getActiveTools:()=>[],setActiveTools(){},registerTool(){},appendEntry(){},sendMessage:(message:unknown)=>sent.push(message)};
 const ctx:any={cwd:root,isIdle:()=>true,hasPendingMessages:()=>false,sessionManager:{getSessionId:()=> 'owned',getBranch:()=>[]}};
 try{
  const run=await runs.start({repo:'library',task:'owned',label:'done',argv:[process.execPath,'-e','console.log("done")']});runId=run.spec.id;
  const wait=await waits.start({label:'resume later',task:'owned',condition:{kind:'background',run:runId},resume:true,pollMs:250});
  const until=Date.now()+5000;while(!(await waits.events('owned')).length&&Date.now()<until)await delay(25);const event=(await waits.events('owned'))[0]!;assert(event);assert(event.resume);
  await waits.cancel(wait.id,'owned');createDeliveryExtension({workspace,pollMs:10000})(pi);await hooks.get('session_start')!({},ctx);await hooks.get('agent_settled')!({},ctx);
  assert.equal(sent.length,0);assert.equal((await waits.delivery(event))?.state,'suppressed');
 }finally{await hooks.get('session_shutdown')?.();if(runId)await runs.drain(runId);await rm(root,{recursive:true,force:true});}
});
