import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, rm,chmod,stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runProcess } from '../src/process.js';
import { repoGraph, traceCode } from '../src/reading.js';
import { fixture } from './fixtures.js';

test('failed restoration compensates executable-bit changes even when file contents are unchanged',async()=>{
 const {root,workspace}=await fixture();try{
  const modeFile=join(root,'library','a-mode.txt'),later=join(root,'library','z-later.txt');await writeFile(modeFile,'same');await chmod(modeFile,0o644);await writeFile(later,'old');const target=await workspace.checkpoint('old');
  await chmod(modeFile,0o755);await writeFile(later,'new');const expected=await workspace.checkpoint('current'),original=workspace.path.bind(workspace);let calls=0;
  workspace.path=async(repo,file,access)=>{if(repo==='library'&&file==='z-later.txt'&&access==='write'&&++calls===2)throw new Error('injected later write failure');return original(repo,file,access);};
  await assert.rejects(workspace.exclusive(()=>workspace.restore(target.id,expected.id)),/changes rolled back/);assert.equal((await stat(modeFile)).mode&0o777,0o755);assert.equal(await readFile(later,'utf8'),'new');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('an external file-mode change after restore preflight is not overwritten',async()=>{
 const {root,workspace}=await fixture();try{
  const file=join(root,'library','mode.txt');await writeFile(file,'old');await chmod(file,0o644);const target=await workspace.checkpoint('old');await writeFile(file,'new');const expected=await workspace.checkpoint('current'),original=workspace.path.bind(workspace);let changed=false;
  workspace.path=async(repo,name,access)=>{const result=await original(repo,name,access);if(!changed&&repo==='library'&&name==='mode.txt'&&access==='write'){changed=true;await chmod(file,0o755);}return result;};
  await assert.rejects(workspace.exclusive(()=>workspace.restore(target.id,expected.id)),/Concurrent edit/);assert.equal((await stat(file)).mode&0o777,0o755);assert.equal(await readFile(file,'utf8'),'new');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('three repositories: dependency order, source locations, and joint verification', async () => {
  const { root, workspace } = await fixture();
  try {
    const graph = await repoGraph(workspace);
    assert.deepEqual(graph.order, ['library', 'sdk', 'app']);
    assert.deepEqual(graph.edges.map(x => [x.from, x.to]), [['sdk', 'library'], ['app', 'sdk']]);
    assert.deepEqual(graph.affectedBy.library, ['app', 'sdk']);
    assert.deepEqual(graph.affectedBy.sdk, ['app']);
    const reading = await traceCode(workspace, 'greet');
    assert(reading.symbols.some(x => x.repo === 'library' && x.file === 'index.js' && x.line === 1));
    assert(reading.references.some(x => x.repo === 'sdk'));
    assert(reading.imports.some(x => x.repo === 'sdk' && x.target === 'library:index.js' && x.confidence === 'confirmed'));
    assert(reading.followQueries.includes('call'));
    const caller = await traceCode(workspace, 'call');
    assert(caller.references.some(x => x.repo === 'app'));
    const evidence = await workspace.evidence('reading', reading);
    assert.equal((await workspace.evidenceStatus(evidence.id)).valid, true);
    await workspace.exclusive(async () => {
      for (const repo of workspace.config.repos) await workspace.addCheck({ id: `${repo.id}-syntax`, repo: repo.id, argv: [process.execPath, '--check', 'index.js'] });
      await workspace.addCheck({ id: 'joint', repo: 'app', joint: true, argv: [process.execPath, '-e',
        'import("./index.js").then(({show})=>{if(show()!=="v2 user")process.exit(2)}).catch(()=>process.exit(3))'] });
    });
    const failed = await workspace.exclusive(() => workspace.verify()); assert.equal(failed.status, 'failed');
    await workspace.exclusive(async () => {
      for (const repo of workspace.config.repos) await workspace.mutate(repo.id, 'upgrade', async () => {
        const path = await workspace.path(repo.id, 'index.js', 'write');
        const content = repo.id === 'library' ? 'export function greet(name) { return { message: "v2 " + name }; }\n'
          : repo.id === 'sdk' ? 'import { greet } from "../library/index.js";\nexport function call() { return greet("user").message; }\n'
          : 'import { call } from "../sdk/index.js";\nexport function show() { return call(); }\n';
        await writeFile(path, content);
      });
    });
    assert.equal((await workspace.evidenceStatus(evidence.id)).valid, false);
    const checked = await workspace.exclusive(() => workspace.verify()); assert.equal(checked.status, 'verified');
    assert.equal(checked.results.length, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('snapshot restore preserves preexisting dirty files and Git index; rejects later external edits', async () => {
  const { root, workspace } = await fixture();
  try {
    const file = join(root, 'library', 'index.js');
    await writeFile(file, 'export const userWork = "中文";\n');
    assert.equal((await runProcess(['git', 'add', '--', 'index.js'], join(root, 'library'))).status, 'passed');
    const index = await readFile(join(root, 'library', '.git', 'index'));
    const baseline = await workspace.exclusive(() => workspace.checkpoint('user baseline'));
    await workspace.exclusive(() => workspace.mutate('library', 'edit', async () => writeFile(file, 'export const userWork = "中文";\nexport const added = 2;\n')));
    const changed = await workspace.exclusive(() => workspace.checkpoint('changed'));
    const changes = await workspace.compare(baseline.id, changed.id); assert.equal(changes.length, 1);
    await writeFile(file, '// unexpected user edit\n');
    await assert.rejects(workspace.exclusive(() => workspace.restore(baseline.id, changed.id)), /External edits/);
    assert.equal(await readFile(file, 'utf8'), '// unexpected user edit\n');
    await writeFile(file, 'export const userWork = "中文";\nexport const added = 2;\n');
    await workspace.exclusive(() => workspace.restore(baseline.id, changed.id));
    assert.equal(await readFile(file, 'utf8'), 'export const userWork = "中文";\n');
    assert.deepEqual(await readFile(join(root, 'library', '.git', 'index')), index);
    assert.equal((await workspace.checkpoints()).length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('evidence expires after execution environment changes', async () => {
  const { root, workspace } = await fixture();
  const original = process.env.ENIGMA_TEST_RUNTIME;
  try {
    const evidence = await workspace.evidence('reading', { checked: true });
    process.env.ENIGMA_TEST_RUNTIME = 'different environment';
    assert.equal((await workspace.evidenceStatus(evidence.id)).valid, false);
  } finally {
    if (original === undefined) delete process.env.ENIGMA_TEST_RUNTIME; else process.env.ENIGMA_TEST_RUNTIME = original;
    await rm(root, { recursive: true, force: true });
  }
});

test('denied paths, read-only repos, aliases and operation locking', async () => {
  const { root, workspace } = await fixture();
  try {
    await assert.rejects(workspace.path('app', '../outside.js'), /within/);
    await assert.rejects(workspace.path('app', '.env'), /excluded/);
    if (process.platform !== 'win32') {
      await symlink(join(root, 'library'), join(root, 'app', 'link'));
      await assert.rejects(workspace.path('app', 'link/index.js'), /[Ss]ymlink|Symbolic/);
    }
    workspace.repo('sdk').access = 'read';
    await assert.rejects(workspace.path('sdk', 'index.js', 'write'), /read-only/);
    await assert.rejects(workspace.exclusive(() => workspace.addRepo('duplicate', join(root, 'app'))), /overlaps/);
    await workspace.exclusive(async () => { await assert.rejects(workspace.exclusive(async () => undefined), /active/); });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('no checks is unverified; failed and timed out checks are not completion', async () => {
  const { root, workspace } = await fixture();
  try {
    assert.equal((await workspace.verify()).status, 'unverified');
    const timeout = await runProcess([process.execPath, '-e', 'setTimeout(()=>{},10000)'], root, { timeoutMs: 150 });
    assert.equal(timeout.status, 'timeout');
    const controller = new AbortController(); controller.abort();
    const cancelled = await runProcess([process.execPath, '-e', 'process.exit(0)'], root, { signal: controller.signal });
    assert.equal(cancelled.status, 'cancelled');
    const missing = await runProcess(['missing-enigma-executable'], root); assert.equal(missing.status, 'unknown');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('same-process workspace adapters serialize legitimate operations while retaining disk lock and nested-operation protection',async()=>{
  const {root,workspace}=await fixture();try{
    const {Workspace}=await import('../src/workspace.js'),other=await Workspace.open(root);let release!:()=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    const first=workspace.exclusive(async()=>{started();await new Promise<void>(resolve=>{release=resolve;});await workspace.addCheck({id:'first',repo:'library',argv:[process.execPath,'-e','process.exit(0)']});});await began;
    let completed=false;const second=other.exclusive(async()=>{await other.addCheck({id:'second',repo:'sdk',argv:[process.execPath,'-e','process.exit(0)']});completed=true;});
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(completed,false);release();await Promise.all([first,second]);await workspace.reload();assert(workspace.config.checks.some(check=>check.id==='first')&&workspace.config.checks.some(check=>check.id==='second'));
    await assert.rejects(workspace.exclusive(()=>other.exclusive(async()=>{})),/already active/);
  }finally{await rm(root,{recursive:true,force:true});}
});
