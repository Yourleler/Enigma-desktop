// Run the unchanged project checks on the actual host and save a portable receipt.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
import { validationBuild } from './validation-evidence.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url))), output = resolve(process.argv[2] ?? join(repository, '.enigma-next', 'local-validation', new Date().toISOString().replaceAll(':', '-')));
if (!process.env.npm_execpath) throw new Error('Run with npm run verify:local -- OUTPUT_DIRECTORY');
await mkdir(output, { recursive: true, mode: 0o700 });
const report = { status: 'running', platform: process.platform, osRelease: release(), architecture: process.arch, node: process.version, startedAt: new Date().toISOString(), tools: [], checks: [] };
const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await save();
try {
  const probes = await Promise.allSettled([
    ['git', 'git', ['--version']],
    ['python', process.env.ENIGMA_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['--version']],
    ['gopls', process.env.ENIGMA_GOPLS ?? 'gopls', ['version']],
  ].map(([label, command, argv]) => new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] }), chunks = [];
    child.stdout.on('data', bytes => chunks.push(bytes)); child.stderr.on('data', bytes => chunks.push(bytes));
    child.once('error', reject); child.once('close', code => resolve({ label, command, code, version: Buffer.concat(chunks).toString().trim().slice(0, 1000) }));
  })));
  report.tools = probes.map(result => result.status === 'fulfilled' ? result.value : { error: String(result.reason) });
  await save();
  if (probes.some(result => result.status === 'rejected' || result.value.code !== 0)) throw new Error('A required tool version probe failed; inspect report.tools');
  for (const [label, argv] of [
    ['types', [process.env.npm_execpath, 'run', 'check']],
    ['tests', [process.env.npm_execpath, 'test']],
    ['cli', [join(repository, 'dist/src/cli.js'), '--help']],
  ]) {
    console.log(`Checking ${label} on ${process.platform}…`);
    const log = join(output, `${label}.log`), started = Date.now();
    const child = spawn(process.execPath, argv, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', bytes => chunks.push(bytes)); child.stderr.on('data', bytes => chunks.push(bytes));
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    const bytes = Buffer.concat(chunks); await writeFile(log, bytes, { mode: 0o600 });
    report.checks.push({ label, ...exit, durationMs: Date.now() - started, log, logHash: createHash('sha256').update(bytes).digest('hex'), status: exit.code === 0 ? 'passed' : 'failed' });
    await save();
    if (exit.code !== 0) throw new Error(`${label} failed; inspect ${log}`);
  }
  report.build = await validationBuild(['verify-local.mjs', 'validation-evidence.mjs']);
  report.status = 'verified';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally { report.completedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, platform: report.platform, report: join(output, 'report.json') })); }
