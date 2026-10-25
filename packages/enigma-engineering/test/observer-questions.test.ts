import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RunObserver } from '../src/observer.js';
import { askObserver } from '../src/observer-questions.js';

test('runtime questions remain independent during wait and cannot mistake streaming for completed work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enigma-questions-')); const observer = await RunObserver.create(root, 'questions');
  try {
    observer.record({ kind: 'start', stage: 'run', id: 'run' }); observer.record({ kind: 'start', stage: 'model', id: 'request', parent: 'run' });
    observer.record({ kind: 'update', stage: 'stream', count: 100 }); await observer.flush();
    const alive = await askObserver(root, '现在是卡住了吗？'); assert(alive.answer.includes('无法') || alive.answer.includes('不能'));
    const progress = await askObserver(root, '现在有没有有意义的进展？'); assert(progress.answer.includes('没有记录可回查'));
    let calls = 0;
    const explained = await askObserver(root, '慢在哪里？', { explain: async (snapshot, _question, signal) => { calls++; assert(!signal.aborted); assert(snapshot.includes('model')); return '只观察到等待模型响应，不能确认内部阶段。'; } });
    assert.equal(explained.usedModel, true); assert.equal(calls, 1);
    const cancelled = await askObserver(root, '运行状态？', { timeoutMs: 5, explain: async (_snapshot, _question, signal) => new Promise<string>((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); }) });
    assert.equal(cancelled.usedModel, false); assert(cancelled.answer);
  } finally { await observer.close(); await rm(root, { recursive: true, force: true }); }
});
