import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile), repository = dirname(dirname(fileURLToPath(import.meta.url)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Bind a live verification to the compiled application and selected public scripts. */
export async function validationBuild(scripts = []) {
  const files = {};
  for (const file of (await readdir(join(repository, 'dist/src'))).sort()) {
    if (!file.endsWith('.js')) continue;
    files[`dist/src/${file}`] = digest(await readFile(join(repository, 'dist/src', file)));
  }
  for (const script of scripts) files[`scripts/${script}`] = digest(await readFile(join(repository, 'scripts', script)));
  const { stdout: head } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repository });
  const { stdout: dirty } = await exec('git', ['status', '--porcelain'], { cwd: repository });
  return { at: new Date().toISOString(), head: head.trim(), dirty: dirty.trim(), node: process.version,
    package: JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')).version, files, hash: digest(JSON.stringify(files)) };
}
