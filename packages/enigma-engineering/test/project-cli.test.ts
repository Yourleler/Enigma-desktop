import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { runProcess } from '../src/process.js';

test('public CLI registers source materials, builds a source map and redacts real command output', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture();
  const cli = resolve('dist/src/cli.js');
  const secret = 'project-cli-test-secret-value'; const env = { ...process.env, ENIGMA_CLI_TEST_SECRET: secret };
  const run = async (...args: string[]) => {
    const result = await runProcess([process.execPath, cli, '--workspace', root, ...args], root, { env, timeoutMs: 30_000, limit: 1_000_000 });
    assert.equal(result.status, 'passed', result.output); return JSON.parse(result.output);
  };
  try {
    await writeFile(join(root, 'library', 'design.md'), '# 接口目标\n只读现有调用链。\n');
    const resource = await run('project', 'add', JSON.stringify({ title: '接口目标', source: { kind: 'file', repo: 'library', file: 'design.md' } }));
    assert.equal((await run('project', 'list', '接口')).items[0]?.id, resource.id);
    assert((await run('project', 'bundle', '接口')).items.some((item: { content?: string }) => item.content?.includes('只读')));
    const map = await run('task-map', 'build', JSON.stringify({ goal: '查看接口调用链', queries: [{ symbol: 'greet', repo: 'library' }], resources: [resource.id], maxQueries: 3 }));
    assert((await run('task-map', 'open', map.id)).current);
    await workspace.exclusive(() => workspace.addCheck({ id: 'output', repo: 'library', argv: [process.execPath, '-e', 'console.log(process.env.ENIGMA_CLI_TEST_SECRET)'] }));
    const checked = await run('verify'); assert.equal(checked.status, 'verified');
    assert.equal(checked.results[0].output.trim(), '[REDACTED]');
    await run('project', 'remove', resource.id); assert.equal((await run('project', 'list', '接口')).items.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
