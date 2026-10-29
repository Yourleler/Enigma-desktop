import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { traceCode, repoGraph } from '../src/reading.js';
import { fixture } from './fixtures.js';

test('outgoing calls use bound implementations and do not invent targets for callbacks or nested functions', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root,'app','index.js'),'import { call as upstream } from "../sdk/index.js";\nexport function main(callback) {\n function unused() { return upstream(); }\n callback();\n return upstream();\n}\n');
    const reading=await traceCode(workspace,'main',{repo:'app'});
    const outgoing=reading.references.filter(ref=>ref.kind==='outgoing-call');
    assert.equal(outgoing.length,1);
    assert.equal(outgoing[0]?.line,5);assert.equal(outgoing[0]?.target?.repo,'sdk');
    assert(reading.diagnostics?.some(text=>text.includes('callback')));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('AST reading follows aliases and excludes comments and strings from confirmed references', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'sdk', 'index.js'), 'import { greet as say } from "../library/index.js";\n// greet is mentioned here\nconst note = "greet";\nexport function call() { return say(); }\n');
    const reading = await traceCode(workspace, 'greet');
    assert(reading.references.some(x => x.repo === 'sdk' && x.symbol === 'say' && x.kind === 'call-site'));
    assert(!reading.references.some(x => x.repo === 'sdk' && [2, 3].includes(x.line)));
    assert(reading.references.some(x => x.confidence === 'confirmed' && x.kind === 'call-site' && x.target?.repo === 'library'));
    assert(reading.followQueries.includes('call'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ambiguous package identity stays unresolved, and cyclic dependencies have no false work order', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'package.json'), '{"name":"same"}');
    await writeFile(join(root, 'app', 'package.json'), '{"name":"same"}');
    await writeFile(join(root, 'sdk', 'index.js'), 'import { greet } from "same";\nexport const value = greet();\n');
    const reading = await traceCode(workspace, 'greet');
    assert(reading.imports.some(x => x.module === 'same' && x.confidence === 'unresolved'));
    await workspace.exclusive(async () => {
      await workspace.setDependencies('app', ['sdk']);
      await workspace.setDependencies('sdk', ['app']);
    });
    const graph = await repoGraph(workspace);
    assert.deepEqual(graph.order, ['library']);
    assert.deepEqual(graph.cycles, ['app', 'sdk']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
