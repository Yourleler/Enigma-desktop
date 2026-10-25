import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createObserverExtension } from '../src/pi-observer.js';
import { readObserverStatus } from '../src/observer.js';
import { fixture } from './fixtures.js';
import { writeJson } from '../src/storage.js';

test('provider retries are grounded in actual HTTP error responses and later requests', async () => {
  const { root } = await fixture(); const agentDir = join(root, 'agent'); let requests = 0;
  const server = createServer((req, res) => { req.resume(); req.once('end', () => {
    requests++;
    if (requests === 1) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'overloaded fixture' } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Visible response after retry.' }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`); res.end('data: [DONE]\n\n');
  }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert(address && typeof address === 'object');
  await writeJson(join(root, 'models.json'), { providers: { retry: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture',
    models: [{ id: 'fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } });
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(root, 'models.json'), refreshOnCreate: false });
  const model = runtime.getModel('retry', 'fixture'); assert(model);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 10 } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
    extensionFactories: [createObserverExtension({ enabled: true })] }); await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, settingsManager: settings, resourceLoader: loader }); await session.bindExtensions({});
  try {
    await session.prompt('Receive a real fixture response after an HTTP overload.');
    assert.equal(requests, 2); assert(session.getLastAssistantText()?.includes('after retry'));
    let status = await readObserverStatus(root);
    for (let i = 0; i < 50 && status.available && status.state !== 'completed'; i++) { await delay(20); status = await readObserverStatus(root); }
    assert(status.available); assert.equal(status.state, 'completed');
    assert(status.recent.some(event => event.stage === 'provider.retry'), JSON.stringify(status.recent));
  } finally { session.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await delay(300); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
