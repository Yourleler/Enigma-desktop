import assert from 'node:assert/strict';
import { rm, readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { ProjectContext } from '../src/project-context.js';
import { TaskReadingStore } from '../src/task-reading.js';

test('records every changed file beyond 80 and distinguishes clipped, binary, deleted and budgeted sources', {timeout:60_000}, async()=>{
  const {root,workspace}=await fixture();
  try{
    const files=Array.from({length:85},(_,i)=>`note-${i}.txt`);
    for(const file of files)await writeFile(join(root,'library',file),`Document ${file}\n`);
    await writeFile(join(root,'library','long-line.txt'),'x'.repeat(7000));
    await writeFile(join(root,'library','large.txt'),'x'.repeat(512001));
    await writeFile(join(root,'library','binary.dat'),Buffer.from([0,1,2]));
    const changes=[...files.map(file=>({repo:'library',file,change:'added'})),
      ...['long-line.txt','large.txt','binary.dat'].map(file=>({repo:'library',file,change:'added'})),
      {repo:'library',file:'removed.txt',change:'deleted'},
      {repo:'library',file:'not-retained.txt',change:'added',after:{omitted:'Binary or source reading budget exceeded'}}];
    const report=await new TaskReadingStore(workspace).build({goal:'Read every changed document',changes,maxQueries:1});
    assert.equal(report.sourceCoverage?.files.length,90);
    assert.equal(report.sourceCoverage?.outlineFiles.total,90);assert.equal(report.sourceCoverage?.outlineFiles.examined,24);
    assert(report.nodes.some(n=>n.source.file==='note-84.txt'));
    const long=report.nodes.find(n=>n.source.file==='long-line.txt')!;assert.equal(long.source.truncated,true);assert.equal(long.source.snippet.length,6000);assert.equal(long.role,'documentation');
    assert.equal(report.sourceCoverage?.files.find(f=>f.file==='large.txt')?.status,'budget');
    assert.equal(report.sourceCoverage?.files.find(f=>f.file==='binary.dat')?.status,'unavailable');
    assert.equal(report.sourceCoverage?.files.find(f=>f.file==='removed.txt')?.status,'deleted');
    assert(report.sourceCoverage?.files.find(f=>f.file==='not-retained.txt')?.reason?.includes('冻结版本未保存文本'));
    assert(report.gaps.some(gap=>gap.startsWith('3 changed files')));
    const reopened=await new TaskReadingStore(workspace).open(report.id);assert.deepEqual(reopened.report.sourceCoverage,report.sourceCoverage);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a single application entry expands upstream calls across all three repositories', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root,'sdk','index.js'), 'import { greet as say } from "../library/index.js";\nexport const call = () => say();\n');
    const report = await new TaskReadingStore(workspace).build({goal:'理解应用入口',queries:[{symbol:'main',repo:'app'}],maxQueries:3});
    assert.deepEqual(new Set(report.nodes.map(node=>node.source.repo)),new Set(['app','sdk','library']));
    assert(report.edges.some(edge=>edge.kind==='outgoing-call'&&edge.from.startsWith('app:')&&edge.to.startsWith('sdk:')));
    assert(report.edges.some(edge=>edge.kind==='outgoing-call'&&edge.from.startsWith('sdk:')&&edge.to.startsWith('library:')));
    assert(!report.gaps.includes('Further source expansion remains outside the query budget.'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('task reading connects changed repositories, source paths, advisory requirements and actual joint checks', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture();
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'joint', repo: 'app', joint: true, argv: [process.execPath, '--input-type=module', '-e', 'import {main} from "./index.js"; if(main()!=="v2:sdk:app") process.exit(1)'] }));
    const baseline = await workspace.exclusive(() => workspace.checkpoint('v1'));
    await writeFile(join(root, 'library', 'index.js'), 'export function greet() { return "v2"; }\n');
    await writeFile(join(root, 'sdk', 'index.js'), 'import { greet } from "../library/index.js";\nexport function call() { return greet()+":sdk"; }\n');
    await writeFile(join(root, 'app', 'index.js'), 'import { call } from "../sdk/index.js";\nexport function main() { return call()+":app"; }\n');
    const store = new TaskReadingStore(workspace);
    const report = await store.build({ goal: '三仓库响应升级', baseline: baseline.id, expectedRepos: ['library'],
      requirements: [{ id: 'response', text: '最终应用返回 v2:sdk:app', checks: ['joint'] }], maxQueries: 6 });
    assert.deepEqual(new Set(report.nodes.map(node => node.source.repo)), new Set(['library', 'sdk', 'app']));
    assert(report.edges.some(edge => edge.confidence === 'confirmed'));
    assert.equal(report.path.length, report.nodes.length);
    assert(report.chapters?.some(chapter => chapter.nodes.length > 0));
    assert(report.groups.some(group => group.files.length === 3));
    assert.equal(report.unexpected.length, 2);
    assert((await store.open(report.id)).current);
    const anchor = report.nodes.find(node => node.source.symbol === 'main')!.id;
    await assert.rejects(store.annotate(report.id, 1, { insights: [{ title: '编造', text: '不存在的依据', anchors: ['missing-node'], kind: 'risk' }] }), /anchors/);
    const annotated = await store.annotate(report.id, 1, { insights: [{ title: '链路变化', text: '应用调用 SDK，SDK 调用上游。', anchors: [anchor], kind: 'explanation' }],
      chapters: [{ id: 'application', title: '应用消费链', summary: '应用读取 SDK 的返回值。', nodes: [anchor] }],
      requirements: [{ id: 'response', status: 'supported', anchors: [anchor], explanation: '应用源码和上游实现支持这个结果，仍需实际联合执行。' }] });
    assert.equal(annotated.revision, 2); assert.equal(annotated.insights[0]?.authority, 'model-inference');
    assert.equal(annotated.chapters?.[0]?.authority, 'model-inference'); assert(annotated.gaps.some(gap => gap.startsWith('chapters:')));
    assert.equal((await store.coverage(report.id)).requirements[0]?.checksPassed, false);
    const verified = await workspace.exclusive(() => workspace.verify());
    assert.equal(verified.status, 'verified');
    assert.equal((await store.coverage(report.id, verified.evidence)).requirements[0]?.checksPassed, true);
    await writeFile(join(root, 'library', 'index.js'), 'export function greet() { return "v3"; }\n');
    assert.equal((await store.open(report.id)).current, false);
    await assert.rejects(store.annotate(report.id, 2, { insights: [] }), /changed/);
    assert.equal((await store.coverage(report.id, verified.evidence)).requirements[0]?.checksPassed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('task map freshness follows project materials and respects task scope', async () => {
  const { root, workspace } = await fixture();
  try {
    const context = new ProjectContext(workspace);
    const resource = await context.add({ title: '当前目标', task: 'task-a', source: { kind: 'note', author: 'user' }, content: '本任务只更改 SDK 文档。' });
    const store = new TaskReadingStore(workspace);
    const report = await store.build({ goal: '说明 SDK 调用关系', queries: [{ symbol: 'call', repo: 'sdk' }], resources: [resource.id], task: 'task-a', maxQueries: 3 });
    assert((await store.open(report.id, 'task-a')).current);
    assert.equal((await store.list('task-a')).items.length,1);assert.equal((await store.list('task-b')).items.length,0);
    await assert.rejects(store.open(report.id, 'task-b'), /another task/);
    await context.refresh(resource.id, { task: 'task-a' }, '调整后的任务背景。');
    assert.equal((await store.open(report.id, 'task-a')).current, false);
    const prior=await readFile(join(workspace.data,'task-readings',`${report.id}-1.json`),'utf8');
    await rm(join(workspace.data,'evidence',report.evidence+'.json'));
    const missing=await store.open(report.id,'task-a');assert.equal(missing.current,false);assert(missing.issues.some(issue=>issue.includes('证据暂不可读取')));assert.equal(missing.report.nodes.length,report.nodes.length);
    const coverage=await store.coverage(report.id,'missing-evidence','task-a');assert(coverage.evidenceIssue);assert.equal(coverage.current,false);
    assert.equal(await readFile(join(workspace.data,'task-readings',`${report.id}-1.json`),'utf8'),prior);
  } finally { await rm(root, { recursive: true, force: true }); }
});
