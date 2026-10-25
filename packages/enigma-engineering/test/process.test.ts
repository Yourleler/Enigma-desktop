import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { runProcess } from '../src/process.js';

test('abort during a real command terminates its descendants before late effects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-process-'));
  try {
    const controller = new AbortController();
    const childScript = 'setTimeout(()=>require("fs").writeFileSync("late.txt","unexpected"),1200)';
    const script = `require("child_process").spawn(process.execPath,["-e",${JSON.stringify(childScript)}],{stdio:"inherit"});require("fs").writeFileSync("started.txt","yes");setTimeout(()=>{},10000)`;
    const running = runProcess([process.execPath, '-e', script], root, { signal: controller.signal, timeoutMs: 5000 });
    let started = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await readFile(join(root, 'started.txt')); started = true; break; } catch { await delay(20); }
    }
    assert(started, 'command must have really started before cancellation');
    controller.abort();
    assert.equal((await running).status, 'cancelled');
    await delay(1400);
    await assert.rejects(readFile(join(root, 'late.txt')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
