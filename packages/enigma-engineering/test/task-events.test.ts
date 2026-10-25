import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { BackgroundRuns } from '../src/background.js';
import { TaskEvents } from '../src/task-events.js';
import { ServiceManager } from '../src/services.js';

test('a separate wait worker publishes one real command result without holding the operation lock', async () => {
  const { root, workspace } = await fixture(), runs = new BackgroundRuns(workspace), waits = new TaskEvents(workspace);
  try {
    const command = await runs.start({ repo: 'library', label: 'waiting example', task: 'task-a', argv: [process.execPath, '-e', 'setTimeout(()=>console.log("actual result"),500)'] });
    const watch = await waits.start({ label: 'Continue after command', task: 'task-a', entry: 'source-entry', condition: { kind: 'background', run: command.spec.id }, pollMs: 250, resume: true, timeoutMs: 10000 });
    await workspace.exclusive(() => workspace.checkpoint('during wait'));
    const deadline = Date.now() + 15000; let events = await waits.events('task-a');
    while (!events.length && Date.now() < deadline) { await delay(50); events = await waits.events('task-a'); }
    assert.equal(events.length, 1); assert.equal(events[0]?.watch, watch.id); assert.equal(events[0]?.outcome, 'completed'); assert(JSON.stringify(events[0]?.result).includes('actual result'));
    await delay(500); assert.equal((await waits.events('task-a')).length, 1);
    assert.equal((await waits.events('task-b')).length, 0);
    await waits.markDelivery(events[0]!, 'prepared'); assert.equal((await waits.delivery(events[0]!))?.state, 'prepared');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('wait cancellation and timeout produce explicit terminal outcomes without claiming the service is ready', async () => {
  const { root, workspace } = await fixture(), services = new ServiceManager(workspace), waits = new TaskEvents(workspace);
  try {
    await services.add({ id: 'future', repo: 'library', label: 'Not started', argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], readiness: { type: 'log', includes: 'ready' } });
    const timed = await waits.start({ label: 'Timed wait', task: 'task', condition: { kind: 'service', service: 'future', state: 'ready' }, timeoutMs: 400, pollMs: 250 });
    const cancelled = await waits.start({ label: 'Cancelled wait', task: 'task', condition: { kind: 'service', service: 'future', state: 'ready' }, timeoutMs: 5000, pollMs: 250 });
    await waits.cancel(cancelled.id, 'task');
    const deadline = Date.now() + 10000; let results = await waits.events('task');
    while (results.length < 2 && Date.now() < deadline) { await delay(50); results = await waits.events('task'); }
    assert.equal(results.find(event => event.watch === timed.id)?.outcome, 'timeout');
    assert.equal(results.find(event => event.watch === cancelled.id)?.outcome, 'cancelled');
    assert.equal((await services.status('future')).ready, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
