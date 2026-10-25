import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readJson, writeJson } from '../src/storage.js';

test('a state publisher and concurrent readers only observe complete atomic revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-publication-')), file = join(root, 'state.json');
  let finished = false, reads = 0;
  try {
    await writeJson(file, { revision: 0, content: 'initial' });
    const reader = (async () => { while (!finished) { const state = await readJson<{ revision: number; content: string }>(file); assert(Number.isInteger(state.revision)); assert.equal(state.content, state.revision ? String(state.revision).repeat(3000) : 'initial'); reads++; } })();
    try { for (let revision = 1; revision <= 60; revision++) await writeJson(file, { revision, content: String(revision).repeat(3000) }); }
    finally { finished = true; await reader; }
    assert(reads > 0); assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 60);
  } finally { await rm(root, { recursive: true, force: true }); }
});
