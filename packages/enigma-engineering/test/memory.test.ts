import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MemoryStore, type MemoryInput } from '../src/memory.js';
import { createMemoryExtension } from '../src/pi-memory.js';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { fixture } from './fixtures.js';

const input = (content: string): MemoryInput => ({ kind: 'contract', scope: { type: 'repositories', repos: ['library', 'sdk'] },
  title: '公共接口与消费者', content, appliesWhen: '公共接口升级，检查消费者与联合验收', tags: ['greet', 'contract'], origin: { kind: 'assistant', reference: 'test-source-note' },
  sources: [{ repo: 'library', file: 'index.js' }, { repo: 'sdk', file: 'index.js' }] });

test('scoped cross-session memory retrieves Chinese contract knowledge and expires after source changes', async () => {
  const { root, workspace } = await fixture();
  try {
    const firstStore = await MemoryStore.open(workspace);
    const saved = await firstStore.save(input('公共接口 greet 由 library 提供，sdk 消费。返回值变化后必须核查下游消费者。'));
    const nextSessionStore = await MemoryStore.open(workspace);
    const recalled = await nextSessionStore.search('公共接口变更 消费者');
    assert.equal(recalled.items[0]?.id, saved.id);
    assert.equal(recalled.items[0]?.status, 'candidate');
    assert(recalled.items[0]?.reasons.some(reason => reason.includes('公共')));
    assert((await nextSessionStore.read(saved.id)).content?.includes('greet'));
    await writeFile(join(root, 'library', 'index.js'), 'export function greet(){ return {message:"new"}; }\n');
    assert.equal((await nextSessionStore.read(saved.id)).freshness, 'stale');
    assert.equal((await nextSessionStore.search('greet')).items.length, 0);
    assert.equal((await nextSessionStore.search('greet', {}, { includeStale: true })).items[0]?.freshness, 'stale');
    assert.equal((await nextSessionStore.search('unrelated-secret-requirement')).items.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('task memory is branch-scoped and explicit forgetting survives code restoration', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = await MemoryStore.open(workspace);
    const note = await store.save({ ...input('方案 A 仅用于本次任务。'), scope: { type: 'task', session: 'session-a', entry: 'entry-a' } },
      { access: { session: 'session-a', entries: ['entry-a'] } });
    assert.equal((await store.search('方案', { session: 'session-b', entries: ['entry-a'] })).items.length, 0);
    assert.equal((await store.search('方案', { session: 'session-a', entries: ['entry-other'] })).items.length, 0);
    const before = await workspace.exclusive(() => workspace.checkpoint('before forgetting'));
    await store.forget(note.id, { session: 'session-a', entries: ['entry-a'] });
    await workspace.exclusive(() => workspace.mutate('library', 'write', () => writeFile(join(root, 'library', 'temporary.txt'), 'temporary')));
    const after = await workspace.exclusive(() => workspace.checkpoint('later'));
    await workspace.exclusive(() => workspace.restore(before.id, after.id));
    await assert.rejects(store.read(note.id, { session: 'session-a', entries: ['entry-a'] }), /forgotten/);
    assert.equal((await store.search('方案', { session: 'session-a', entries: ['entry-a'] })).items.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preferences require explicit user origin and correction suppresses older memory', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = await MemoryStore.open(workspace);
    const preference: MemoryInput = { kind: 'preference', scope: { type: 'project' }, title: '输出语言', content: '长期偏好中文解释。', origin: { kind: 'user', reference: 'explicit-user-request' } };
    await assert.rejects(store.save(preference), /explicit user/);
    const original = await store.save(preference, { userStated: true });
    const correction = await store.save({ ...preference, content: '长期偏好英文解释。' }, { userStated: true, replaces: original.id });
    await assert.rejects(store.read(original.id), /forgotten/);
    assert.equal((await store.search('输出语言')).items[0]?.id, correction.id);
    assert.equal((await store.read(correction.id)).record.status, 'user-stated');
    const other = await fixture();
    try { assert.equal((await (await MemoryStore.open(other.workspace)).search('输出语言')).items.length, 0); }
    finally { await rm(other.root, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('human-edited memory can be discovered but is marked stale until explicitly re-saved', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = await MemoryStore.open(workspace);
    const note = await store.save(input('原始代码知识。'));
    await writeFile(join(store.directory, 'entries', `${note.id}.md`), '人工编辑加入了 serialization 字段约束。');
    const result = await store.search('serialization', {}, { includeStale: true });
    assert.equal(result.items[0]?.id, note.id); assert.equal(result.items[0]?.freshness, 'stale');
    assert.equal((await store.search('serialization')).items.length, 0);
    const body = (await store.read(note.id)).content!;
    const updated = await store.save(input(body), { userStated: true, replaces: note.id });
    assert.equal((await store.search('serialization')).items[0]?.id, updated.id);
    assert.equal((await store.read(updated.id)).freshness, 'current');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('personal store is opt-in and secret values are redacted before indexing and reads', async () => {
  const { root, workspace } = await fixture(); const personalRoot = await mkdtemp(join(tmpdir(), 'enigma-personal-memory-'));
  try {
    const store = await MemoryStore.open(workspace, { personalDirectory: personalRoot });
    const preference: MemoryInput = { kind: 'preference', scope: { type: 'personal' }, title: '个人习惯', content: '解释要简洁。sk-privatekey12345678901234567890', origin: { kind: 'user', reference: 'explicit' } };
    await assert.rejects(store.save(preference, { userStated: true }), /permitted scope/);
    const note = await store.save(preference, { userStated: true, access: { allowPersonal: true } });
    await assert.rejects(store.read(note.id), /permitted scope/);
    const read = await store.read(note.id, { allowPersonal: true });
    assert(read.content?.includes('[REDACTED]')); assert(!read.content?.includes('sk-private'));
    assert(!(await readFile(join(store.directory, 'entries', `${note.id}.md`), 'utf8')).includes('sk-private'));
  } finally { await rm(root, { recursive: true, force: true }); await rm(personalRoot, { recursive: true, force: true }); }
});

test('an interrupted deletion marker blocks an older memory pointer from reviving content', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = await MemoryStore.open(workspace); const note = await store.save(input('不得复活的公共接口知识。'));
    await writeFile(join(store.directory, 'entries', `${note.id}.forgotten`), JSON.stringify({ id: note.id, at: new Date().toISOString() }));
    await assert.rejects(store.read(note.id), /forgotten/);
    assert.equal((await store.search('公共接口', {}, { includeStale: true })).items.length, 0);
    await assert.rejects(store.save(input('新的条目'), { userStated: true, replaces: note.id }), /deleted/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('memory plugin coexists with managed Pi and uses candidate source notes without injecting a whole memory corpus', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
    extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createMemoryExtension({ workspace, enabled: true })] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const manager = SessionManager.create(root, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), settingsManager: settings, resourceLoader: loader, sessionManager: manager });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  try {
    faux.setResponses([fauxAssistantMessage([fauxToolCall('memory_note', { kind: 'contract', title: '公共接口', content: 'greet 是上游公共接口，调用方需要检查。', repos: ['library'], sources: [{ repo: 'library', file: 'index.js' }] })], { stopReason: 'toolUse' }), fauxAssistantMessage('Saved a candidate source note.')]);
    await session.prompt('Inspect and save candidate source knowledge.');
    const store = await MemoryStore.open(workspace); const saved = (await store.search('公共接口')).items[0]; assert(saved);
    assert(!session.systemPrompt.includes('greet 是上游公共接口'));
    faux.setResponses([fauxAssistantMessage([fauxToolCall('memory_search', { query: '公共接口' })], { stopReason: 'toolUse' }), fauxAssistantMessage([fauxToolCall('memory_read', { id: saved.id })], { stopReason: 'toolUse' }), fauxAssistantMessage('Read the current note and source provenance.')]);
    await session.prompt('Use prior knowledge about the public API.');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    await session.prompt(`/memory-forget ${saved.id}`);
    await assert.rejects(store.read(saved.id), /forgotten/);
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('forgetting suppresses identifiable old memory tool bodies from future Pi context while retaining raw history', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  const store = await MemoryStore.open(workspace); const secretFact = 'unique-forgotten-knowledge-483721';
  const note = await store.save({ ...input(secretFact), title: 'Old knowledge' });
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
    extensionFactories: [createMemoryExtension({ workspace, enabled: true })] }); await loader.reload();
  const manager = SessionManager.create(root, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  await session.bindExtensions({});
  try {
    faux.setResponses([fauxAssistantMessage([fauxToolCall('memory_search', { query: 'Old knowledge' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('memory_read', { id: note.id })], { stopReason: 'toolUse' }), context => { assert(JSON.stringify(context).includes(secretFact)); return fauxAssistantMessage('I read the note.'); }]);
    await session.prompt('Read the selected old note.'); await session.prompt(`/memory-forget ${note.id}`);
    faux.setResponses([context => { assert(!JSON.stringify(context).includes(secretFact)); assert(JSON.stringify(context).includes('forgotten')); return fauxAssistantMessage('That old memory is unavailable now.'); }]);
    await session.prompt('Use only current memory scope.');
    assert((await readFile(manager.getSessionFile()!, 'utf8')).includes(secretFact), 'raw source history stays append-only');
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});
