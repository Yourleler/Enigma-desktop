// Bounded CI probe. It reports failure evidence before cleanup can obscure it;
// the original full tests still determine acceptance.
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from '../dist/test/fixtures.js';
import { Delegations } from '../dist/src/delegation.js';

const { root, workspace } = await fixture(), startedAt = Date.now();
let requests = 0, task;
const api = createServer((req, res) => {
  req.resume(); req.on('end', () => {
    requests++; res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'diagnostic', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'Diagnostic response.' }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'diagnostic', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const agentDir = join(root, 'model'); await mkdir(agentDir);
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${api.address().port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'model', name: 'model', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 2000 }] } } }));
const delegates = new Delegations(workspace);
process.env.ENIGMA_WORKER_DIAGNOSTIC = '1';
const report = result => console.log(JSON.stringify({ elapsedMs: Date.now() - startedAt, requests, status: result.status, phase: result.state.phase, state: result.state.status, worker: result.worker, workerIdentity: result.state.workerIdentity, error: result.state.error }));
try {
  const result = await delegates.start({ target: 'pi', goal: 'Reply Diagnostic response.', writeRepos: [], provider: 'fixture', model: 'model', agentDir, timeoutMs: 20000, source: { agent: 'operator' }, notes: [] });
  task = result.spec.id; report(result);
  const deadline = Date.now() + 25000;
  let previous = '';
  while (Date.now() < deadline) {
    const current = await delegates.status(task), signature = JSON.stringify([current.status, current.state.phase, current.worker]);
    if (signature !== previous) { report(current); previous = signature; }
    if (current.terminal) break;
    await delay(1000);
  }
} catch (error) { console.log('Diagnostic error:', String(error)); }
finally {
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
  if (task) {
    try {
      report(await delegates.status(task));
      console.log('Worker log before cleanup:', await readFile(join(root, '.enigma-next', 'delegations', task, 'worker.log'), 'utf8'));
      await delegates.cancel(task);
      const drained = await delegates.drain(task); report(drained);
      console.log('Physical drain:', drained.drained);
      if (drained.status !== 'completed' || !drained.drained || requests !== 1) process.exitCode = 1;
      if (drained.drained) await rm(root, { recursive: true, force: true });
    } catch (error) { process.exitCode = 1; console.log('Diagnostic cleanup:', String(error)); }
  } else { process.exitCode = 1; await rm(root, { recursive: true, force: true }); }
}
