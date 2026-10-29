import assert from 'node:assert/strict';
import { readFile, writeFile, rm,chmod } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { git } from '../src/process.js';
import { ChangeReadings } from '../src/change-reading.js';

test('staged full diff and semantic reading share frozen index content despite newer working edits', async () => {
  const { root, workspace } = await fixture();
  try {
    for (const repo of workspace.config.repos) {
      await git(repo.root, ['add', '.']);
      await git(repo.root, ['-c', 'user.name=Enigma Test', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
    }
    const file = join(root, 'library', 'index.js');
    const old = await readFile(file, 'utf8');
    await writeFile(file, old.replace('v1', 'v2')); await git(join(root, 'library'), ['add', 'index.js']);
    const index = await readFile(join(root, 'library', '.git', 'index'));
    await writeFile(file, old.replace('v1', 'working-v3'));
    const store = new ChangeReadings(workspace);
    const activity: {kind:string;stage:string}[]=[];workspace.activity=event=>activity.push(event);
    const record = await store.build({ task: 'task-one', kind: 'staged', goal: '升级 greet 并核对 SDK 和 app 调用方' });
    assert.equal(record.status, 'ready', record.error);
    assert(activity.some(event=>event.kind==='start'&&event.stage==='reading.capture'));
    assert(activity.some(event=>event.kind==='end'&&event.stage==='reading.analyze'));
    const change = record.changes.find(change => change.repo === 'library' && change.file === 'index.js'); assert(change);
    assert(change.patch?.includes('v2')); assert(!change.patch?.includes('working-v3'));
    assert(record.reading?.nodes.some(node => node.source.repo === 'library' && node.source.snippet.includes('v2')));
    assert(!record.reading?.nodes.some(node => node.source.snippet.includes('working-v3')));
    assert.equal((await store.open(record.id, 'task-one')).matchesWorkspace, false);
    assert.deepEqual(await readFile(join(root, 'library', '.git', 'index')), index);
    assert((await readFile(file, 'utf8')).includes('working-v3'));
    await assert.rejects(store.open(record.id, 'other-task'), /another task/);
    const reopened = await store.latest('task-one'); assert.equal(reopened?.record.version, record.version);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('working change publication expires after new edits, preserves the old diff and reports binary changes', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'binary.dat'), Buffer.from([0, 255, 1, 254]));
    const store = new ChangeReadings(workspace);
    const record = await store.capture({ task: 'task-two', kind: 'working', goal: '读取未提交变更' });
    assert(record.changes.some(change => change.file === 'binary.dat' && !change.patch && change.after?.omitted));
    assert.equal((await store.open(record.id, 'task-two')).matchesWorkspace, true);
    await writeFile(join(root, 'app', 'later.txt'), 'later');
    assert.equal((await store.open(record.id, 'task-two')).matchesWorkspace, false);
    const prior = await store.open(record.id, 'task-two');
    assert(!prior.record.changes.some(change => change.file === 'later.txt'));
    await assert.rejects(store.capture({ task: 'task-two', kind: 'merge-request', goal: 'MR without revisions', url: 'https://github.com/example/project/pull/1' }), /exact/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('staged capture retains a valid filename containing a newline',async()=>{
  const {root,workspace}=await fixture();try{
    const name='odd\nname.js';await writeFile(join(root,'library',name),'export const unusual = 1;\n');await git(join(root,'library'),['add','--',name]);
    const record=await new ChangeReadings(workspace).capture({kind:'staged',task:'newline-path',goal:'Capture literal filename'});
    assert(record.changes.some(change=>change.file===name&&change.after?.content==='export const unusual = 1;\n'));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('large textual diffs declare the preview truncation while retaining the full saved source',async()=>{
 const {root,workspace}=await fixture();try{
  const text='line\n'.repeat(25000)+'TAIL_SENTINEL\n';await writeFile(join(root,'library','large.txt'),text);
  const record=await new ChangeReadings(workspace).capture({kind:'working',task:'long-diff',goal:'Inspect complete long diff'}),change=record.changes.find(item=>item.file==='large.txt');
  assert(change?.patchTruncated);assert.equal(change.patch?.length,120000);assert.equal(change.after?.content,text);assert(record.gaps.some(gap=>gap.includes('差异预览超过')));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('reading separates environment changes from source changes and recognizes executable-bit differences',async()=>{
 const {root,workspace}=await fixture();const previous=process.env.ENIGMA_READING_TEST_ENV;
 try{
  const store=new ChangeReadings(workspace),record=await store.capture({kind:'working',task:'environment',goal:'Read current sources'});
  process.env.ENIGMA_READING_TEST_ENV='changed';const environment=await store.open(record.id,'environment');assert.equal(environment.matchesWorkspace,false);assert.equal(environment.sourceMatchesWorkspace,true);assert.equal(environment.environmentMatches,false);
  await chmod(join(root,'library/index.js'),0o755);const changed=await store.open(record.id,'environment');assert.equal(changed.sourceMatchesWorkspace,false);
 }finally{if(previous===undefined)delete process.env.ENIGMA_READING_TEST_ENV;else process.env.ENIGMA_READING_TEST_ENV=previous;await rm(root,{recursive:true,force:true});}
});
