import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { SessionChanges, summarizeRepository, parseGitFileStatuses,parseGitStatusGroups } from '../plugins/enigma/session-changes';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enigma-changes-')); roots.push(root);
  const repo = path.join(root, 'repo'), home = path.join(root, 'profile');
  await fs.mkdir(repo); await fs.mkdir(home);
  const git = (...args: string[]) => execFileSync('git', ['-c','core.hooksPath=/dev/null',...args], { cwd: repo, encoding: 'utf8',timeout:8000 });
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  await fs.writeFile(path.join(repo, 'main.ts'), 'export const value = 1;\n');
  git('add', '.'); git('commit', '-qm', 'baseline');
  const engine = { hanakoHome: home, getSessionIdForPath: () => 'session-test', getSessionManifest: () => ({ workspaceScope: { primaryCwd: repo } }), getEngineeringExecutionPreferences: () => ({ sandbox: false, network: false }) };
  return { root, repo, home, git, changes: new SessionChanges(engine, { binding: async () => null }) };
}
it('reports staged, unstaged, new and binary files with actual line counts', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.repo, 'main.ts'), 'export const value = 2;\n'); f.git('add', 'main.ts');
  await fs.writeFile(path.join(f.repo, 'main.ts'), 'export const value = 3;\nexport const another = 4;\n');
  await fs.writeFile(path.join(f.repo, 'new file.ts'), 'a\nb');
  await fs.writeFile(path.join(f.repo, 'binary.bin'), Buffer.from([0, 1]));
  const status = await summarizeRepository(f.repo, 'main');
  expect(status).toMatchObject({ files: 3, added: 4, removed: 1, untracked: 2, binary: 1 });
  expect(status.error).toBeUndefined();
});
it('separates staged and unstaged paths without counting rename sources twice',()=>{
 expect(parseGitStatusGroups('MM same.ts\0R  next.ts\0old.ts\0?? new.ts\0UU conflict.ts\0?? .env\0')).toEqual({staged:['same.ts','next.ts'],unstaged:['same.ts'],untracked:['new.ts'],conflicts:['conflict.ts']});
});
it('captures a selected repository and its first commit without changing the source index',async()=>{
 const f=await fixture(),head=f.git('rev-parse','HEAD').trim(),before=f.git('status','--porcelain');
 const result=await f.changes.read('session','commit',undefined,{base:{main:''},target:{main:head}},{analyze:false,repo:'main'});
 expect(result.changeReading.record.changes).toHaveLength(1);expect(result.changeReading.record.changes[0].change).toBe('added');
 expect(f.git('status','--porcelain')).toBe(before);
 await expect(f.changes.read('session','working',undefined,undefined,{analyze:false,repo:'unknown'})).rejects.toThrow('所选仓库');
});
it('opens ordinary conversation changes without engineering binding or writing source metadata, and freezes both views', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.repo, 'main.ts'), 'export const value = 2;\n'); f.git('add', 'main.ts');
  await fs.writeFile(path.join(f.repo, 'main.ts'), 'export const value = 3;\n');
  const before = f.git('diff', '--cached');
  const result = await f.changes.read('session', 'staged');
  const publication = result.changeReading;
  expect(publication.record.status).toBe('ready');
  expect(publication.record.changes[0].after.content).toContain('value = 2');
  expect(publication.matchesWorkspace).toBe(false);
  expect(publication.record.reading.nodes.length).toBeGreaterThan(0);
  expect(f.git('diff', '--cached')).toBe(before);
  await expect(fs.stat(path.join(f.repo, '.enigma-next'))).rejects.toMatchObject({ code: 'ENOENT' });
  await fs.writeFile(path.join(f.repo, 'main.ts'), 'export const value = 4;\n');
  expect(publication.record.changes[0].after.content).toContain('value = 2');
});
it('compares unstaged content with the index and includes new files without mixing staged edits',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.repo,'main.ts'),'export const value = 2;\n');f.git('add','main.ts');
 await fs.writeFile(path.join(f.repo,'main.ts'),'export const value = 3;\n');await fs.writeFile(path.join(f.repo,'new.txt'),'new');
 const before=f.git('diff','--cached');const result=await f.changes.read('session','unstaged',undefined,undefined,{analyze:false});
 const file=result.changeReading.record.changes.find(f=>f.file==='main.ts');
 expect(file).toMatchObject({before:{content:'export const value = 2;\n'},after:{content:'export const value = 3;\n'}});
 expect(result.changeReading.record.changes.find(f=>f.file==='new.txt')?.change).toBe('added');expect(f.git('diff','--cached')).toBe(before);
});
it('handles a repository before its first commit and distinguishes a non-repository', async () => {
  const f = await fixture();
  const fresh = path.join(f.root, 'fresh'); await fs.mkdir(fresh);
  execFileSync('git', ['init', '-q'], { cwd: fresh });
  await fs.writeFile(path.join(fresh, 'hello.txt'), 'hello\n');
  expect(await summarizeRepository(fresh, 'fresh')).toMatchObject({ files: 1, added: 1, removed: 0 });
  expect(await summarizeRepository(f.home, 'not-repo')).toMatchObject({ error: expect.any(String) });
});
it('can freeze a diff before optional reading analysis while retaining full source and freshness', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.repo, 'main.ts'), 'export const value = 2;\n');
  const {changeReading} = await f.changes.read('session', 'working', undefined, undefined, {analyze:false});
  expect(changeReading.record.status).toBe('captured');
  expect(changeReading.record.reading).toBeUndefined();
  expect(changeReading.record.changes[0]).toMatchObject({before:{content:'export const value = 1;\n'},after:{content:'export const value = 2;\n'}});
  expect(changeReading.matchesWorkspace).toBe(true);
  const frozen=path.join(changeReading.record.sourceRoot,'repos','main','main.ts');
  expect(await fs.readFile(frozen,'utf8')).toBe('export const value = 2;\n');
  await fs.writeFile(path.join(f.repo,'main.ts'),'export const value = 3;\n');
  expect(await fs.readFile(frozen,'utf8')).toBe('export const value = 2;\n');
});
it('opens current source separately and rejects source path traversal and secret files', async () => {
  const f = await fixture();
  expect(await f.changes.source('session', 'main', 'main.ts')).toMatchObject({ content: 'export const value = 1;\n' });
  await fs.writeFile(path.join(f.root, 'outside.txt'), 'outside');
  await fs.symlink(path.join(f.root, 'outside.txt'), path.join(f.repo, 'alias.txt'));
  await fs.writeFile(path.join(f.repo, '.env'), 'secret');
  await expect(f.changes.source('session', 'main', '../outside.txt')).rejects.toThrow('超出');
  await expect(f.changes.source('session', 'main', 'alias.txt')).rejects.toThrow('超出');
  await expect(f.changes.source('session', 'main', '.env')).rejects.toThrow('可读范围');
});

