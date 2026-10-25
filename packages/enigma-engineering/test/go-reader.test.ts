import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { traceCode } from '../src/reading.js';
import { SourceIndex } from '../src/source-index.js';
import { ReadingStore } from '../src/reading-store.js';
import { analyzeGo } from '../src/go-reader.js';
import { repoGraph } from '../src/reading.js';

test('gopls follows a cross-module alias and static calls while keeping a shadowed name separate', { timeout: 90_000 }, async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'go.mod'), 'module example.test/library\n\ngo 1.24\n');
    await writeFile(join(root, 'library', 'greet.go'), 'package library\n\ntype Greeter interface { Greet() string }\ntype Service struct {}\nfunc (Service) Greet() string { return "v1" }\nfunc Greet() string { return "v1" }\n');
    await writeFile(join(root, 'sdk', 'go.mod'), 'module example.test/sdk\n\ngo 1.24\nrequire example.test/library v0.0.0\nreplace example.test/library => ../library\n');
    await writeFile(join(root, 'sdk', 'call.go'), 'package sdk\nimport lib "example.test/library"\nfunc Call() string { return lib.Greet() }\nfunc Local(Greet func() string) string { return Greet() }\n');
    const reading = await traceCode(workspace, 'Greet', { repo: 'library' });
    assert(reading.symbols.some(item => item.repo === 'library' && item.file === 'greet.go'), JSON.stringify(reading.diagnostics));
    assert(reading.references.some(item => item.repo === 'sdk' && item.line === 3 && item.kind === 'call-site'), JSON.stringify(reading));
    assert(!reading.references.some(item => item.repo === 'sdk' && item.line === 4), JSON.stringify(reading));
    const interfaceReading = await traceCode(workspace, 'Greeter', { repo: 'library' });
    assert(interfaceReading.references.some(item => item.kind === 'implementation'), JSON.stringify(interfaceReading));
    assert(reading.limitation?.includes('dynamic'));
    assert((await repoGraph(workspace)).edges.some(edge => edge.from === 'sdk' && edge.to === 'library' && edge.reason.startsWith('go.mod')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelling an active Go language server ends its process without publishing semantic success', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'go.mod'), 'module example.test/library\ngo 1.24\n');
    await writeFile(join(root, 'library', 'greet.go'), 'package library\nfunc Greet() string { return "v1" }\n');
    const controller = new AbortController(); let pid: number | undefined;
    workspace.activity = event => { if (event.kind === 'start' && event.stage === 'reading.go') { pid = event.pid; controller.abort(); } };
    await assert.rejects(analyzeGo(workspace, 'Greet', { maxFiles: 10, signal: controller.signal }), /cancelled/);
    assert(pid); assert.throws(() => process.kill(pid!, 0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source index finds a late file in a large source tree and a published reading survives process cache loss', async () => {
  const { root, workspace } = await fixture();
  try {
    await mkdir(join(root, 'app', 'many'));
    for (let number = 0; number < 180; number++) await writeFile(join(root, 'app', 'many', `file-${number}.ts`), `export const number${number} = ${number};\n`);
    await writeFile(join(root, 'app', 'many', 'zzz-target.ts'), 'export function needleLate() { return 1; }\n');
    const first = await new SourceIndex(workspace).select('needleLate', { maxFiles: 1 });
    assert.equal(first.files[0]?.file, 'many/zzz-target.ts');
    assert(first.truncated);
    const second = await new SourceIndex(workspace).select('needleLate', { maxFiles: 1 });
    assert.equal(second.refreshed, 0); assert(second.reused >= 180);
    const saved = await workspace.exclusive(() => new ReadingStore(workspace).update('needleLate'));
    const reused = await workspace.exclusive(() => new ReadingStore(workspace).update('needleLate'));
    assert.equal(reused.evidence, saved.evidence); assert('reused' in reused && reused.reused);
    await writeFile(join(root, 'app', 'many', 'zzz-target.ts'), 'export function needleLate() { return 2; }\n');
    const changed = await workspace.exclusive(() => new ReadingStore(workspace).update('needleLate'));
    assert.notEqual(changed.evidence, saved.evidence); assert(changed.symbols.some(item => item.snippet.includes('return 2')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
