import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { ProjectContext } from '../src/project-context.js';

test('project materials retain source versions, Chinese recall and explicit reference roles', async () => {
  const { root, workspace } = await fixture();
  try {
    const path = join(root, 'library', '接口设计.md');
    await writeFile(path, '# 接口迁移\n旧响应 message，新响应 data.message。\n');
    const store = new ProjectContext(workspace);
    const resource = await store.add({ title: '跨仓库接口设计', source: { kind: 'file', repo: 'library', file: '接口设计.md' } });
    assert.equal((await store.search('接口迁移')).items[0]?.id, resource.id);
    assert.equal((await store.read(resource.id)).current, true);
    await writeFile(path, '# 接口迁移\n最终统一为 data.text。\n');
    assert.equal((await store.read(resource.id)).current, false);
    assert.equal((await store.materialize('接口迁移')).items.length, 0);
    const refreshed = await store.refresh(resource.id);
    assert.equal(refreshed.revision, 2); assert.equal((await store.read(resource.id, {}, 1)).current, false);
    assert((await store.materialize('接口迁移')).items.some(item => 'content' in item && item.content?.includes('data.text')));
    assert.equal(refreshed.role, 'reference');
    await store.remove(resource.id);
    await assert.rejects(store.read(resource.id, {}, 1), /removed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('task materials remain scoped, imported freshness is unknown and secrets never persist as content', async () => {
  const { root, workspace } = await fixture();
  try {
    const secret = 'task-private-secret-value'; workspace.secrets.push(secret);
    const store = new ProjectContext(workspace);
    const resource = await store.add({ title: '新方案', task: 'task-a', source: { kind: 'imported', uri: 'https://example.com/design' }, content: `参考材料 ${secret}` });
    assert.equal((await store.search('新方案')).items.length, 0);
    const read = await store.read(resource.id, { task: 'task-a' });
    assert.equal(read.current, null); assert(!read.content.includes(secret));
    assert.equal((await store.search('新方案', { task: 'task-a' })).items.length, 1);
    await assert.rejects(store.refresh(resource.id, { task: 'task-a' }), /newly fetched/);
    await assert.rejects(store.add({ title: '越界', source: { kind: 'file', repo: 'library', file: '../sdk/index.js' } }), /within/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
