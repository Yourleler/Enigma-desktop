import assert from 'node:assert/strict';
import { writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { ReadingStore } from '../src/reading-store.js';
import { readJson, writeJson } from '../src/storage.js';
test('published source map expands to actual code and remains readable after a failed refresh', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = new ReadingStore(workspace);
    const published = await workspace.exclusive(() => store.update('greet'));
    const node = published.map?.nodes.find(node => node.source.repo === 'library'); assert(node);
    const opened = await store.open('greet', { node: node.id }); assert('matchesPublishedSource' in opened); assert.equal(opened.matchesPublishedSource, true);
    await writeFile(join(root, 'library', 'index.js'), 'export function greet(){ return "changed";}\n');
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(workspace.exclusive(() => store.update('greet', { signal: cancelled.signal })), /cancelled/);
    const old = await store.open('greet'); assert('reading' in old); assert.equal(old.evidence, published.evidence); assert.equal(old.current, false); assert.equal(old.state.status, 'cancelled');
    const changed = await store.open('greet', { node: node.id }); assert('matchesPublishedSource' in changed); assert.equal(changed.matchesPublishedSource, false);
    assert(changed.source.snippet.includes('changed'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a persisted result from an older reader is reanalyzed even when source files are unchanged', async () => {
  const { root, workspace } = await fixture();
  try {
    const store = new ReadingStore(workspace), first = await workspace.exclusive(() => store.update('greet'));
    const directory = (await readdir(join(workspace.data, 'readings')))[0]!;
    const path = join(workspace.data, 'readings', directory, 'current.json');
    const saved = await readJson<Record<string, unknown>>(path); saved.reader = 'previous-reader-version'; await writeJson(path, saved);
    const inspected = await store.open('greet'); assert.equal(inspected.current, false); assert.equal(inspected.readerCurrent, false);
    const refreshed = await workspace.exclusive(() => store.update('greet')); assert.notEqual(refreshed.evidence, first.evidence);
    assert.equal((await store.open('greet')).current, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
