import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { RunObserver, readObserverStatus } from '../src/observer.js';
import { measured } from '../src/telemetry.js';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { createObserverExtension } from '../src/pi-observer.js';
import { fixture } from './fixtures.js';

test('observer reflects real awaiting approval and mirror errors cannot change operation results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-observer-boundary-')); const observer = await RunObserver.create(root, 'boundary');
  try {
    let resolveApproval: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { resolveApproval = resolve; });
    const operation = measured('approval', {}, async () => { await waiting; return 'confirmed'; }, event => observer.record(event));
    await observer.flush(); const status = await readObserverStatus(root); assert(status.available); assert(status.stages.some(stage => stage.label === '等待用户确认'));
    resolveApproval?.(); assert.equal(await operation, 'confirmed');
    await rm(observer.directory, { recursive: true, force: true }); await writeFile(observer.directory, 'blocked mirror');
    observer.record({ kind: 'start', stage: 'tool', id: 'observed' }); await observer.flush(); assert(observer.state.collection.failed);
    assert.equal(await measured('source', {}, async () => 'operation unaffected', () => { throw new Error('mirror error'); }), 'operation unaffected');
  } finally { await observer.close(); await rm(root, { recursive: true, force: true }); }
});

test('cancellation of a native Pi tool clears active stages and never reports completed run', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resources = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
    extensionFactories: [createObserverExtension({ enabled: true }), createEnigmaExtension({ workspace, managed: true, approval: 'auto' })] }); await resources.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), resourceLoader: resources, settingsManager: settings });
  await session.bindExtensions({});
  try {
    faux.setResponses([fauxAssistantMessage([fauxToolCall('repo_run', { repo: 'sdk', argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] })], { stopReason: 'toolUse' })]);
    const started = new Promise<void>(resolve => { session.subscribe(event => { if (event.type === 'tool_execution_start') resolve(); }); });
    const running = session.prompt('Run a cancellable command.'); await started; await session.abort(); await running;
    let status = await readObserverStatus(root);
    for (let i = 0; i < 50 && status.available && status.state !== 'aborted'; i++) { await new Promise(resolve => setTimeout(resolve, 30)); status = await readObserverStatus(root); }
    assert(status.available); assert.equal(status.state, 'aborted'); assert.equal(status.stages.length, 0);
  } finally { session.dispose(); await new Promise(resolve => setTimeout(resolve, 300)); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
