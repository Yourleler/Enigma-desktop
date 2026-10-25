import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { RunObserver, readObserverStatus } from '../src/observer.js';
import { createObserverExtension } from '../src/pi-observer.js';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { fixture } from './fixtures.js';
import { runProcess } from '../src/process.js';
import { hash, readJson, writeJson } from '../src/storage.js';

test('observer status stays independent while a real silent command holds the workspace lock', async () => {
  const { root, workspace } = await fixture();
  const observer = await RunObserver.create(root, 'silent-command', { heartbeatMs: 100 });
  workspace.activity = event => observer.record(event);
  let command: Promise<unknown> | undefined;
  const stopMarker = join(root, 'stop-command');
  try {
    observer.record({ kind: 'start', stage: 'run', id: 'run' });
    const startedMarker = join(root, 'command-started');
    command = workspace.exclusive(() => workspace.mutate('app', 'command', () => runProcess([process.execPath, '-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(startedMarker)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(stopMarker)}))clearInterval(t)},20);`], workspace.repo('app').root, { timeoutMs: 10_000 })));
    let dispatched = false;
    for (let i = 0; i < 150 && !dispatched; i++) { try { await readFile(startedMarker); dispatched = true; } catch { await delay(20); } }
    assert(dispatched, 'actual command must start before the independent query');
    await observer.flush();
    assert(observer.state.active.some(stage => stage.stage === 'process'));
    const lockBefore = await readFile(join(workspace.data, 'operation.lock'), 'utf8');
    const statusCommand = await runProcess([process.execPath, resolve('dist/src/cli.js'), '--workspace', root, 'status', observer.state.id], root, { timeoutMs: 5000 });
    assert.equal(statusCommand.status, 'passed', statusCommand.output);
    const status = JSON.parse(statusCommand.output);
    assert.equal(status.sourceProcess.exists, true);
    assert(['alive', 'unknown'].includes(status.sourceProcess.liveness));
    assert(status.stages.some((stage: { stage: string }) => stage.stage === 'process'));
    assert(status.explanations.some((text: string) => text.includes('静默计算不等于卡死')));
    assert.equal(await readFile(join(workspace.data, 'operation.lock'), 'utf8'), lockBefore);
    await writeFile(stopMarker, 'stop');
    assert.equal((await command as { status: string }).status, 'passed');
    observer.record({ kind: 'end', stage: 'run', id: 'run', status: 'completed' }); await observer.flush();
    const statusAfter = await readObserverStatus(root, observer.state.id); assert(statusAfter.available);
    assert.equal(statusAfter.state, 'completed'); assert.equal(statusAfter.stages.length, 0);
    assert(observer.state.timings.process?.count);
  } finally { await writeFile(stopMarker, 'stop'); await command?.catch(() => undefined); await observer.close(); await rm(root, { recursive: true, force: true }); }
});

test('native Pi delayed HTTP response is observable without sending another main-agent prompt', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  let release: (() => void) | undefined, receivedResolve: (() => void) | undefined;
  const received = new Promise<void>(resolve => { receivedResolve = resolve; }); let requests = 0;
  const server = createServer((req, res) => {
    req.resume(); req.once('end', () => {
      requests++; receivedResolve?.();
      release = () => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'The actual provider response is now visible.' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`); res.end('data: [DONE]\n\n');
      };
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  await writeJson(join(root, 'model.json'), { providers: { delayed: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture',
    models: [{ id: 'model', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } });
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(root, 'model.json'), refreshOnCreate: false });
  const model = runtime.getModel('delayed', 'model'); assert(model);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true,
    extensionFactories: [createObserverExtension({ enabled: true, heartbeatMs: 100 }), createEnigmaExtension({ workspace, managed: true, approval: 'auto' })] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, settingsManager: settings, resourceLoader: loader });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  const running = session.prompt('Wait for this actual HTTP fixture.');
  try {
    await Promise.race([received, delay(5000).then(() => { throw new Error('Provider did not receive a request'); })]);
    await delay(200);
    const status = await readObserverStatus(root); assert(status.available);
    assert(status.stages.some(stage => stage.stage === 'model'), JSON.stringify(status));
    assert(status.explanations.some(text => text.includes('没有服务端遥测')));
    assert.equal(requests, 1); assert.equal(status.lastProgress, undefined);
    release?.(); await running;
    let finished = await readObserverStatus(root);
    const flushDeadline = Date.now() + 10000;
    while (finished.available && finished.state !== 'completed' && Date.now() < flushDeadline) { await delay(40); finished = await readObserverStatus(root); }
    assert(finished.available); assert.equal(finished.state, 'completed');
    assert(finished.recent.some(event => event.stage === 'model.stream'));
    assert.equal(requests, 1); assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    release?.(); await session.abort(); await running.catch(() => undefined); session.dispose(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (let i = 0; i < 50; i++) { const status = await readObserverStatus(root); if (!status.available || status.state === 'closed') break; await delay(20); }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('observer distinguishes repeated source versions from fresh evidence and never stores raw secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-observer-')); const secret = 'private-observer-secret';
  const observer = await RunObserver.create(root, 'versions', { secrets: [secret] });
  try {
    await writeFile(join(root, 'source.txt'), 'first');
    const first = hash(await readFile(join(root, 'source.txt')));
    observer.record({ kind: 'start', stage: 'run', id: 'run' });
    for (let i = 0; i < 3; i++) observer.record({ kind: 'fact', stage: 'source.read', reference: 'repo:source.txt', fingerprint: first });
    assert.equal(observer.state.signals[0]?.type, 'repeated-reading');
    const previousProgress = observer.state.lastProgress; await delay(5);
    observer.record({ kind: 'update', stage: 'model.stream', count: 100, detail: secret });
    assert.deepEqual(observer.state.lastProgress, previousProgress, 'token activity is not new evidence');
    await writeFile(join(root, 'source.txt'), 'second');
    observer.record({ kind: 'fact', stage: 'source.read', reference: 'repo:source.txt', fingerprint: hash(await readFile(join(root, 'source.txt'))) });
    assert.notEqual(observer.state.lastProgress?.at, previousProgress?.at);
    for (let i = 0; i < 3; i++) observer.record({ kind: 'fact', stage: 'tool.failed', reference: 'command', fingerprint: 'same-error' });
    observer.record({ kind: 'fact', stage: 'test', reference: secret, fingerprint: secret, detail: secret });
    for (let i = 0; i < 1000; i++) observer.record({ kind: 'update', stage: 'stream', count: 1 });
    await observer.flush();
    assert(observer.state.recent.length <= 120); assert(observer.state.mirrorLoss > 0);
    const persisted = await readFile(join(observer.directory, 'status.json'), 'utf8');
    assert(!persisted.includes(secret)); assert(! (await readFile(join(observer.directory, 'events.jsonl'), 'utf8')).includes(secret));
    assert(observer.state.signals.some(signal => signal.type === 'repeated-error'));
  } finally { await observer.close(); await rm(root, { recursive: true, force: true }); }
});

test('a killed observer process is reported terminated without trusting its stale active stages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-observer-kill-'));
  const module = pathToFileURL(resolve('dist/src/observer.js')).href;
  const script = `import {RunObserver} from ${JSON.stringify(module)};import {writeFile} from 'node:fs/promises';const o=await RunObserver.create(process.argv[1],'child');o.record({kind:'start',stage:'run',id:'run'});o.record({kind:'start',stage:'process',id:'command'});await o.flush();await writeFile(process.argv[1]+'/ready',o.state.id);setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root], { stdio: 'ignore' });
  const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()); });
  try {
    let id = '';
    for (let i = 0; i < 100 && !id; i++) { try { id = await readFile(join(root, 'ready'), 'utf8'); } catch { await delay(20); } }
    assert(id);
    const before = await readObserverStatus(root, id); assert(before.available); assert.equal(before.sourceProcess.liveness, 'alive');
    child.kill('SIGKILL'); await exited;
    const after = await readObserverStatus(root, id); assert(after.available); assert.equal(after.observation, 'source-stopped');
    assert.equal(after.sourceProcess.liveness, 'terminated');
    assert(after.explanations.some(text => text.includes('遗留活动阶段不代表')));
  } finally { child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }); }
});

test('observer rejects reused process identity and reports missing collection without creating workspace state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-observer-identity-'));
  try {
    assert.equal((await readObserverStatus(root)).available, false);
    await assert.rejects(readFile(join(root, '.enigma-next', 'workspace.json')), /ENOENT/);
    const observer = await RunObserver.create(root, 'identity');
    await observer.close();
    const path = join(observer.directory, 'status.json');
    const state = await readJson<Record<string, unknown>>(path); state.processIdentity = 'another process start time'; await writeJson(path, state);
    const status = await readObserverStatus(root, observer.state.id); assert(status.available); assert.equal(status.sourceProcess.liveness, 'pid-reused');
    state.observedAt = 'invalid-time'; await writeJson(path, state);
    await assert.rejects(readObserverStatus(root, observer.state.id), /Invalid observer snapshot/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
