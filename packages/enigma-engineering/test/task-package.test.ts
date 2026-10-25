import assert from 'node:assert/strict';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { TaskPackages } from '../src/task-package.js';
import { ProjectContext } from '../src/project-context.js';
import { Artifacts } from '../src/artifacts.js';
import { PlanStore } from '../src/planning.js';
import { ServiceManager } from '../src/services.js';
import { BrowserValidation } from '../src/browser-validation.js';
import { RecipeStore } from '../src/recipes.js';
import { MemoryStore } from '../src/memory.js';
import { inspectHandoff } from '../src/handoff.js';
import { hash, readJson, writeJson } from '../src/storage.js';

test('portable package reproduces a failing three-repo task, then verifies the fixed code/browser without activating source success or private memory', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), project = new ProjectContext(workspace), targetRoot = join(root, 'restored');
  let target: Awaited<ReturnType<typeof TaskPackages.restore>> | undefined;
  try {
    await writeFile(join(root, 'library', 'DESIGN.md'), '接口升级为 v2，并保持三仓库调用。');
    await writeFile(join(root, 'app', 'web.mjs'), 'import{createServer}from"node:http";import{main}from"./index.js";const server=createServer((q,r)=>r.end(`<button id="go" onclick="document.querySelector(\'#out\').textContent=\'${main()}\'">Run</button><div id="out"></div>`));server.listen(0,"127.0.0.1",()=>console.log("READY: "+server.address().port));');
    const resource = await project.add({ title: '接口设计', task: 'source-task', source: { kind: 'file', repo: 'library', file: 'DESIGN.md' } });
    const imported = await project.add({ title: '远端说明', source: { kind: 'imported', uri: 'https://example.com/api' }, content: 'Import remains a versioned reference.' });
    const artifact = await new Artifacts(workspace).add({ title: '原设计', kind: 'document', repo: 'library', file: 'DESIGN.md', task: 'source-task' });
    const memory = await (await MemoryStore.open(workspace)).save({ kind: 'decision', scope: { type: 'project' }, title: '接口经验', content: 'Read all consumers before migration.', sources: [{ repo: 'library', file: 'index.js' }], origin: { kind: 'source', reference: 'actual source inspection' } });
    await workspace.exclusive(() => workspace.addCheck({ id: 'joint', repo: 'app', joint: true, argv: [process.execPath, '-e', "import('./index.js').then(m=>{if(m.main()!=='v2')process.exit(1);console.log(m.main())})"] }));
    await new ServiceManager(workspace).add({ id: 'web', repo: 'app', label: 'Repro web', argv: [process.execPath, join(root, 'app', 'web.mjs')], portPrefix: 'READY: ', readiness: { type: 'http', includes: 'button' } });
    await new BrowserValidation(workspace).add({ id: 'click', label: 'v2 click', service: 'web', steps: [{ action: 'click', selector: '#go' }, { action: 'expect', selector: '#out', includes: 'v2' }] });
    await new RecipeStore(workspace).save({ id: 'accept', label: 'Check existing behavior', steps: [{ id: 'verify', kind: 'verify' }] });
    const plan = await new PlanStore(workspace).create({ goal: '三仓库 v2 接口升级', steps: [{ id: 'migration', repo: 'app', goal: '联合结果 v2', checks: ['joint'] }] });
    const failed = await workspace.exclusive(() => workspace.verify()); assert.equal(failed.status, 'failed');
    const packaged = await new TaskPackages(workspace).export({ goal: plan.goal, source: { agent: 'operator' }, notes: [{ role: 'user', kind: 'requirement', reference: 'original-request', text: '联合结果必须为 v2。' }], task: 'source-task', resources: [resource.id, imported.id], artifacts: [artifact.id], memories: [memory.id], evidence: [failed.evidence] });
    await (await MemoryStore.open(workspace)).forget(memory.id);
    const inactive = await TaskPackages.restore(packaged.directory, join(root, 'inactive'));
    assert(inactive.workspace.config.repos.every(repo => repo.access === 'read')); assert.equal(inactive.workspace.config.checks.length, 0); assert.equal((await new RecipeStore(inactive.workspace).list()).length, 0);
    const pi = await TaskPackages.restore(packaged.directory, join(root, 'pi-restored'), { preparePi: true }); assert(pi.piSession);
    const privateResource = pi.resources.find(item => item.source === resource.id)!;
    assert((await new ProjectContext(pi.workspace).read(privateResource.target!, { task: pi.piSession.sessionId })).content.includes('v2'));
    await assert.rejects(new ProjectContext(pi.workspace).read(privateResource.target!, { task: 'different-session' }), /another task/);
    assert.equal((await readJson<{ sessionId: string }>(join(pi.workspace.data, 'session-start.json'))).sessionId, pi.piSession.sessionId);
    target = await TaskPackages.restore(packaged.directory, targetRoot, { writeRepos: ['library', 'sdk', 'app'], activateRuntime: true, task: 'target-task' });
    assert.equal((await new ServiceManager(target.workspace).status('web')).service.argv[1], join(target.workspace.repo('app').root, 'web.mjs'));
    const checks = await target.workspace.exclusive(() => target!.workspace.verify()); assert.equal(checks.status, 'failed');
    assert.equal((await new PlanStore(target.workspace).view())?.completed, 0); await assert.rejects(target.workspace.evidenceStatus(failed.evidence), /ENOENT/);
    const copied = target.resources.find(item => item.source === resource.id)!;
    await assert.rejects(new ProjectContext(target.workspace).read(copied.target!), /another task/);
    assert((await new ProjectContext(target.workspace).read(copied.target!, { task: 'target-task' })).content.includes('v2'));
    assert.equal((await new ProjectContext(target.workspace).read(target.resources.find(item => item.source === imported.id)!.target!)).current, null);
    const historical = await new Artifacts(target.workspace).list('target-task'); assert.equal(historical.length, 1); assert.equal(historical[0]?.sourceCurrent, false); assert.deepEqual(historical[0]?.evidence, []);
    assert.equal((await (await MemoryStore.open(target.workspace)).search('接口')).items.length, 0);
    assert((await inspectHandoff(target.workspace, target.handoff)).safeToContinue);
    await target.workspace.exclusive(() => target!.workspace.mutate('library', 'write', () => writeFile(join(target!.workspace.repo('library').root, 'index.js'), 'export function greet(){return "v2"}\n')));
    const passed = await target.workspace.exclusive(() => target!.workspace.verify()); assert.equal(passed.status, 'verified');
    const service = await new ServiceManager(target.workspace).start('web'); assert(service.ready);
    const browser = await new BrowserValidation(target.workspace).run('click'); assert.equal(browser.status, 'passed', JSON.stringify(browser));
    await new ServiceManager(target.workspace).stop('web');
    assert.equal(await readFile(join(root, 'library', 'index.js'), 'utf8'), 'export function greet() { return "v1"; }\n');
    assert.equal((await new RecipeStore(target.workspace).run('accept', {})).status, 'passed');
    const origin = await readJson<{ source: string; runtimeActivated: boolean }>(join(target.workspace.data, 'package-origin.json')); assert.equal(origin.source, packaged.manifest.id); assert(origin.runtimeActivated);
  } finally { if (target) await new ServiceManager(target.workspace).stop('web').catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('package rejects corrupt bytes and path traversal before target mutation, and omits stale active materials', async () => {
  const { root, workspace } = await fixture(), project = new ProjectContext(workspace);
  try {
    await writeFile(join(root, 'library', 'design.md'), 'old'); const resource = await project.add({ title: 'old design', source: { kind: 'file', repo: 'library', file: 'design.md' } }); await writeFile(join(root, 'library', 'design.md'), 'new');
    const exported = await new TaskPackages(workspace).export({ goal: 'Source remains usable', source: { agent: 'operator' }, notes: [], resources: [resource.id] });
    const restored = await TaskPackages.restore(exported.directory, join(root, 'restored')); assert(restored.resources[0]?.skipped);
    const key = Object.keys(exported.manifest.blobs)[0]!, original = await readFile(join(exported.directory, 'blobs', key)); await writeFile(join(exported.directory, 'blobs', key), 'corrupt');
    await assert.rejects(TaskPackages.restore(exported.directory, join(root, 'bad')), /integrity/); await assert.rejects(access(join(root, 'bad')), /ENOENT/);
    await writeFile(join(exported.directory, 'blobs', key), original);
    const envelope = await readJson<{ manifest: typeof exported.manifest; hash: string }>(join(exported.directory, 'manifest.json')); envelope.manifest.repos[0]!.files['../escape.txt'] = Object.values(envelope.manifest.repos[0]!.files)[0]!; envelope.hash = hash(JSON.stringify(envelope.manifest)); await writeJson(join(exported.directory, 'manifest.json'), envelope);
    await assert.rejects(TaskPackages.inspect(exported.directory), /file path/);
    const secret = 'package-test-secret-value'; workspace.secrets.push(secret); await writeFile(join(root, 'library', 'inline-secret.txt'), secret);
    await assert.rejects(new TaskPackages(workspace).export({ goal: 'No credentials', source: { agent: 'operator' }, notes: [] }), /credential/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a portable check targeting the source workspace is relocated to the restored workspace', async () => {
  const { root, workspace } = await fixture();
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'inventory', repo: 'library', argv: [process.execPath, resolve('dist/src/cli.js'), '--workspace', root, 'repos', 'list'] }));
    const packaged = await new TaskPackages(workspace).export({ goal: 'Reproduce target inventory', source: { agent: 'operator' }, notes: [] });
    const target = await TaskPackages.restore(packaged.directory, join(root, 'restored'), { activateRuntime: true });
    assert.equal(target.workspace.config.checks[0]?.argv[3], target.workspace.root);
    const verified = await target.workspace.exclusive(() => target.workspace.verify()); assert.equal(verified.status, 'verified');
    const inventory = JSON.parse((verified.results[0] as { output: string }).output) as { repos: { root: string }[] }; assert(inventory.repos.every(repo => repo.root.startsWith(target.workspace.root)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
