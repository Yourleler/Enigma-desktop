import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runProcess } from '../src/process.js';
import { fixture } from './fixtures.js';

for (const permitted of [true, false]) test(`native Pi CLI/HTTP file write is ${permitted ? 'executed' : 'denied with a failing task status'}`, async () => {
  const { root, workspace } = await fixture();
  const agentDir = join(root, 'pi-agent'); await mkdir(agentDir);
  if (!permitted) await workspace.exclusive(() => workspace.addCheck({ id: 'required-artifact', repo: 'library',
    argv: [process.execPath, '-e', 'if(!require("fs").existsSync("hello.txt"))process.exit(2)'] }));
  let requests = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests++;
      const hasToolResult = body.messages.some((message: { role: string }) => message.role === 'tool');
      const delta = hasToolResult ? { content: 'File written. No checks configured; unverified.' }
        : { tool_calls: [{ index: 0, id: 'fixture-write', type: 'function', function: { name: 'repo_write',
          arguments: JSON.stringify({ repo: 'library', path: 'hello.txt', content: '中文 HTTP fixture\n' }) } }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: hasToolResult ? 'stop' : 'tool_calls' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'local-fixture',
    models: [{ id: 'fixture-model', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 2000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  try {
    const result = await runProcess([process.execPath, resolve('dist/src/cli.js'), '--workspace', root, 'agent', '--approval', permitted ? 'auto' : 'never',
      '--print', '--offline', '--no-extensions', '--no-mcp', '--no-skills', '--no-context-files', '--model', 'fixture/fixture-model', 'Write hello.txt in library.'], root,
    { timeoutMs: 30_000, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0' } });
    assert.equal(result.status, permitted ? 'passed' : 'failed', result.output);
    if (permitted) assert.equal(await readFile(join(root, 'library', 'hello.txt'), 'utf8'), '中文 HTTP fixture\n');
    else await assert.rejects(readFile(join(root, 'library', 'hello.txt')), /ENOENT/);
    assert.equal(requests, 2);
    assert.equal((await workspace.checkpoints()).length, 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
