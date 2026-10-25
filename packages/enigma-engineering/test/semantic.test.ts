import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { traceCode } from '../src/reading.js';
import { fixture } from './fixtures.js';
import { analyzeTypescript } from '../src/typescript-reader.js';

test('portable source selection retains a late changed symbol when ripgrep is unavailable', async () => {
  const { root, workspace } = await fixture();
  try {
    await mkdir(join(root, 'app', 'many'));
    for (let number = 0; number < 180; number++) await writeFile(join(root, 'app', 'many', `file-${number}.ts`), `export const value${number}=1;\n`);
    const target = join(root, 'app', 'many', 'zzz-target.ts');
    await writeFile(target, 'export function needleLate() { return 1; }\n');
    const first = await analyzeTypescript(workspace, 'needleLate', { maxFiles: 3, rg: join(root, 'no-ripgrep') });
    assert(first.symbols.some(symbol => symbol.file === 'many/zzz-target.ts' && symbol.snippet.includes('return 1')));
    await writeFile(target, 'export function needleLate() { return 2; }\n');
    const second = await analyzeTypescript(workspace, 'needleLate', { maxFiles: 3, rg: join(root, 'no-ripgrep') });
    assert(second.symbols.some(symbol => symbol.snippet.includes('return 2')));
    assert(second.truncated); assert.equal(second.scannedFiles, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bounded TypeScript reading expands a re-export dependency before unrelated large-repo files', async () => {
  const { root, workspace } = await fixture();
  try {
    await mkdir(join(root, 'library', 'aaa'));
    await mkdir(join(root, 'library', 'zzz'));
    for (let number = 0; number < 180; number++) await writeFile(join(root, 'library', 'aaa', `${number}.ts`), `export const value${number}=1;\n`);
    await writeFile(join(root, 'library', 'zzz', 'core.ts'), 'export function target() { return "late"; }\n');
    await writeFile(join(root, 'sdk', 'index.js'), 'export { target as invoke } from "../library/zzz/core.ts";\n');
    await writeFile(join(root, 'app', 'index.js'), 'import {invoke} from "../sdk/index.js";\nexport function main() { return invoke(); }\n');
    const reading = await traceCode(workspace, 'invoke', { repo: 'sdk', maxFiles: 3 });
    assert(reading.symbols.some(symbol => symbol.repo === 'library' && symbol.file === 'zzz/core.ts'), JSON.stringify(reading));
    assert(reading.references.some(reference => reference.repo === 'app' && reference.target?.file === 'zzz/core.ts'));
    assert.equal(reading.scannedFiles, 3); assert(reading.truncated);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('TypeScript checker resolves tsconfig paths and re-exports without binding a shadowed call to the upstream function', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'sdk', 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@library/*': ['../library/*'] } } }));
    await writeFile(join(root, 'sdk', 'index.js'), 'export { greet as invoke } from "@library/index.js";\n');
    await writeFile(join(root, 'app', 'index.js'), 'import { invoke } from "../sdk/index.js";\nexport function main() { return invoke(); }\nfunction isolated(greet) { return greet(); }\n');
    const reading = await traceCode(workspace, 'greet', { repo: 'library' });
    assert(reading.references.some(reference => reference.repo === 'app' && reference.symbol === 'invoke' && reference.target?.repo === 'library' && reference.kind === 'call-site'), JSON.stringify(reading));
    assert(!reading.references.some(reference => reference.repo === 'app' && reference.line === 3));
    assert(reading.map?.edges.some(edge => edge.kind === 'call-site' && edge.confidence === 'confirmed'));
    assert(reading.diagnostics?.length === 0, JSON.stringify(reading.diagnostics));
    assert(reading.limitation?.includes('runtime'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('incremental reading reparses changed source and invalidates prior evidence', async () => {
  const { root, workspace } = await fixture();
  try {
    const first = await workspace.exclusive(async () => { const result = await traceCode(workspace, 'greet'); return await workspace.evidence('reading', result); });
    const unchanged = await traceCode(workspace, 'greet');
    assert.equal(unchanged.incremental?.reparsed, 0);
    assert((unchanged.incremental?.reused ?? 0) >= 3);
    await writeFile(join(root, 'library', 'index.js'), 'export function greet() { return "new"; }\n');
    const changed = await traceCode(workspace, 'greet');
    assert.equal(changed.incremental?.reparsed, 1);
    assert.equal((await workspace.evidenceStatus(first.id)).valid, false);
    assert(changed.symbols.some(symbol => symbol.snippet.includes('new')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('registered-source reader reports unresolved config and budgets without loading outside dependencies', async () => {
  const { root, workspace } = await fixture();
  try {
    await mkdir(join(root, 'library', 'src'));
    await writeFile(join(root, 'library', 'tsconfig.json'), '{"extends":"../../unregistered/tsconfig.json"}');
    await writeFile(join(root, 'library', 'src', 'same.ts'), 'export const unrelated = 1;\n');
    const result = await traceCode(workspace, 'greet', { maxFiles: 1 });
    assert.equal(result.truncated, true);
    assert(result.diagnostics?.some(diagnostic => diagnostic.includes('Unresolved tsconfig')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
