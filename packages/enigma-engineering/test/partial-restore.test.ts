import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';

for (const changeAppliedFile of [false, true]) test(`a partially applied restore ${changeAppliedFile ? 'retains unknown compensation and blocks replay' : 'compensates its own effects while preserving a concurrent user edit'}`, async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'a.txt'), 'target-a');
    await writeFile(join(root, 'library', 'b.txt'), 'target-b');
    const target = await workspace.exclusive(() => workspace.checkpoint('target'));
    await writeFile(join(root, 'library', 'a.txt'), 'current-a');
    await writeFile(join(root, 'library', 'b.txt'), 'current-b');
    const expected = await workspace.exclusive(() => workspace.checkpoint('expected'));
    const path = workspace.path.bind(workspace); let writesToB = 0;
    workspace.path = async (repo, file, access) => {
      const result = await path(repo, file, access);
      if (repo === 'library' && file === 'b.txt' && access === 'write' && ++writesToB === 2) {
        // This runs after the first file was restored, immediately before the second apply.
        await writeFile(join(root, 'library', changeAppliedFile ? 'a.txt' : 'b.txt'), 'concurrent-user-change');
        throw new Error('Injected failure after an external edit, before second file write');
      }
      return result;
    };
    await assert.rejects(workspace.exclusive(() => workspace.restore(target.id, expected.id)), /Restore failed/);
    workspace.path = path;
    const operation = (await workspace.operations()).find(record => record.id.startsWith('restore')); assert(operation);
    if (changeAppliedFile) {
      assert.equal(operation.status, 'unknown');
      assert.equal(await readFile(join(root, 'library', 'a.txt'), 'utf8'), 'concurrent-user-change');
      await assert.rejects(workspace.exclusive(() => workspace.mutate('sdk', 'write', () => writeFile(join(root, 'sdk', 'blocked.txt'), 'must not happen'))), /Unknown operation/);
      await assert.rejects(readFile(join(root, 'sdk', 'blocked.txt')), /ENOENT/);
    } else {
      assert.equal(operation.status, 'rolled-back');
      assert.equal(await readFile(join(root, 'library', 'a.txt'), 'utf8'), 'current-a');
      assert.equal(await readFile(join(root, 'library', 'b.txt'), 'utf8'), 'concurrent-user-change');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
