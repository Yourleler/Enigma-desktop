import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('exits naturally after engine shutdown with a real workspace history watcher', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'enigma-history-shutdown-'));
  const workspace = path.join(fixture, 'workspace');
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'README.md'), 'History must survive shutdown.\n');
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = `
    import { HanaEngine } from './core/engine.ts';
    const engine = new HanaEngine({ hanakoHome: ${JSON.stringify(path.join(fixture, 'home'))}, productDir: ${JSON.stringify(path.join(fixture, 'product'))}, agentId: 'hana' });
    const history = engine.getFileHistoryService();
    await history.syncWorkspaces([${JSON.stringify(workspace)}]);
    await history.waitForIdle();
    if (!history.listVersions(${JSON.stringify(workspace)}, 'README.md').length) throw new Error('Missing captured history');
    await engine.dispose();
    console.log('HISTORY_SHUTDOWN_DONE');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '', timedOut = false;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 10000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(timedOut, `Engine retained a watcher after disposal.\n${output}\n${error}`).toBe(false);
    expect(code, error).toBe(0);
    expect(output).toContain('HISTORY_SHUTDOWN_DONE');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await fs.rm(fixture, { recursive: true, force: true });
  }
}, 15000);
