import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { Delegations } from '../src/delegation.js';
import { Experiments } from '../src/experiments.js';
import { Workspace } from '../src/workspace.js';
import { writeJson, readJson } from '../src/storage.js';
import type { WorkspaceConfig } from '../src/types.js';

test('isolated branch comparison uses actual common checks, rejects stale/tampered criteria and selects through a protected parent merge', { timeout: 90_000 }, async () => {
  const { root, workspace } = await fixture(), delegates = new Delegations(workspace), experiments = new Experiments(workspace), ids: string[] = [];
  const server = createServer((request, response) => { const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString()), done = body.messages.some((message: { role: string }) => message.role === 'tool'), good = JSON.stringify(body.messages).includes('variant-good');
    const delta = done ? { content: 'Variant prepared; actual checks decide acceptance.' } : { tool_calls: [{ index: 0, id: 'write-variant', type: 'function', function: { name: 'repo_write', arguments: JSON.stringify({ repo: 'library', path: 'index.js', content: `export function greet(){return "${good ? 'v2' : 'wrong'}"}\n` }) } }] };
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: done ? 'stop' : 'tool_calls' }] })}\n\n`); response.end('data: [DONE]\n\n');
  }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert(address && typeof address === 'object'); const agentDir = join(root, 'models'); await mkdir(agentDir);
  await writeJson(join(agentDir, 'models.json'), { providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'model', name: 'fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 2000 }] } } });
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'joint', repo: 'app', joint: true, argv: [process.execPath, '-e', 'import("./index.js").then(m=>{if(m.main()!=="v2")process.exit(1);console.log(m.main())})'] }));
    const input = (variant: string) => ({ target: 'pi' as const, provider: 'fixture', model: 'model', agentDir, task: 'experiment-task', goal: variant, checks: ['joint'], writeRepos: ['library'], timeoutMs: 30000, source: { agent: 'operator' }, notes: [{ role: 'user' as const, kind: 'requirement' as const, reference: 'variant request', text: variant }] });
    const first = await delegates.start(input('variant-good')), second = await delegates.start(input('variant-bad')); ids.push(first.spec.id, second.spec.id);
    const [good, bad] = await Promise.all(ids.map(id => delegates.wait(id, { timeoutMs: 30000 }))); assert.equal(good!.state.status, 'completed', JSON.stringify(good)); assert.equal(bad!.state.status, 'completed', JSON.stringify(bad));
    const experiment = await experiments.create({ goal: 'Application returns v2', task: 'experiment-task', checks: ['joint'], candidates: [{ id: 'good', delegation: first.spec.id }, { id: 'bad', delegation: second.spec.id }] });
    await writeFile(join(root, 'app', 'USER.txt'), 'Concurrent user change');
    const report = await experiments.evaluate(experiment.id, { task: 'experiment-task' }); assert.equal(report.candidates.find(item => item.id === 'good')?.status, 'passed'); assert.equal(report.candidates.find(item => item.id === 'bad')?.status, 'failed');
    await assert.rejects(experiments.select(experiment.id, 'bad', { task: 'experiment-task' }), /currently verified/);
    const isolated = await Workspace.open(first.spec.workspace), original = await readFile(join(isolated.repo('library').root, 'index.js'));
    await writeFile(join(isolated.repo('library').root, 'index.js'), 'export function greet(){return "v3"}\n'); assert.equal((await experiments.report(experiment.id)).candidates.find(item => item.id === 'good')?.selectable, false);
    await assert.rejects(experiments.select(experiment.id, 'good'), /currently verified/); await writeFile(join(isolated.repo('library').root, 'index.js'), original);
    const badWorkspace = await Workspace.open(second.spec.workspace), configPath = join(badWorkspace.data, 'workspace.json'), config = await readJson<WorkspaceConfig>(configPath), saved = structuredClone(config);
    config.checks[0]!.argv = [process.execPath, '-e', 'require("fs").writeFileSync("tampered-check-ran.txt","wrong")']; await writeJson(configPath, config);
    await assert.rejects(experiments.evaluate(experiment.id), /commands differ/); await assert.rejects(access(join(badWorkspace.repo('app').root, 'tampered-check-ran.txt')), /ENOENT/); await writeJson(configPath, saved);
    await experiments.evaluate(experiment.id); const selected = await experiments.select(experiment.id, 'good', { task: 'experiment-task' }); assert(selected.preview.applyAllowed);
    const merged = await delegates.merge(selected.preview.id, { task: 'experiment-task' }); assert.equal(merged.verification.status, 'verified'); assert.equal(await readFile(join(root, 'app', 'USER.txt'), 'utf8'), 'Concurrent user change');
    const parentConfig = await readJson<WorkspaceConfig>(join(workspace.data, 'workspace.json')); parentConfig.checks[0]!.argv.push('changed'); await writeJson(join(workspace.data, 'workspace.json'), parentConfig);
    assert.equal((await experiments.report(experiment.id)).criteriaCurrent, false); await assert.rejects(experiments.select(experiment.id, 'good'), /currently verified/);
  } finally { try { for (const id of ids) { await delegates.cancel(id).catch(() => {}); const drained = await delegates.drain(id); assert(drained.drained, JSON.stringify(drained)); } } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); } }
});
