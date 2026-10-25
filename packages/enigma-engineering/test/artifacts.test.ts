import assert from 'node:assert/strict';
import { rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { Artifacts } from '../src/artifacts.js';

test('versioned task artifacts retain actual bytes while source changes and wrong task access remain explicit', async () => {
  const { root, workspace } = await fixture(), artifacts = new Artifacts(workspace);
  try {
    await writeFile(join(root, 'sdk', 'design.md'), '# Interface v1\n');
    const record = await artifacts.add({ title: 'Interface', kind: 'document', repo: 'sdk', file: 'design.md', task: 'task-a' });
    const saved = await artifacts.read(record.id, 'task-a'); assert(saved.sourceCurrent); assert.equal(await readFile(saved.path, 'utf8'), '# Interface v1\n');
    await writeFile(join(root, 'sdk', 'design.md'), '# Interface v2\n');
    const historical = await artifacts.read(record.id, 'task-a'); assert.equal(historical.sourceCurrent, false); assert.equal(await readFile(historical.path, 'utf8'), '# Interface v1\n');
    await assert.rejects(artifacts.read(record.id, 'task-b'), /another task/);
    await assert.rejects(artifacts.add({ title: 'Escape', kind: 'report', runtime: '../sdk/design.md' }), /outside/);
    await writeFile(saved.path, 'corrupt'); await assert.rejects(artifacts.read(record.id, 'task-a'), /integrity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
