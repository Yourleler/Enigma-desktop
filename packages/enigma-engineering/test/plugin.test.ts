import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Type } from 'typebox';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { loadPiForkHandoff } from '../src/pi-session.js';
import { fixture } from './fixtures.js';
import { runProcess } from '../src/process.js';
import { readJson, writeJson } from '../src/storage.js';

test('native Pi installs the local package, loads it alongside another extension, and removes it', async () => {
  const { root, workspace } = await fixture();
  const agentDir = join(root, 'pi-home');
  const pi = fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0' };
  try {
    const installed = await runProcess([process.execPath, pi, 'install', resolve('.')], root, { env, timeoutMs: 30_000 });
    assert.equal(installed.status, 'passed', installed.output);
    const settings = SettingsManager.create(root, agentDir);
    let pings = 0;
    const other = (api: ExtensionAPI) => { api.registerTool({ name: 'other_ping', label: 'Other ping', description: 'Unrelated extension',
      parameters: Type.Object({}), async execute() { pings++; return { content: [{ type: 'text', text: 'pong' }], details: {} }; } }); };
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
      extensionFactories: [other] });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    assert(loader.getExtensions().extensions.some(extension => extension.tools.has('repo_read')),
      JSON.stringify({ settings: settings.getPackages(), paths: loader.getExtensions().extensions.map(extension => extension.path) }));
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100_000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), settingsManager: settings,
      resourceLoader: loader, sessionManager: SessionManager.inMemory(root) });
    const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
    try {
      faux.setResponses([fauxAssistantMessage('Initialize the additive session.')]);
      await session.prompt('Initialize.');
      assert(session.getActiveToolNames().includes('read'));
      assert(session.getActiveToolNames().includes('other_ping'));
      assert(session.getActiveToolNames().includes('repo_read'));
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('other_ping', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxToolCall('write', { path: 'ordinary.txt', content: 'native Pi remains usable' })], { stopReason: 'toolUse' }),
        fauxAssistantMessage('Other tools are available.'),
      ]);
      await session.prompt('Use the unrelated tool and native write.');
      assert.equal(pings, 1);
      assert.equal(await readFile(join(root, 'ordinary.txt'), 'utf8'), 'native Pi remains usable');
      assert.equal(errors.length, 0, JSON.stringify(errors));
    } finally { session.dispose(); }
    const removed = await runProcess([process.execPath, pi, 'remove', resolve('.')], root, { env, timeoutMs: 30_000 });
    assert.equal(removed.status, 'passed', removed.output);
    const cleanLoader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: SettingsManager.create(root, agentDir), noContextFiles: true });
    await cleanLoader.reload();
    assert(!cleanLoader.getExtensions().extensions.some(extension => [...extension.tools.keys()].includes('repo_read')));
    assert(!(await workspace.checkpoints()).some(checkpoint => checkpoint.label === 'turn settled'), 'ordinary additive task must not be automatically certified');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit managed mode blocks native and unrelated dispatch while preserving tools for additive mode', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  try {
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100_000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    let dispatched = false;
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: SettingsManager.inMemory(), noContextFiles: true,
      extensionFactories: [createEnigmaExtension({ workspace, approval: 'auto' }), api => api.registerTool({ name: 'other_side_effect', label: 'Other', description: 'Unrelated operation',
        parameters: Type.Object({}), async execute() { dispatched = true; return { content: [{ type: 'text', text: 'ran' }], details: {} }; } })] });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), resourceLoader: loader,
      settingsManager: SettingsManager.inMemory() });
    const errors: unknown[] = [];
    const outcomes: unknown[] = [];
    session.subscribe(event => { if (event.type === 'tool_execution_end') outcomes.push(event); });
    await session.bindExtensions({ onError: error => errors.push(error) });
    try {
      faux.setResponses([fauxAssistantMessage('Initialize.')]);
      await session.prompt('Initialize the additive session.');
      await session.prompt('/enigma-mode managed');
      await session.reload();
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('write', { path: 'bypass.txt', content: 'wrong' }), fauxToolCall('other_side_effect', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'library', path: 'recorded.txt', content: 'recorded' })], { stopReason: 'toolUse' }),
        fauxAssistantMessage('Managed operation complete.'),
      ]);
      await session.prompt('Exercise managed dispatch.');
      await assert.rejects(readFile(join(root, 'bypass.txt')), /ENOENT/);
      assert.equal(dispatched, false);
      assert(outcomes.some(event => (event as { toolName: string; isError: boolean }).toolName === 'repo_write' && !(event as { isError: boolean }).isError), JSON.stringify({ errors, outcomes }));
      assert.equal(await readFile(join(root, 'library', 'recorded.txt'), 'utf8'), 'recorded');
      await session.prompt('/enigma-mode additive');
      faux.setResponses([fauxAssistantMessage([fauxToolCall('other_side_effect', {})], { stopReason: 'toolUse' }), fauxAssistantMessage('Additive operation complete.')]);
      await session.prompt('Use the other tool.');
      assert.equal(dispatched, true);
      assert(session.getActiveToolNames().includes('write'));
    } finally { session.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('session-bound code forks resolve latest original requirements in the Pi adapter', async () => {
  const { root, workspace } = await fixture();
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'));
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Keep the original requirement.' }], timestamp: Date.now() });
    const checkpoint = await workspace.exclusive(() => workspace.checkpoint('branch source', { session: manager.getSessionId(), entry: manager.getLeafId() ?? undefined }));
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Latest requirement must survive.' }], timestamp: Date.now() });
    const entries = manager.getEntries().filter(entry => entry.type === 'message' && entry.message.role === 'user').map(entry => entry.id);
    await writeJson(join(workspace.data, `session-${manager.getSessionId()}.json`), { schema: 1, sessionFile: manager.getSessionFile(), requirements: [], requirementEntries: entries, requests: 9 });
    const destination = join(root, 'fork');
    await assert.rejects(workspace.exclusive(() => workspace.forkCheckpoint(checkpoint.id, destination)), /host-resolved handoff/);
    const handoff = await loadPiForkHandoff(workspace, checkpoint);
    const fork = await workspace.exclusive(() => workspace.forkCheckpoint(checkpoint.id, destination, handoff));
    const state = await readJson<{ requirements: string[]; requests: number }>(join(fork.data, 'fork-state.json'));
    assert(state.requirements.includes('Latest requirement must survive.'));
    assert.equal(state.requests, 9);
  } finally { await rm(root, { recursive: true, force: true }); }
});
