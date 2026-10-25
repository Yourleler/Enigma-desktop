import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { PlanStore } from '../src/planning.js';
import { compareSolutions, previewRestore } from '../src/solutions.js';

test('solution checkpoints bind immutable task revisions and restore the associated plan while retaining later history', async () => {
  const { root, workspace } = await fixture(); const plans = new PlanStore(workspace);
  try {
    const plan = await plans.create({ goal: 'Alternative solution', steps: [{ id: 'upstream', repo: 'library', goal: 'Inspect', checks: [] }] });
    const a = await workspace.exclusive(() => workspace.checkpoint('solution a'));
    await plans.advance('upstream', plan.revision, { phase: 'running' });
    await workspace.exclusive(() => workspace.mutate('library', 'write', () => writeFile(join(root, 'library', 'alternative.txt'), 'alternative')));
    const b = await workspace.exclusive(() => workspace.checkpoint('solution b'));
    const compared = await workspace.exclusive(() => compareSolutions(workspace, a.id, b.id));
    assert.equal(compared.left.plan?.plan.revision, 1);
    assert.equal(compared.right.plan?.plan.revision, 2);
    assert.deepEqual(compared.affected, ['app', 'library', 'sdk']);
    assert.equal((await workspace.exclusive(() => previewRestore(workspace, a.id, b.id))).applyAllowed, true);
    await workspace.exclusive(() => workspace.restore(a.id, b.id));
    assert.equal((await plans.current())?.revision, 1);
    assert.equal((await plans.load(plan.id, 2)).steps[0]?.phase, 'running');
    await assert.rejects(readFile(join(root, 'library', 'alternative.txt')), /ENOENT/);
    await writeFile(join(root, 'sdk', 'user.txt'), 'external');
    const preview = await workspace.exclusive(() => previewRestore(workspace, b.id, a.id));
    assert.equal(preview.applyAllowed, false);
    assert(preview.conflicts.some(conflict => conflict.includes('external edits')));
    await assert.rejects(workspace.exclusive(() => workspace.restore(b.id, a.id)), /External edits/);
    assert.equal(await readFile(join(root, 'sdk', 'user.txt'), 'utf8'), 'external');
  } finally { await rm(root, { recursive: true, force: true }); }
});
