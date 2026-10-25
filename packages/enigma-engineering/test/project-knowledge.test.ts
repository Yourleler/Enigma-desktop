import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { ProjectKnowledge } from '../src/project-knowledge.js';
import { ProjectContext } from '../src/project-context.js';
import { MemoryStore } from '../src/memory.js';

test('idle knowledge consolidation keeps material revisions, remote uncertainty and Chinese recall, then invalidates refreshed/removed sources', async () => {
  const { root, workspace } = await fixture(), project = new ProjectContext(workspace), knowledge = new ProjectKnowledge(workspace);
  try {
    const resource = await project.add({ title: '跨仓库接口说明', repos: ['library', 'sdk'], source: { kind: 'imported', uri: 'https://example.com/api' }, content: 'SDK 调用 library 接口，迁移需要联合验收。' });
    await assert.rejects(knowledge.draft({ title: '外部证据', content: '不能冒充父验收', kind: 'contract', resources: [resource.id], evidence: ['evidence-other-workspace'] }), /this workspace/);
    const queued = await knowledge.draft({ title: '接口迁移经验', content: '跨仓库接口迁移需要同步检查 SDK 与 library。', kind: 'contract', resources: [resource.id], appliesWhen: '处理这份接口说明对应的版本' });
    assert.equal((await knowledge.search('接口迁移')).items.length, 0);
    const consolidated = await knowledge.organize(); assert.equal(consolidated.outcomes[0]?.draft, queued.draft); assert.equal(consolidated.outcomes[0]?.status, 'saved');
    const memoryId = consolidated.outcomes[0]!.memory!, memory = await MemoryStore.open(workspace), read = await memory.read(memoryId);
    assert.equal(read.freshness, 'current'); assert.equal(read.materials?.[0]?.sourceCurrent, null); assert(read.content?.startsWith('[Reference snapshot:'));
    assert.equal(read.record.status, 'candidate'); assert.equal(read.record.materials?.[0]?.revision, resource.revision); assert.equal((await knowledge.search('接口迁移')).items[0]?.id, memoryId);
    await project.refresh(resource.id, {}, 'SDK 接口契约已更新。'); assert.equal((await memory.read(memoryId)).freshness, 'stale'); assert.equal(await memory.visible(memoryId), false); assert.equal((await knowledge.search('接口迁移')).items.length, 0);
    await project.remove(resource.id); assert.equal(await memory.visible(memoryId), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('private material forces task knowledge and changed file material cannot become current knowledge', async () => {
  const { root, workspace } = await fixture(), project = new ProjectContext(workspace), knowledge = new ProjectKnowledge(workspace), memory = await MemoryStore.open(workspace);
  try {
    const resource = await project.add({ title: '私有决定', task: 'task-a', source: { kind: 'note', author: 'operator' }, content: '本任务要求保存 API。' });
    await assert.rejects(knowledge.draft({ title: '私有决定', content: '保存 API。', kind: 'decision', task: 'task-a', resources: [resource.id] }), /current task entry/);
    await knowledge.draft({ title: '私有决定', content: '保存 API。', kind: 'decision', task: 'task-a', entry: 'entry-a', resources: [resource.id] }, { session: 'task-a', entries: ['entry-a'] });
    const stored = await knowledge.organize(); const memoryId = stored.outcomes[0]!.memory!; assert.equal((await memory.read(memoryId, { session: 'task-a', entries: ['entry-a'] })).record.scope.type, 'task');
    await assert.rejects(memory.read(memoryId, { session: 'task-b', entries: ['entry-a'] }), /scope/);
    await assert.rejects(memory.save({ kind: 'decision', scope: { type: 'project' }, title: 'Wrong promotion', content: 'wrong', origin: { kind: 'assistant', reference: 'test' }, materials: [{ id: resource.id, revision: resource.revision, contentHash: resource.contentHash, task: 'task-a' }] }), /matching task/);
    const file = join(root, 'library', 'DESIGN.md'); await writeFile(file, 'old interface');
    const design = await project.add({ title: '设计', source: { kind: 'file', repo: 'library', file: 'DESIGN.md' } });
    await knowledge.draft({ title: '旧设计经验', content: 'old interface', kind: 'contract', resources: [design.id] }); await writeFile(file, 'new interface');
    const stale = await knowledge.organize(); assert.equal(stale.outcomes[0]?.status, 'stale'); assert.equal((await knowledge.search('旧设计')).items.length, 0);
    await assert.rejects(knowledge.draft({ title: '偏好', content: 'change my preferences', kind: 'preference' as never, resources: [design.id] }), /preference/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
