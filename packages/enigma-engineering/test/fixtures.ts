import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Workspace } from '../src/workspace.js';

const exec = promisify(execFile);
export async function fixture(readOnly?: string) {
  const root = await mkdtemp(join(tmpdir(), 'enigma-next-'));
  const workspace = await Workspace.open(root);
  for (const name of ['library', 'sdk', 'app']) {
    const dir = join(root, name); await mkdir(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', dependencies: name === 'sdk' ? { library: '*' } : name === 'app' ? { sdk: '*' } : {} }) + '\n');
    await writeFile(join(dir, 'index.js'), name === 'library' ? 'export function greet() { return "v1"; }\n'
      : name === 'sdk' ? 'import { greet } from "../library/index.js";\nexport function call() { return greet(); }\n'
      : 'import { call } from "../sdk/index.js";\nexport function main() { return call(); }\n');
    await exec('git', ['init', '-b', 'main'], { cwd: dir });
    await workspace.exclusive(() => workspace.addRepo(name, dir, { access: name === readOnly ? 'read' : 'write' }));
  }
  return { root, workspace };
}
