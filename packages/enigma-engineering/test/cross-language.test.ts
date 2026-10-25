import {rm,writeFile} from 'node:fs/promises';
import {crossLanguageFixture,actualGreeting} from './cross-language-fixtures.js';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { discoverContracts } from '../src/contracts.js';
import { repoGraph, traceCode } from '../src/reading.js';

test('Python AST aliases, route facts and TS fetch connect a real three-repo HTTP task', async () => {
  const { root, workspace } = await crossLanguageFixture();
  try {
    const reading = await traceCode(workspace, 'greet', { repo: 'server' });
    assert(reading.symbols.some(symbol => symbol.file === 'model.py' && symbol.symbol === 'greet'), JSON.stringify(reading));
    assert(reading.references.some(reference => reference.file === 'server.py' && reference.symbol === 'build_message' && reference.target?.file === 'model.py' && reference.confidence === 'confirmed'));
    const contract = await workspace.exclusive(() => discoverContracts(workspace));
    assert(contract.candidates.some(candidate => candidate.producer.repo === 'server' && candidate.consumer.repo === 'sdk' && candidate.id === 'GET /greet'));
    assert(contract.candidates.every(candidate => candidate.confidence === 'candidate'));
    assert.equal(contract.declared[0]?.id, 'greeting');
    const evidence = await workspace.exclusive(() => workspace.evidence('reading', contract));
    assert((await workspace.evidenceStatus(evidence.id)).valid);
    const graph = await repoGraph(workspace);
    assert.deepEqual(graph.order, ['server', 'sdk', 'app']); assert.deepEqual(graph.affectedBy.server, ['app', 'sdk']);
    assert.equal(await actualGreeting(root), 'v1');
    await workspace.exclusive(async () => {
      await workspace.mutate('server', 'write', () => writeFile(join(root, 'server', 'model.py'), 'def greet():\n    return {"data": {"message": "v2"}}\n'));
      await workspace.mutate('sdk', 'write', () => writeFile(join(root, 'sdk', 'index.js'), 'export async function getGreeting(baseURL){const response=await fetch(baseURL + "/greet");return (await response.json()).data.message;}\n'));
      await workspace.mutate('app', 'write', () => writeFile(join(root, 'app', 'index.js'), 'import {getGreeting} from "../sdk/index.js";\nexport async function display(baseURL){return "app:" + await getGreeting(baseURL);}\n'));
    });
    assert.equal(await actualGreeting(root), 'app:v2');
    assert.equal((await workspace.evidenceStatus(evidence.id)).valid, false);
    assert((await traceCode(workspace, 'greet')).supportedLanguages.includes('Python'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Python candidate references do not confirm a shadowed imported function or execute repository side effects', async () => {
  const { root, workspace } = await crossLanguageFixture();
  try {
    await writeFile(join(root, 'server', 'shadow.py'), 'from model import greet\ndef other(greet):\n    return greet()\nraise RuntimeError("repository code must never be executed")\n');
    const result = await traceCode(workspace, 'greet', { repo: 'server' });
    assert(!result.references.some(reference => reference.file === 'shadow.py' && reference.line === 3));
    assert.equal(result.diagnostics?.length, 0, JSON.stringify(result.diagnostics));
    await writeFile(join(root, 'server', 'broken.py'), 'def syntax broken\n');
    const broken = await traceCode(workspace, 'greet');
    assert(broken.diagnostics?.some(diagnostic => diagnostic.includes('SyntaxError')));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(traceCode(workspace, 'greet', { signal: controller.signal }), /cancelled/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
