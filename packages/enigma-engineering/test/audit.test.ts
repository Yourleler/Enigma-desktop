import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { readSource, traceCode } from '../src/reading.js';
import { runProcess } from '../src/process.js';
import { Workspace } from '../src/workspace.js';
import { writeJson } from '../src/storage.js';
import { fixture } from './fixtures.js';

test('a reading result cannot be published as fresh after its source changed', async () => {
  const { root, workspace } = await fixture();
  try {
    const reading = await traceCode(workspace, 'greet');
    await writeFile(join(root, 'library', 'index.js'), 'export const other=1;\n');
    const evidence = await workspace.evidence('reading', reading);
    assert.equal((await workspace.evidenceStatus(evidence.id)).valid, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('changing acceptance commands invalidates previous acceptance evidence', async () => {
  const { root, workspace } = await fixture();
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'first', repo: 'app', argv: [process.execPath, '-e', 'process.exit(0)'] }));
    const checked = await workspace.exclusive(() => workspace.verify());
    assert.equal(checked.status, 'verified');
    const otherProcess = await Workspace.open(root);
    await otherProcess.exclusive(() => otherProcess.addCheck({ id: 'new', repo: 'app', argv: [process.execPath, '-e', 'process.exit(1)'] }));
    assert.equal((await workspace.evidenceStatus(checked.evidence)).valid, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('malformed persisted configuration is rejected again when acquiring a lock', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeJson(join(workspace.data, 'workspace.json'), { schema: 1, repos: workspace.config.repos, checks: [{ id: 'bad', repo: 'app', argv: 'not an argument array' }] });
    let dispatched = false;
    await assert.rejects(workspace.exclusive(async () => { dispatched = true; }), /configuration/);
    assert.equal(dispatched, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an inherited pipe from an escaped descendant cannot defeat a command timeout', { skip: process.platform === 'win32' }, async () => {
  const { root, workspace } = await fixture();
  let pid: number | undefined;
  try {
    const script = 'const c=require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},10000)"],{detached:true,stdio:"inherit"});require("fs").writeFileSync("escaped-pid",String(c.pid));process.exit(0)';
    const execution = await workspace.exclusive(() => workspace.mutate('app', 'escaped child', () => runProcess([process.execPath, '-e', script], workspace.repo('app').root, { timeoutMs: 250 })));
    pid = Number(await readFile(join(workspace.repo('app').root, 'escaped-pid'), 'utf8'));
    assert.equal(execution.status, 'timeout');
    assert.equal(execution.cleanup, 'unknown');
    assert(execution.durationMs < 3000, 'timeout must be bounded even though the descendant escaped its process group');
    assert.equal((await workspace.operations())[0]?.status, 'unknown');
  } finally {
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* Owned child already exited. */ }
    await rm(root, { recursive: true, force: true });
  }
});

test('unresolved operation effects prevent verification command dispatch', async () => {
  const { root, workspace } = await fixture();
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'check', repo: 'app', argv: [process.execPath, '-e', 'require("fs").writeFileSync("dispatched","yes")'] }));
    await writeJson(join(workspace.data, 'operations', 'unknown.json'), { schema: 1, id: 'unknown', repo: 'app', status: 'unknown' });
    await assert.rejects(workspace.exclusive(() => workspace.verify()), /Unknown operation effects/);
    await assert.rejects(readFile(join(root, 'app', 'dispatched')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI preserves command arguments following the option separator', async () => {
  const { root } = await fixture();
  try {
    const result = await runProcess([process.execPath, resolve('dist/src/cli.js'), '--workspace', root, 'checks', 'add', 'arguments', 'app', '--',
      process.execPath, '--help', '--workspace', 'literal'], root);
    assert.equal(result.status, 'passed', result.output);
    assert.deepEqual((await Workspace.open(root)).config.checks[0]?.argv, [process.execPath, '--help', '--workspace', 'literal']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restoring an ignore rule does not delete a preexisting ignored user file', async () => {
  const { root, workspace } = await fixture();
  try {
    const repo = workspace.repo('app').root;
    await writeFile(join(repo, '.gitignore'), 'personal.txt\n');
    await writeFile(join(repo, 'personal.txt'), 'original user data\n');
    const baseline = await workspace.exclusive(() => workspace.checkpoint('ignored user file'));
    await writeFile(join(repo, '.gitignore'), '');
    const candidate = await workspace.exclusive(() => workspace.checkpoint('now visible'));
    await workspace.exclusive(() => workspace.restore(baseline.id, candidate.id));
    assert.equal(await readFile(join(repo, 'personal.txt'), 'utf8'), 'original user data\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a missing package subpath is not promoted to a confirmed source relationship', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'sdk', 'index.js'), 'import { greet } from "library/missing";\nexport const result=greet();\n');
    const result = await traceCode(workspace, 'greet');
    assert(result.imports.some(item => item.module === 'library/missing' && item.confidence === 'unresolved'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime state directories cannot be symlinks to another location', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-state-'));
  const outside = await mkdtemp(join(tmpdir(), 'enigma-outside-'));
  try {
    await symlink(outside, join(root, '.enigma-next'));
    await assert.rejects(Workspace.open(root), /runtime|state|[Ss]ymbolic/);
    await assert.rejects(readFile(join(outside, 'workspace.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('unscoped incomplete restores block mutations rather than losing their affected scope', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeJson(join(workspace.data, 'operations', 'restore-incomplete.json'), { schema: 1, id: 'restore-incomplete', status: 'unknown', operation: 'restore' });
    let wrote = false;
    await assert.rejects(workspace.exclusive(() => workspace.mutate('library', 'retry', async () => { wrote = true; })), /Unknown operation effects/);
    assert.equal(wrote, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupted snapshot content is rejected before creating a code workspace', async () => {
  const { root, workspace } = await fixture();
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('baseline'));
    const digest = baseline.repos[0]!.files['index.js']!.hash;
    await writeFile(join(workspace.data, 'blobs', digest), 'corrupted bytes');
    const destination = join(root, 'corrupt-fork');
    await assert.rejects(workspace.exclusive(() => workspace.forkCheckpoint(baseline.id, destination)), /corrupted/);
    await assert.rejects(readFile(join(destination, '.enigma-next', 'workspace.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source versions use raw byte hashes for UTF-8 BOM files and report invalid ranges', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'index.js'), '\uFEFFexport function greet() { return "BOM"; }\n');
    const reading = await traceCode(workspace, 'greet');
    const evidence = await workspace.evidence('reading', reading);
    assert.equal((await workspace.evidenceStatus(evidence.id)).valid, true);
    await assert.rejects(readSource(workspace, 'library', 'index.js', 1000), /outside/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an unserializable JSON value cannot replace an existing state file', async () => {
  const { root, workspace } = await fixture();
  try {
    const path = join(workspace.data, 'state.json');
    await writeJson(path, { saved: true });
    await assert.rejects(writeJson(path, undefined), /serialized/);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { saved: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed code fork is labelled incomplete and cannot be used as a normal workspace', async () => {
  const { root, workspace } = await fixture();
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('baseline'));
    baseline.repos[0]!.head = 'f'.repeat(40);
    await writeJson(join(workspace.data, 'checkpoints', baseline.id + '.json'), baseline);
    const destination = join(root, 'failed-fork');
    await assert.rejects(workspace.exclusive(() => workspace.forkCheckpoint(baseline.id, destination)), /Incomplete code fork/);
    await assert.rejects(Workspace.open(destination), /incomplete/);
    assert((await workspace.operations()).some(record => record.operation === 'code-fork' && record.status === 'unknown'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
