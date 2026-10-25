import assert from 'node:assert/strict';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { BackgroundRuns } from '../src/background.js';
import { processIdentity } from '../src/observer.js';

test('durable background command continues without workspace lock and cancellation prevents its late write', async () => {
  const { root, workspace } = await fixture(); const runs = new BackgroundRuns(workspace); let run: string | undefined;
  try {
    const launched = await runs.start({ repo: 'library', label: 'long command', argv: [process.execPath, '-e', 'setTimeout(()=>require("fs").writeFileSync("late.txt","wrong"),10000);setInterval(()=>{},1000)'], maxRuntimeMs: 20_000 });
    run = launched.spec.id; assert(['starting', 'running'].includes(launched.state.status));
    await workspace.exclusive(() => workspace.checkpoint('while background runs'));
    const cancelled = await runs.cancel(run); assert.equal(cancelled.state.status, 'cancelled', JSON.stringify(cancelled)); assert.equal(cancelled.state.cleanup, 'complete', JSON.stringify(cancelled));
    await assert.rejects(readFile(join(root, 'library', 'late.txt')), /ENOENT/);
    assert.equal((await runs.status(run)).state.status, 'cancelled');
  } finally { if (run) await runs.cancel(run).catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('a terminated background worker with a surviving child blocks source mutation until physical reconciliation', { skip: process.platform === 'win32' }, async () => {
  const { root, workspace } = await fixture(), runs = new BackgroundRuns(workspace); let child: number | undefined;
  try {
    const launched = await runs.start({ repo: 'library', label: 'unknown effects', argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] });
    let current = await runs.status(launched.spec.id);
    const deadline = Date.now() + 5000;
    while (!current.state.childPid && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 30)); current = await runs.status(launched.spec.id); }
    child = current.state.childPid; assert(child);
    process.kill(current.state.workerPid, 'SIGKILL');
    while ((await processIdentity(current.state.workerPid)).state === 'alive') await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await runs.status(launched.spec.id)).state.status, 'unknown');
    await assert.rejects(workspace.exclusive(() => workspace.mutate('library', 'write', async () => {})), /Background command effects/);
    await assert.rejects(runs.acknowledge(launched.spec.id, 'worker died'), /may still be active/);
    process.kill(-child, 'SIGKILL');
    const end = Date.now() + 5000;
    while ((await processIdentity(child)).state === 'alive' && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
    await runs.acknowledge(launched.spec.id, 'Both owned processes stopped; current source was inspected, no late file effect.');
    await workspace.exclusive(() => workspace.mutate('library', 'write', async () => {}));
  } finally { if (child) try { process.kill(-child, 'SIGKILL'); } catch {} await rm(root, { recursive: true, force: true }); }
});

test('background exit, timeout and secret-safe results are physical outcomes', async () => {
  const { root, workspace } = await fixture(); const runs = new BackgroundRuns(workspace);
  try {
    const secret = 'background-runtime-secret-value'; process.env.ENIGMA_BACKGROUND_TEST_SECRET = secret; workspace.secrets.push(secret);
    const started = await runs.start({ repo: 'sdk', label: 'result', argv: [process.execPath, '-e', 'console.log(process.env.VALUE);require("fs").writeFileSync("result.txt","done")'], envRefs: { VALUE: 'ENIGMA_BACKGROUND_TEST_SECRET' } });
    const result = await runs.wait(started.spec.id); assert.equal(result.state.status, 'passed', JSON.stringify(result)); assert(result.state.output.includes('[REDACTED]')); assert(!result.state.output.includes(secret));
    const closed = await runs.drain(started.spec.id); assert(closed.drained, JSON.stringify(closed));
    assert.equal(await readFile(join(root, 'sdk', 'result.txt'), 'utf8'), 'done');
    const timed = await runs.start({ repo: 'app', label: 'timeout', argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], maxRuntimeMs: 300 });
    const timedResult = await runs.wait(timed.spec.id); assert.equal(timedResult.state.status, 'timeout', JSON.stringify(timedResult));
    const timedClosed = await runs.drain(timed.spec.id); assert(timedClosed.drained, JSON.stringify(timedClosed));
    await assert.rejects(runs.start({ repo: 'app', label: 'unsafe', argv: ['echo', secret] }), /environment references/);
  } finally { delete process.env.ENIGMA_BACKGROUND_TEST_SECRET; await rm(root, { recursive: true, force: true }); }
});

test('a slow OS identity probe cannot hide an actual exit receipt or turn temporary observation loss into terminal execution', async () => {
  const { root, workspace } = await fixture(), runs = new BackgroundRuns(workspace);
  try {
    const run = await runs.start({ repo: 'library', label: 'probe races exit', argv: [process.execPath, '-e', 'setTimeout(()=>require("fs").writeFileSync("finished.txt","done"),1000)'] });
    const slow = new BackgroundRuns(workspace, async pid => { await new Promise(resolve => setTimeout(resolve, 1500)); return await processIdentity(pid); });
    const result = await slow.status(run.spec.id); assert.equal(result.state.status, 'passed', JSON.stringify(result));
    assert.equal(await readFile(join(root, 'library', 'finished.txt'), 'utf8'), 'done');
    const next = await runs.start({ repo: 'sdk', label: 'temporary probe loss', argv: [process.execPath, '-e', 'setTimeout(()=>require("fs").writeFileSync("finished.txt","done"),1000)'] });
    const loss = new BackgroundRuns(workspace, async pid => { const state = await processIdentity(pid); return { state: state.state }; });
    const observed = await loss.status(next.spec.id);
    if (['starting', 'running'].includes(observed.recordedStatus)) assert.equal(observed.state.status, 'unknown');
    const waited = await loss.wait(next.spec.id); assert.equal(waited.state.status, 'passed', JSON.stringify(waited));
    assert.equal(await readFile(join(root, 'sdk', 'finished.txt'), 'utf8'), 'done');
  } finally { await rm(root, { recursive: true, force: true }); }
});
