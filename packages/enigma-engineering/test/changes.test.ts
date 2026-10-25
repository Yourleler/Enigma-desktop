import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { observeChanges } from '../src/changes.js';
import { fixture } from './fixtures.js';
import { runProcess } from '../src/process.js';
import { storePath, writeJson } from '../src/storage.js';

test('command observations cover every registered repo and separate later external edits', async () => {
  const { root, workspace } = await fixture();
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('before command'));
    const command = `require('fs').writeFileSync('../library/command.txt','upstream');require('fs').writeFileSync('../sdk/command.txt','consumer');`;
    await workspace.exclusive(() => workspace.mutate('app', 'command', () => runProcess([process.execPath, '-e', command], workspace.repo('app').root)));
    let report = await workspace.exclusive(() => observeChanges(workspace, baseline.id));
    assert.equal(report.changes.length, 2);
    assert(report.changes.every(change => change.source === 'observed-managed'));
    const record = (await workspace.operations())[0]!;
    assert.equal(record.beforeWorkspace?.length, 3);
    assert.equal(record.afterWorkspace?.length, 3);
    await writeFile(join(root, 'sdk', 'command.txt'), 'later user edit');
    await writeFile(join(root, 'library', 'external.txt'), 'external');
    report = await workspace.exclusive(() => observeChanges(workspace, baseline.id));
    assert.equal(report.changes.find(change => change.repo === 'sdk')?.source, 'external-or-untracked');
    assert.equal(report.changes.find(change => change.file === 'external.txt')?.source, 'external-or-untracked');
    assert(report.limitation.includes('not exact authorship'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an unknown workspace command blocks unrelated repository writes until actual effects are acknowledged', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeJson(storePath(workspace.data, 'operations', 'unknown-command'), { schema: 1, id: 'unknown-command', repo: 'app', scope: 'workspace', status: 'unknown' });
    let ran = false;
    await assert.rejects(workspace.exclusive(() => workspace.mutate('library', 'write', async () => { ran = true; })), /Unknown operation/);
    assert.equal(ran, false);
    await workspace.exclusive(() => workspace.acknowledgeOperation('unknown-command', 'Inspected all registered repos; no source effect to replay.'));
    await workspace.exclusive(() => workspace.mutate('library', 'write', async () => { ran = true; }));
    assert.equal(ran, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
