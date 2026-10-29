import assert from 'node:assert/strict';
import { rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { Artifacts } from '../src/artifacts.js';

test('versioned task artifacts retain actual bytes while source changes and wrong task access remain explicit', async () => {
  const { root, workspace } = await fixture(), artifacts = new Artifacts(workspace);
  try {
    await writeFile(join(root, 'sdk', 'design.md'), '# Interface v1\n');
    const record = await artifacts.add({ title: 'Interface', kind: 'document', repo: 'sdk', file: 'design.md', task: 'task-a' });
    const saved = await artifacts.read(record.id, 'task-a'); assert(saved.sourceCurrent); assert.equal(await readFile(saved.path, 'utf8'), '# Interface v1\n');
    await writeFile(join(root, 'sdk', 'design.md'), '# Interface v2\n');
    const historical = await artifacts.read(record.id, 'task-a'); assert.equal(historical.sourceCurrent, false); assert.equal(await readFile(historical.path, 'utf8'), '# Interface v1\n');
    await assert.rejects(artifacts.read(record.id, 'task-b'), /another task/);
    await assert.rejects(artifacts.add({ title: 'Escape', kind: 'report', runtime: '../sdk/design.md' }), /outside/);
    await writeFile(saved.path, 'corrupt'); await assert.rejects(artifacts.read(record.id, 'task-a'), /integrity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('missing artifacts are isolated in the catalog and missing evidence cannot hide intact saved bytes',async()=>{
 const {root,workspace}=await fixture(),artifacts=new Artifacts(workspace);
 try{
  await writeFile(join(root,'sdk','one.md'),'first');await writeFile(join(root,'sdk','two.md'),'second');
  const proof=await workspace.exclusive(()=>workspace.evidence('reading',{query:'source'}));
  const first=await artifacts.add({title:'可用成果',kind:'document',repo:'sdk',file:'one.md',task:'task-a',evidence:[proof.id]});
  const missing=await artifacts.add({title:'缺少文件',kind:'document',repo:'sdk',file:'two.md',task:'task-a'});
  await artifacts.add({title:'另一任务私密成果',kind:'document',repo:'sdk',file:'two.md',task:'task-b'});
  const stored=await artifacts.read(missing.id,'task-a');await rm(stored.path);
  await rm(join(workspace.data,'evidence',`${proof.id}.json`));
  const intact=await artifacts.read(first.id,'task-a');assert.equal(await readFile(intact.path,'utf8'),'first');assert.equal(intact.evidence[0]?.current,false);
  const catalog=await artifacts.catalog('task-a');assert.deepEqual(catalog.items.map(x=>x.record.id),[first.id]);assert.equal(catalog.unavailable.length,1);assert.equal(catalog.unavailable[0]?.title,'缺少文件');
  assert(!JSON.stringify(catalog).includes('另一任务私密成果'));assert.equal((await artifacts.list('task-a')).length,1);
  await assert.rejects(artifacts.read(missing.id,'task-a'),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});
