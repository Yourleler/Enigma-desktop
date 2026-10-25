import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MemoryStore, type MemoryInput } from '../src/memory.js';
import { RecallGate } from '../src/recall.js';
import { createMemoryExtension } from '../src/pi-memory.js';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { fixture } from './fixtures.js';

const note: MemoryInput = { kind: 'troubleshooting', scope: { type: 'repositories', repos: ['sdk'] }, title: 'sdk response mismatch',
  content: 'SDK response mismatch occurs when the producer changes message to data.message. Check the service and the response consumer.',
  appliesWhen: 'response mismatch', origin: { kind: 'source', reference: 'source-index.js' }, sources: [{ repo: 'sdk', file: 'index.js' }] };

test('rebuildable memory index detects physical edits, drops deleted notes, and repairs corrupt indexes', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = await MemoryStore.open(workspace), saved = await store.save(note);
    const first = await store.index(); assert.equal(first.refreshed, 1);
    const repeat = await store.index(); assert.equal(repeat.reused, 1); assert.equal(repeat.refreshed, 0);
    await writeFile(join(store.directory, 'entries', `${saved.id}.md`), 'newtopic 人工修改的失败经验。');
    const edited = await store.search('newtopic', {}, { includeStale: true }); assert.equal(edited.items[0]?.id, saved.id); assert.equal(edited.items[0]?.freshness, 'stale');
    await writeFile(join(store.directory, 'search-index.json'), '{broken');
    assert.equal((await store.search('newtopic', {}, { includeStale: true })).items[0]?.id, saved.id);
    await store.forget(saved.id); assert.equal(Object.keys((await store.index()).index.entries).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('idle consolidation promotes current source drafts and rejects stale or cancelled drafts', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = await MemoryStore.open(workspace);
    const queued = await store.queue(note); assert.equal((await store.search('response mismatch')).items.length, 0);
    const organized = await store.organize(); assert.equal(organized.outcomes[0]?.draft, queued); assert.equal(organized.outcomes[0]?.status, 'saved');
    assert.equal((await store.search('response mismatch')).items.length, 1);
    await store.queue(note); await writeFile(join(root, 'sdk', 'index.js'), 'export const newer = true;\n');
    const stale = await store.organize(); assert.equal(stale.outcomes[0]?.status, 'stale');
    assert(stale.outcomes[0]?.reason?.includes('Source changed'));
    const cancelled = await store.queue({ ...note, content: 'cancel marker' }); const controller = new AbortController(); controller.abort();
    assert.equal((await store.organize({ signal: controller.signal })).outcomes.length, 0);
    assert.equal(JSON.parse(await readFile(join(store.directory, 'drafts', `${cancelled}.json`), 'utf8')).state, 'queued');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('difficulty admission requires repeated evidence and bounds suggestions by signature and cooldown', () => {
  const gate = new RecallGate();
  assert.equal(gate.observe('repeated-error', 'command', 'same', 'response mismatch'), undefined);
  assert.equal(gate.observe('repeated-error', 'command', 'same', 'response mismatch'), undefined);
  const signal = gate.observe('repeated-error', 'command', 'same', 'response mismatch'); assert(signal);
  assert.equal(gate.admit(signal, 100000), true); assert.equal(gate.admit(signal, 200000), false);
  gate.reset(); assert.equal(gate.observe('repeated-reading', 'sdk:index.js', 'changed-version', 'index.js'), undefined);
});

test('memory recovery rejects a live writer and retains unknown promotion instead of replaying it', async () => {
  const { root, workspace } = await fixture();
  const store = await MemoryStore.open(workspace);
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const exited = new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
  try {
    assert(child.pid);
    await writeFile(join(store.directory, 'memory.lock'), JSON.stringify({ pid: child.pid, token: 'actual-child-writer' }));
    await assert.rejects(store.recover(), /still active/);
    const draft = await store.queue(note);
    const path = join(store.directory, 'drafts', `${draft}.json`); const body = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...body, state: 'processing' }));
    child.kill('SIGKILL'); await exited;
    const recovered = await store.recover(); assert.deepEqual(recovered.releasedLocks, ['memory']); assert.deepEqual(recovered.unknownDrafts, [draft]);
    assert.equal((await store.organize()).outcomes.length, 0); assert.equal((await store.search('response mismatch')).items.length, 0);
  } finally { child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }); }
});

test('managed Pi offers version-checked memory once after repeated failure without rereading the whole corpus', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  const store = await MemoryStore.open(workspace); const saved = await store.save(note);
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
    extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createMemoryExtension({ workspace, enabled: true })] });
  await loader.reload(); const manager = SessionManager.create(root, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  try {
    faux.setResponses([
      ...Array.from({ length: 4 }, () => fauxAssistantMessage([fauxToolCall('repo_run', { repo: 'sdk', argv: [process.execPath, '-e', 'console.log("response mismatch");process.exit(1)'] })], { stopReason: 'toolUse' })),
      fauxAssistantMessage([fauxToolCall('memory_read',{id:saved.id})],{stopReason:'toolUse'}),
      context=>{assert(JSON.stringify(context).includes('SDK response mismatch occurs'));return fauxAssistantMessage([fauxToolCall('workspace_repos',{})],{stopReason:'toolUse'});},
      context=>{assert(!JSON.stringify(context).includes('SDK response mismatch occurs'));return fauxAssistantMessage('Stop repeating and inspect the relevant previous experience.');},
    ]);
    await session.prompt('Investigate SDK response mismatch without blind retries.');
    const suggestions = manager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === 'enigma.memory-suggestion');
    assert.equal(suggestions.length, 1, JSON.stringify({ suggestions, errors }));
    assert(JSON.stringify(suggestions).includes(saved.id)); assert(!session.systemPrompt.includes(note.content));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    await session.prompt('记住：在这个项目中，接口文档使用长期-label。');
    const explicit = (await store.search('长期-label')).items[0]; assert(explicit); assert.equal(explicit.status, 'user-stated');
    await session.prompt(`更正记忆：${explicit.id} 在这个项目中，接口文档使用更正-label。`);
    await assert.rejects(store.read(explicit.id), /forgotten/);
    const corrected = (await store.search('更正-label')).items[0]; assert(corrected);
    await session.prompt(`忘记：${corrected.id}`); await assert.rejects(store.read(corrected.id), /forgotten/);
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});
