import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { ProjectContext } from '../src/project-context.js';

test('search retries concurrent refresh/removal and does not expose revoked or mixed-version results', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = new ProjectContext(workspace);
    await writeFile(join(root, 'library', 'reference.md'), 'design source');
    const removed = await store.add({ title: 'design file', source: { kind: 'file', repo: 'library', file: 'reference.md' } });
    const changed = await store.add({ title: 'design note', source: { kind: 'note', author: 'user' }, content: 'before revision' });
    const privateItem = await store.add({ title: 'design private', task: 'other-task', source: { kind: 'note', author: 'user' }, content: 'not visible here' });
    const path = workspace.path.bind(workspace); let raced = false;
    workspace.path = async (...args) => {
      const result = await path(...args);
      if (!raced && args[1] === 'reference.md') {
        raced = true;
        await store.remove(removed.id);
        await store.refresh(changed.id, {}, 'after revision');
      }
      return result;
    };
    const found = await store.search('design');
    assert(raced); assert.deepEqual(found.items.map(item => item.id), [changed.id]);
    assert.equal(found.items[0]?.revision, 2);
    assert(!found.items.some(item => item.id === privateItem.id));
    await assert.rejects(store.read(removed.id), /removed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('context assembly retains the selected revision when an imported resource refreshes during search', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = new ProjectContext(workspace), resource = await store.add({ title: '协议设计', source: { kind: 'imported', uri: 'https://example.com/design' }, content: '原版协议：data.text' });
    const search = store.search.bind(store);
    store.search = async (...args) => {
      const selected = await search(...args);
      await store.refresh(resource.id, {}, '新版协议：data.value');
      return selected;
    };
    const context = await store.materialize('协议');
    assert.equal(context.items[0]?.revision, 1); assert.match(context.items[0]?.content || '', /data.text/);
    assert.equal((await store.read(resource.id)).resource.revision, 2);
    await store.remove(resource.id); await assert.rejects(store.read(resource.id, {}, 1), /removed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
