import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { SessionChanges, summarizeRepository } from '../plugins/enigma/session-changes';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enigma-changes-')); roots.push(root);
  const repo = path.join(root, 'repo'), home = path.join(root, 'profile');
  await fs.mkdir(repo); await fs.mkdir(home);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
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
it('handles a repository before its first commit and distinguishes a non-repository', async () => {
  const f = await fixture();
  const fresh = path.join(f.root, 'fresh'); await fs.mkdir(fresh);
  execFileSync('git', ['init', '-q'], { cwd: fresh });
  await fs.writeFile(path.join(fresh, 'hello.txt'), 'hello\n');
  expect(await summarizeRepository(fresh, 'fresh')).toMatchObject({ files: 1, added: 1, removed: 0 });
  expect(await summarizeRepository(f.home, 'not-repo')).toMatchObject({ error: expect.any(String) });
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
