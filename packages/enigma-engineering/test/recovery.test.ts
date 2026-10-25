import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { configureGateway } from '../src/model-config.js';
import { writeJson } from '../src/storage.js';
import { fixture } from './fixtures.js';

const exec = promisify(execFile);
test('restore to an earlier checkpoint keeps a repository added later', async () => {
  const { root, workspace } = await fixture();
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('three repos'));
    const dir = join(root, 'fourth'); await mkdir(dir); await exec('git', ['init', '-b', 'main'], { cwd: dir });
    await writeFile(join(dir, 'user.txt'), 'new repository user content\n');
    await workspace.exclusive(async () => {
      await workspace.addRepo('fourth', dir);
      await workspace.mutate('library', 'edit', () => writeFile(join(root, 'library', 'index.js'), 'export const version=2;\n'));
    });
    const changed = await workspace.exclusive(() => workspace.checkpoint('four repos'));
    await workspace.exclusive(() => workspace.restore(baseline.id, changed.id));
    assert.equal(workspace.config.repos.length, 4);
    assert.equal(await readFile(join(dir, 'user.txt'), 'utf8'), 'new repository user content\n');
    assert((await readFile(join(root, 'library', 'index.js'), 'utf8')).includes('v1'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unfinished operations block repeat mutations until observed effects are explicitly acknowledged', async () => {
  const { root, workspace } = await fixture();
  try {
    const before = await workspace.snapshotRepo('library');
    const file = join(root, 'library', 'index.js');
    await writeFile(file, 'export const uncertain = true;\n');
    await writeJson(join(workspace.data, 'operations', 'operation-interrupted.json'), { schema: 1, id: 'operation-interrupted', repo: 'library', status: 'pending', before });
    await workspace.recover();
    assert.equal((await workspace.operations())[0]?.status, 'unknown');
    let dispatched = false;
    await assert.rejects(workspace.exclusive(() => workspace.mutate('library', 'retry', async () => { dispatched = true; })), /Unknown operation effects/);
    assert.equal(dispatched, false);
    assert.equal(await readFile(file, 'utf8'), 'export const uncertain = true;\n');
    await workspace.exclusive(() => workspace.acknowledgeOperation('operation-interrupted', 'Inspected current file: uncertain=true was written; do not replay.'));
    await workspace.exclusive(() => workspace.mutate('library', 'continue', async () => { dispatched = true; }));
    assert.equal(dispatched, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('recovery cannot take a lock from a still-running owner', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeJson(join(workspace.data, 'operation.lock'), { pid: process.pid });
    await assert.rejects(workspace.recover(), /still active/);
    assert.equal(JSON.parse(await readFile(join(workspace.data, 'operation.lock'), 'utf8')).pid, process.pid);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a killed writer recovers as unknown without replaying its file effect', async () => {
  const { root, workspace } = await fixture();
  const moduleUrl = new URL('../src/workspace.js', import.meta.url).href;
  const script = `const {Workspace}=await import(${JSON.stringify(moduleUrl)});const {writeFile}=await import('node:fs/promises');`
    + `const w=await Workspace.open(${JSON.stringify(root)});await w.exclusive(()=>w.mutate('library','crash-test',async()=>{`
    + `await writeFile(${JSON.stringify(join(root, 'library', 'index.js'))},'export const interrupted=true;\\n');`
    + `await writeFile(${JSON.stringify(join(root, 'started'))},'started');setInterval(()=>{},1000);await new Promise(()=>{});}));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
  const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()); });
  try {
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await readFile(join(root, 'started')); started = true; break; } catch { await delay(20); }
    }
    assert(started, 'the interrupted operation must have written its real effect');
    child.kill('SIGKILL'); await exited;
    const recovered = await workspace.recover();
    assert.equal(recovered.pending.length, 1);
    assert.equal(recovered.pending[0]?.status, 'unknown');
    assert((await readFile(join(root, 'library', 'index.js'), 'utf8')).includes('interrupted=true'));
    let retried = false;
    await assert.rejects(workspace.exclusive(() => workspace.mutate('library', 'blind retry', async () => { retried = true; })), /Unknown operation effects/);
    assert.equal(retried, false);
    await workspace.exclusive(() => workspace.acknowledgeOperation(recovered.pending[0]!.id, 'Observed the completed file write; do not replay it.'));
    await workspace.exclusive(() => workspace.checkpoint('recovered actual state'));
  } finally { child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }); }
});

test('Gateway setup preserves other providers and configures Responses without any real secret', async () => {
  const { root, workspace } = await fixture();
  try {
    const dir = join(workspace.data, 'pi-agent'); await mkdir(dir);
    await writeJson(join(dir, 'models.json'), { providers: { local: { models: [{ id: 'existing' }] } } });
    await configureGateway(workspace.data);
    const models = JSON.parse(await readFile(join(dir, 'models.json'), 'utf8'));
    assert.equal(models.providers.gateway.api, 'openai-responses');
    assert.equal(models.providers.local.models[0].id, 'existing');
    assert.equal(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).defaultModel, 'gateway-gpt-6-1-sol');
    await assert.rejects(configureGateway(workspace.data, { baseUrl: 'http://user:password@example.test/v1' }), /without embedded credentials/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('code fork restores a prior Git revision in independent worktrees with the original dirty code intact', async () => {
  const { root, workspace } = await fixture();
  const branch = join(root, 'alternative');
  try {
    for (const repo of workspace.config.repos) {
      await exec('git', ['add', '--', '.'], { cwd: repo.root });
      await exec('git', ['-c', 'user.name=Enigma Test', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture baseline'], { cwd: repo.root });
    }
    const baseline = await workspace.exclusive(() => workspace.checkpoint('committed baseline'));
    const file = join(root, 'library', 'index.js');
    await exec('git', ['checkout', '-b', 'later'], { cwd: join(root, 'library') });
    await writeFile(file, 'export const committedLater=true;\n');
    await exec('git', ['add', '--', 'index.js'], { cwd: join(root, 'library') });
    await exec('git', ['-c', 'user.name=Enigma Test', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture later revision'], { cwd: join(root, 'library') });
    await writeFile(file, 'export const currentUserWork=true;\n');
    const originalIndex = await readFile(join(root, 'library', '.git', 'index'));
    const fork = await workspace.exclusive(() => workspace.forkCheckpoint(baseline.id, branch));
    assert.equal(await readFile(file, 'utf8'), 'export const currentUserWork=true;\n');
    assert.deepEqual(await readFile(join(root, 'library', '.git', 'index')), originalIndex);
    assert((await readFile(join(fork.repo('library').root, 'index.js'), 'utf8')).includes('v1'));
    assert.equal(fork.config.repos.length, 3);
    const output = await exec(process.execPath, ['--input-type=module', '-e', 'const {main}=await import("./index.js");if(main()!=="v1")process.exit(1)'], { cwd: fork.repo('app').root });
    assert.equal(output.stderr, '');
    assert.equal((await fork.checkpoints()).length, 1);
    await assert.rejects(workspace.exclusive(() => workspace.forkCheckpoint(baseline.id, branch)), /EEXIST/);
  } finally {
    for (const repo of workspace.config.repos) await exec('git', ['worktree', 'prune'], { cwd: repo.root }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