it('shows real added, modified, deleted and renamed paths without treating secrets as visible files', async () => {
  const f=await fixture();
  await fs.writeFile(path.join(f.repo,'removed.txt'),'remove\n');
  await fs.writeFile(path.join(f.repo,'before.txt'),'rename\n');f.git('add','.');f.git('commit','-qm','more files');
  await fs.writeFile(path.join(f.repo,'main.ts'),'export const value = 3;\n');
  await fs.writeFile(path.join(f.repo,'new file.txt'),'new\n');
  await fs.writeFile(path.join(f.repo,'.env'),'private');
  await fs.unlink(path.join(f.repo,'removed.txt'));f.git('mv','before.txt','after.txt');
  const result=await f.changes.fileStatuses('session');
  expect(result.repositories[0].files).toEqual(expect.arrayContaining([
    {path:'main.ts',status:'modified'}, {path:'new file.txt',status:'added'}, {path:'removed.txt',status:'deleted'}, {path:'after.txt',status:'renamed',previousPath:'before.txt'},
  ]));
  expect(result.repositories[0].files.some(file=>file.path==='.env')).toBe(false);
  expect(parseGitFileStatuses('UU conflict.ts\0?? a\nb.txt\0')).toEqual([{path:'conflict.ts',status:'conflict'},{path:'a\nb.txt',status:'added'}]);
});
