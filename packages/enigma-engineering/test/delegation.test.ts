import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { Delegations } from '../src/delegation.js';
import { PlanStore } from '../src/planning.js';

async function modelServer(root: string, delayMs = 1000, barrier = false, content = 'Prepared in the isolated child.\n', overrideCall?: { name: string; args: unknown }) {
  let requests = 0, active = 0, maximum = 0; const pending: (() => void)[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
      requests++; active++; maximum = Math.max(maximum, active); response.once('close', () => { active--; }); const body = JSON.parse(Buffer.concat(chunks).toString()), hasResult = body.messages.some((message: { role: string }) => message.role === 'tool');
      const readOnly = JSON.stringify(body.messages).includes('Read only');
      const delta = hasResult ? { content: 'Prepared result from actual source.' } : { tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: {
        name: overrideCall?.name ?? (readOnly ? 'repo_read' : 'repo_write'), arguments: JSON.stringify(overrideCall?.args ?? (readOnly ? { repo: 'library', file: 'index.js' } : { repo: 'library', path: 'MODULE.md', content })) } }] };
      const send = () => setTimeout(() => { if (response.destroyed) return; response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: hasResult ? 'stop' : 'tool_calls' }] })}\n\n`); response.end('data: [DONE]\n\n'); }, hasResult ? 0 : delayMs);
      if (barrier && !hasResult && pending.length < 2) { pending.push(send); if (pending.length === 2) pending.forEach(send => send()); } else send();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert(address && typeof address === 'object');
  const agentDir = join(root, 'model'); await mkdir(agentDir);
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'model', name: 'model', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 2000 }] } } }));
  return { agentDir, get requests() { return requests; }, get maximum() { return maximum; }, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
const input = (agentDir: string, goal: string, writeRepos: string[] = ['library']) => ({ target: 'pi' as const, provider: 'fixture', model: 'model', agentDir, goal, writeRepos, source: { agent: 'operator', requests: 7 }, notes: [{ role: 'user' as const, kind: 'requirement' as const, reference: 'original goal', text: goal }], timeoutMs: 20000 });

test('real child processes run independently, return owned results and merge only reviewed code while preserving parent changes/plan', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), api = await modelServer(root, 100, true), delegates = new Delegations(workspace);
  const ids: string[] = [];
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'document', repo: 'library', argv: [process.execPath, '-e', 'if(!require("fs").existsSync("MODULE.md"))process.exit(1)'] }));
    const plan = await new PlanStore(workspace).create({ goal: 'Keep parent task', steps: [{ id: 'doc', repo: 'library', goal: 'Prepare document', checks: ['document'] }] });
    const first = await delegates.start({ ...input(api.agentDir, 'Prepare MODULE.md'), checks: ['document'], timeoutMs: 40000, task: 'parent-task' }); ids.push(first.spec.id);
    const second = await delegates.start({ ...input(api.agentDir, 'Read only source', []), timeoutMs: 40000, task: 'parent-task' }); ids.push(second.spec.id);
    assert.notEqual(first.spec.workspace, second.spec.workspace); assert.equal(first.spec.inheritedRequests, 7);
    await writeFile(join(root, 'app', 'USER.txt'), 'Parent concurrent edit');
    const [done, read] = await Promise.all([delegates.wait(first.spec.id, { timeoutMs: 20000 }), delegates.wait(second.spec.id, { timeoutMs: 20000 })]);
    assert.equal(done.state.status, 'completed', JSON.stringify(done)); assert.equal(read.state.status, 'completed', JSON.stringify(read)); assert.equal(done.state.requests, 2); assert.equal(read.state.requests, 2);
    assert(api.maximum >= 2, 'Both real worker requests must overlap');
    await assert.rejects(access(join(root, 'library', 'MODULE.md')), /ENOENT/); await assert.rejects(delegates.status(first.spec.id, 'other-task'), /ownership/);
    const preview = await delegates.preview(first.spec.id, 'parent-task'); assert(preview.applyAllowed); assert(preview.changes.some(change => change.file === 'MODULE.md'));
    const merged = await delegates.merge(preview.id, { task: 'parent-task' }); assert.equal(merged.verification.status, 'verified');
    assert.equal(await readFile(join(root, 'library', 'MODULE.md'), 'utf8'), 'Prepared in the isolated child.\n'); assert.equal(await readFile(join(root, 'app', 'USER.txt'), 'utf8'), 'Parent concurrent edit'); assert.equal((await new PlanStore(workspace).current())?.id, plan.id);
    await assert.rejects(delegates.merge(preview.id, { task: 'parent-task' }), /External edits|differ/);
  } finally { try { for (const id of ids) { await delegates.cancel(id).catch(() => {}); const drained = await delegates.drain(id); assert(drained.drained, JSON.stringify(drained)); } } finally { await api.close(); await rm(root, { recursive: true, force: true }); } }
});

test('a child cannot register the parent as an additional writable repository', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), api = await modelServer(root, 100, false, '', { name: 'repo_add', args: { id: 'parent-library', path: join(root, 'library'), readOnly: false } }), delegates = new Delegations(workspace); let id: string | undefined;
  try {
    const started = await delegates.start(input(api.agentDir, 'Attempt parent registration')); id = started.spec.id;
    const done = await delegates.wait(id, { timeoutMs: 20000 }); assert.equal(done.state.status, 'failed', JSON.stringify(done));
    const config = JSON.parse(await readFile(join(done.spec.workspace, '.enigma-next', 'workspace.json'), 'utf8')); assert(!config.repos.some((repo: { id: string }) => repo.id === 'parent-library'));
    await assert.rejects(delegates.preview(id), /completed child/); assert.equal(await readFile(join(root, 'library', 'index.js'), 'utf8'), 'export function greet() { return "v1"; }\n');
  } finally { try { if (id) { await delegates.cancel(id).catch(() => {}); const drained = await delegates.drain(id); assert(drained.drained, JSON.stringify(drained)); } } finally { await api.close(); await rm(root, { recursive: true, force: true }); } }
});

test('child request budget and cancellation are real terminal receipts, with no automatic source merge', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), api = await modelServer(root, 1000), delegates = new Delegations(workspace); const ids: string[] = [];
  try {
    const budget = await delegates.start({ ...input(api.agentDir, 'Prepare budget-limited document'), maxRequests: 1 }); ids.push(budget.spec.id);
    const limited = await delegates.wait(budget.spec.id, { timeoutMs: 20000 }); assert.equal(limited.state.status, 'budget', JSON.stringify(limited)); assert.equal(limited.state.requests, 1);
    await assert.rejects(delegates.preview(budget.spec.id), /completed child/); await assert.rejects(access(join(root, 'library', 'MODULE.md')), /ENOENT/);
    const before = api.requests, next = await delegates.start(input(api.agentDir, 'Prepare cancelled document')); ids.push(next.spec.id);
    const deadline = Date.now() + 10000; while (api.requests <= before && Date.now() < deadline) await delay(20); assert(api.requests > before, 'actual provider request must be active');
    const cancelled = await delegates.cancel(next.spec.id); assert.equal(cancelled.state.status, 'cancelled', JSON.stringify(cancelled));
    await assert.rejects(access(join(root, 'library', 'MODULE.md')), /ENOENT/); await assert.rejects(delegates.preview(next.spec.id), /completed child/);
  } finally { try { for (const id of ids) { await delegates.cancel(id).catch(() => {}); const drained = await delegates.drain(id); assert(drained.drained, JSON.stringify(drained)); } } finally { await api.close(); await rm(root, { recursive: true, force: true }); } }
});

test('merge previews reject overlapping parent edits and child changes after preview', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), api = await modelServer(root, 100), delegates = new Delegations(workspace); let id: string | undefined;
  try {
    await writeFile(join(root, 'library', 'MODULE.md'), 'Original document\n');
    const started = await delegates.start(input(api.agentDir, 'Prepare changed MODULE.md')); id = started.spec.id; const done = await delegates.wait(id, { timeoutMs: 20000 }); assert.equal(done.state.status, 'completed', JSON.stringify(done));
    await writeFile(join(root, 'library', 'MODULE.md'), 'User changed the same line\n'); const conflict = await delegates.preview(id); assert.equal(conflict.applyAllowed, false); assert(conflict.conflicts.length);
    await assert.rejects(delegates.merge(conflict.id), /conflicting/); assert.equal(await readFile(join(root, 'library', 'MODULE.md'), 'utf8'), 'User changed the same line\n');
    await writeFile(join(root, 'library', 'MODULE.md'), 'Original document\n'); const preview = await delegates.preview(id); assert(preview.applyAllowed);
    const child = (await import('../src/workspace.js')).Workspace; const isolated = await child.open(done.spec.workspace); await writeFile(join(isolated.repo('library').root, 'MODULE.md'), 'Child changed after review\n');
    await assert.rejects(delegates.merge(preview.id), /Child changed/);
  } finally { try { if (id) { await delegates.cancel(id).catch(() => {}); const drained = await delegates.drain(id); assert(drained.drained, JSON.stringify(drained)); } } finally { await api.close(); await rm(root, { recursive: true, force: true }); } }
});

test('three-way merge preserves independent edits within one file and runs current parent acceptance', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), separators = Array.from({ length: 8 }, (_, index) => `keep ${index}`).join('\n'),
    original = `first\n${separators}\nlast\n`, childText = `child-first\n${separators}\nlast\n`, parentText = `first\n${separators}\nuser-last\n`,
    api = await modelServer(root, 100, false, childText), delegates = new Delegations(workspace); let id: string | undefined;
  try {
    await writeFile(join(root, 'library', 'MODULE.md'), original);
    const started = await delegates.start(input(api.agentDir, 'Prepare the first section')); id = started.spec.id; assert.equal((await delegates.wait(id, { timeoutMs: 20000 })).state.status, 'completed');
    await writeFile(join(root, 'library', 'MODULE.md'), parentText);
    await workspace.exclusive(() => workspace.addCheck({ id: 'both-edits', repo: 'library', argv: [process.execPath, '-e', 'const s=require("fs").readFileSync("MODULE.md","utf8");if(!s.includes("child-first")||!s.includes("user-last"))process.exit(1)'] }));
    const preview = await delegates.preview(id); assert(preview.applyAllowed); assert(preview.changes.some(change => change.state === 'merged'));
    const result = await delegates.merge(preview.id); assert.equal(result.verification.status, 'verified');
    assert.equal(await readFile(join(root, 'library', 'MODULE.md'), 'utf8'), `child-first\n${separators}\nuser-last\n`);
  } finally { try { if (id) { await delegates.cancel(id).catch(() => {}); const drained = await delegates.drain(id); assert(drained.drained, JSON.stringify(drained)); } } finally { await api.close(); await rm(root, { recursive: true, force: true }); } }
});

test('cancelling during actual handoff inspection prevents model dispatch and isolated file mutation', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture();
  const { TaskPackages } = await import('../src/task-package.js'), { runPiDelegation } = await import('../src/pi-delegation-run.js');
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent'), { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  try {
    const packaged = await new TaskPackages(workspace).export({ goal: 'Prepare a file', source: { agent: 'operator' }, notes: [] });
    const isolated = await TaskPackages.restore(packaged.directory, join(root, 'isolated'), { writeRepos: ['library'], activateRuntime: true });
    const agentDir = join(root, 'cancel-model'), runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'model', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'library', path: 'LATE.txt', content: 'late write' })], { stopReason: 'toolUse' }), fauxAssistantMessage('Done')]);
    const controller = new AbortController(); let calls = 0, entered = false;
    const result = await runPiDelegation(isolated.workspace, { schema: 1, id: 'delegation-init', fingerprint: '', parent: root, goal: 'Write LATE.txt', target: 'pi', createdAt: new Date().toISOString(), package: packaged.directory, packageHash: '', workspace: isolated.workspace.root,
      handoff: isolated.handoff, writeRepos: ['library'], checks: [], timeoutMs: 20000, provider: faux.getModel().provider, model: faux.getModel().id, agentDir, inheritedRequests: 0 },
    { runtime, signal: controller.signal, update: values => { calls = values.requests ?? calls; if (values.phase === 'handoff') { entered = true; controller.abort(); } } });
    assert(entered, 'Cancel must occur after native SDK setup at the real handoff boundary'); assert.equal(result.status, 'cancelled'); assert.equal(calls, 0);
    await assert.rejects(access(join(isolated.workspace.repo('library').root, 'LATE.txt')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
