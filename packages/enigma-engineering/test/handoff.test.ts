import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSession, createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { exportHandoff, inspectHandoff, type HandoffInput } from '../src/handoff.js';
import { importPiHandoff, seedPiCodeFork } from '../src/pi-session.js';
import { createEnigmaExtension } from '../src/pi-extension.js';
import piHandoff from '../src/pi-handoff.js';
import { MemoryStore } from '../src/memory.js';
import { PlanStore } from '../src/planning.js';
import { fixture } from './fixtures.js';
import { readJson, writeJson, storePath } from '../src/storage.js';

const input: HandoffInput = { mode: 'background', goal: 'Audit the SDK using the same project background.', source: { agent: 'pi', session: 'source', entry: 'point', requests: 12 },
  notes: [{ role: 'user', kind: 'background', text: 'library provides greet; sdk consumes it; app calls sdk.', reference: 'pi:source:background' },
    { role: 'assistant', kind: 'observation', text: 'Earlier exploration was incomplete.', reference: 'pi:source:answer' }] };

test('portable background package creates a clean Pi session and preserves source roles while detecting changed code', async () => {
  const { root, workspace } = await fixture();
  try {
    const oldPlan = await new PlanStore(workspace).create({ goal: 'OLD GOAL', steps: [{ id: 'old', repo: 'library', goal: 'Old task', checks: [] }] });
    const path = join(root, 'handoff'); await exportHandoff(workspace, path, input);
    const inspection = await inspectHandoff(workspace, path);
    assert(inspection.safeToContinue); assert.equal(inspection.manifest.plan, undefined);
    assert(inspection.document.includes('source role assistant')); assert(!inspection.document.includes('OLD GOAL'));
    const imported = await importPiHandoff(workspace, inspection);
    const manager = SessionManager.open(imported.sessionFile);
    assert(manager.getBranch().some(entry => entry.type === 'message' && entry.message.role === 'user'));
    assert(!manager.getBranch().some(entry => entry.type === 'message' && entry.message.role === 'assistant'));
    const domain = await readJson<{ requests: number; inheritedRequests: number }>(join(workspace.data, `session-${imported.sessionId}.json`));
    assert.equal(domain.requests, 0); assert.equal(domain.inheritedRequests, 12);
    assert.equal((await new PlanStore(workspace).current())?.id, oldPlan.id);
    await writeFile(join(root, 'sdk', 'index.js'), 'export function changed(){return 1;}\n');
    const later = await inspectHandoff(workspace, path);
    assert.equal(later.safeToContinue, false); assert(later.code.some(repo => repo.state === 'changed'));
    const tampered = (await readFile(join(path, 'handoff.md'), 'utf8')) + '\nuser edit\n'; await writeFile(join(path, 'handoff.md'), tampered);
    await assert.rejects(inspectHandoff(workspace, path), /changed after export/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('handoff rechecks current forgetting and rejects unknown continuation or oversized selected context', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = await MemoryStore.open(workspace);
    const memory = await store.save({ kind: 'research', scope: { type: 'project' }, title: 'Shared project', content: 'Unique memory marker', origin: { kind: 'user', reference: 'explicit' } }, { userStated: true });
    const path = join(root, 'handoff'); await exportHandoff(workspace, path, { ...input, memories: [memory.id] });
    await store.forget(memory.id);
    const inspected = await inspectHandoff(workspace, path);
    assert.equal(inspected.memories[0]?.state, 'omitted'); assert(!inspected.prompt.includes('Unique memory marker'));
    await writeJson(storePath(workspace.data, 'operations', 'pending'), { schema: 1, id: 'pending', status: 'unknown' });
    await assert.rejects(exportHandoff(workspace, join(root, 'continue'), { ...input, mode: 'continue' }), /Unresolved/);
    await assert.rejects(exportHandoff(workspace, join(root, 'large'), { ...input, notes: [{ ...input.notes[0]!, text: 'x'.repeat(49000) }] }), /48,000/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('continue import creates a separately owned plan without activating historical acceptance', async () => {
  const { root, workspace } = await fixture();
  try {
    const old = await new PlanStore(workspace).create({ goal: 'Continue actual project work', steps: [{ id: 'upstream', repo: 'library', goal: 'Inspect before editing', checks: [] }] });
    await new PlanStore(workspace).advance('upstream', old.revision, { phase: 'running' });
    const path = join(root, 'continue-context'); await exportHandoff(workspace, path, { ...input, mode: 'continue' });
    const inspection = await inspectHandoff(workspace, path);
    const imported = await importPiHandoff(workspace, inspection);
    const domain = await readJson<{ planFile: string; lastVerification: string }>(join(workspace.data, `session-${imported.sessionId}.json`));
    const own = await new PlanStore(workspace, domain.planFile).current(); assert(own);
    assert.notEqual(own.id, old.id); assert.equal(own.steps[0]?.phase, 'pending');
    assert.equal(domain.lastVerification, 'unverified');
    assert.equal((await new PlanStore(workspace).current())?.id, old.id);
    await rm(join(path, 'handoff.md'));
    await assert.rejects(inspectHandoff(workspace, path), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('selected evidence exports remain historical and missing attachments are detected', async () => {
  const { root, workspace } = await fixture();
  try {
    const evidence = await workspace.exclusive(async () => workspace.evidence('reading', { sources: [{ repo: 'library', file: 'index.js', hash: (await workspace.snapshotRepo('library')).files['index.js']!.hash }] }));
    const path = join(root, 'attached');
    const manifest = await exportHandoff(workspace, path, { ...input, evidence: [evidence.id], includeEvidence: true });
    assert.equal(manifest.attachments?.length, 1);
    assert((await readFile(join(path, manifest.attachments![0]!.file), 'utf8')).includes('never a target tool execution'));
    assert((await inspectHandoff(workspace, path)).safeToContinue);
    await rm(join(path, manifest.attachments![0]!.file));
    await assert.rejects(inspectHandoff(workspace, path), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('context package maps relocated repo IDs but cannot turn source acceptance into target acceptance', async () => {
  const source = await fixture(), target = await fixture();
  try {
    const packagePath = join(source.root, 'relocated'); await exportHandoff(source.workspace, packagePath, input);
    const mapped = await inspectHandoff(target.workspace, packagePath, { mapping: { library: 'library', sdk: 'sdk', app: 'app' } });
    assert(mapped.code.every(repo => repo.state === 'current'));
    assert(mapped.warnings.some(warning => warning.includes('configuration and permissions')));
    const missing = await inspectHandoff(target.workspace, packagePath, { mapping: { library: 'missing', sdk: 'sdk', app: 'app' } });
    assert.equal(missing.safeToContinue, false); assert(missing.code.some(repo => repo.state === 'unavailable'));
  } finally { await rm(source.root, { recursive: true, force: true }); await rm(target.root, { recursive: true, force: true }); }
});

test('running Pi cannot export or switch context in the middle of an unfinished model operation', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
    extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), piHandoff] }); await loader.reload();
  const manager = SessionManager.create(root, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  await session.bindExtensions({}); let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let started: (() => void) | undefined; const began = new Promise<void>(resolve => { started = resolve; });
  faux.setResponses([async () => { started?.(); await waiting; return fauxAssistantMessage('The active model operation finished.'); }]);
  const running = session.prompt('Complete the active task before exporting context.');
  try {
    await began;
    const destination = join(root, 'unsafe-mid-operation');
    try { await session.prompt(`/handoff-export ${JSON.stringify({ destination, goal: 'Another task', mode: 'background', entries: [{ id: manager.getLeafId() }] })}`); }
    catch (error) { assert(/streaming|idle|busy|settled/i.test(String(error))); }
    await assert.rejects(readFile(join(destination, 'manifest.json')), /ENOENT/);
    assert.equal(session.sessionId, manager.getSessionId());
    release?.(); await running;
  } finally { release?.(); await running.catch(() => undefined); session.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('native code fork seeds a separate conversation with latest requirements and original source unchanged', async () => {
  const { root, workspace } = await fixture();
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'));
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Preserve the original requirement.' }], timestamp: Date.now() });
    const checkpoint = await workspace.exclusive(() => workspace.checkpoint('native branch', { session: manager.getSessionId(), entry: manager.getLeafId() ?? undefined }));
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Latest requirement: use the SDK tests.' }], timestamp: Date.now() });
    const refs = manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'user').map(entry => entry.id);
    await writeJson(join(workspace.data, `session-${manager.getSessionId()}.json`), { schema: 1, requests: 7, sessionFile: manager.getSessionFile(), requirementEntries: refs });
    const before = await readFile(manager.getSessionFile()!, 'utf8');
    const fork = await workspace.exclusive(() => workspace.forkCheckpoint(checkpoint.id, join(root, 'code-fork'), { sourceSession: manager.getSessionId(), requests: 7, requirements: ['Latest requirement: use the SDK tests.'] }));
    const native = await seedPiCodeFork(workspace, fork, checkpoint);
    assert.notEqual(native.sessionId, manager.getSessionId());
    assert.equal(SessionManager.open(native.sessionFile).getCwd(), fork.root);
    const state = await readJson<{ inheritedRequests: number; requests: number; requirements: string[] }>(join(fork.data, `session-${native.sessionId}.json`));
    assert.equal(state.requests, 0); assert.equal(state.inheritedRequests, 7); assert(state.requirements.some(text => text.includes('Latest requirement')));
    assert.equal(await readFile(manager.getSessionFile()!, 'utf8'), before);
    assert.equal((await readJson<{ sessionFile: string }>(join(fork.data, 'session-start.json'))).sessionFile, native.sessionFile);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Pi new-context command forks selected background into a new task with its own plan scope', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); modelRuntime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const original = SessionManager.create(root, join(root, 'sessions'));
  const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager: settings, resourceLoaderOptions: { noSkills: true, noContextFiles: true,
      extensionFactories: [createEnigmaExtension({ workspace, approval: 'auto', managed: true }), piHandoff] } });
    return { ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel() })), services, diagnostics: [] };
  }, { cwd: root, agentDir, sessionManager: original });
  const errors: unknown[] = [];
  const bind = async (session: typeof runtime.session) => session.bindExtensions({ onError: error => errors.push(error), commandContextActions: {
    waitForIdle: () => session.waitForIdle(), newSession: options => runtime.newSession(options), fork: (entry, options) => runtime.fork(entry, options),
    switchSession: (path, options) => runtime.switchSession(path, options), navigateTree: (entry, options) => session.navigateTree(entry, options),
    reload: () => session.reload(),
  } });
  runtime.setRebindSession(bind); await bind(runtime.session);
  try {
    faux.setResponses([fauxAssistantMessage('Background received.')]); await runtime.session.prompt('Shared background marker: three repositories with library, SDK and app.');
    const sourceId = original.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user')!.id;
    const oldPlan = await new PlanStore(workspace).create({ goal: 'Old migration task', steps: [{ id: 'old', repo: 'library', goal: 'Old work', checks: [] }] });
    const before = await readFile(original.getSessionFile()!, 'utf8');
    await runtime.session.prompt(`/new-context ${JSON.stringify({ goal: 'Review tests with this background.', entries: [{ id: sourceId }] })}`);
    assert.notEqual(runtime.session.sessionId, original.getSessionId());
    assert.equal(await readFile(original.getSessionFile()!, 'utf8'), before);
    let targetContext = '';
    faux.setResponses([context => { targetContext = JSON.stringify(context); return fauxAssistantMessage([fauxToolCall('task_plan', { action: 'read' })], { stopReason: 'toolUse' }); }, fauxAssistantMessage('The new background task has no active old plan.')]);
    const outcomes: unknown[] = []; runtime.session.subscribe(event => { if (event.type === 'tool_execution_end') outcomes.push(event.result); });
    await runtime.session.prompt('Inspect the current task plan and background.');
    assert(outcomes.some(result => (result as { structuredContent?: { plan?: unknown } }).structuredContent?.plan === null));
    assert.equal((await new PlanStore(workspace).current())?.id, oldPlan.id);
    const currentState = await readJson<{ handoff?: { mode: string } }>(join(workspace.data, `session-${runtime.session.sessionId}.json`));
    assert.equal(currentState.handoff?.mode, 'background');
    assert(targetContext.includes('new task using selected background'));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const exportPath = join(root, 'background-session-export');
    const activeUser = runtime.session.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user')!.id;
    const statePath = join(workspace.data, `session-${runtime.session.sessionId}.json`);
    const accounting = await readJson<Record<string, unknown>>(statePath);
    await writeJson(statePath, { ...accounting, requests: 5, inheritedRequests: 3 });
    await runtime.session.prompt(`/handoff-export ${JSON.stringify({ destination: exportPath, mode: 'continue', goal: 'Continue the new background task', entries: [{ id: activeUser }] })}`);
    const exported = await inspectHandoff(workspace, exportPath);
    assert.equal(exported.manifest.plan, undefined, 'original task plan must not leak through a session-scoped handoff');
    assert.equal(exported.manifest.source.requests, 8);
    const newer = runtime.session.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user')!.id;
    faux.setResponses([fauxAssistantMessage('The new rule is now recorded.')]);
    await runtime.session.prompt('Latest requirement outside the old branch: keep latest-marker unchanged.');
    const parentId = runtime.session.sessionId;
    await runtime.fork(newer, { position: 'at' });
    assert.notEqual(runtime.session.sessionId, parentId);
    const forkState = await readJson<{ requirements: string[]; reviewEntries: string[] }>(join(workspace.data, `session-${runtime.session.sessionId}.json`));
    assert(forkState.requirements.some(text => text.includes('latest-marker')));
    assert(forkState.reviewEntries.length);
    faux.setResponses([fauxAssistantMessage([fauxToolCall('task_requirements', {})], { stopReason: 'toolUse' }), fauxAssistantMessage('Latest original user updates were read from the domain handoff.')]);
    await runtime.session.prompt('Read all latest original updates before continuing.');
    const reviewedState = await readJson<{ reviewEntries: string[] }>(join(workspace.data, `session-${runtime.session.sessionId}.json`));
    assert.equal(reviewedState.reviewEntries.length, 0);
  } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }); }
});
