import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { prepareReview, readReviewSource } from '../src/review.js';
import { runPiReview } from '../src/pi-review.js';
import { fixture } from './fixtures.js';

test('independent review reads frozen changes in a new context without shell or mutation tools', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('review baseline'));
    await writeFile(join(root, 'library', 'index.js'), 'export function greet(){return {message:"v2"};}\n');
    const before = await readFile(join(root, 'library', 'index.js'), 'utf8');
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    let visible = '';
    faux.setResponses([context => { visible = JSON.stringify(context); return fauxAssistantMessage([fauxToolCall('review_read', { repo: 'library', file: 'index.js' })], { stopReason: 'toolUse' }); },
      fauxAssistantMessage([fauxToolCall('write', { path: 'index.js', content: 'forbidden' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('library/index.js:1 changed its return to an object; sdk/index.js still returns the object directly. Check the application string contract.')]);
    const report = await runPiReview(workspace, { baseline: baseline.id, goal: 'Preserve app output', requirements: [{ text: 'A new return shape must be adapted by sdk.', reference: 'original user input' }] },
      { modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, agentDir });
    assert.equal(report.status, 'completed', JSON.stringify(report));
    assert(report.text.includes('sdk/index.js')); assert(visible.includes('review_read')); assert(!visible.includes('Execute bash commands'));
    assert.equal(await readFile(join(root, 'library', 'index.js'), 'utf8'), before);
    assert.notEqual(report.session, undefined);
    assert(report.limitations.some(limit => limit.includes('advisory')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('review reads retain captured source and its report becomes stale after an external edit', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('before review'));
    const frozen = await prepareReview(workspace, { baseline: baseline.id, goal: 'Check source', requirements: [] });
    await writeFile(join(root, 'library', 'index.js'), 'export const outside=true;\n');
    assert((await readReviewSource(workspace, frozen, 'library', 'index.js')).content.includes('greet'));
    await assert.rejects(readReviewSource(workspace, frozen, 'library', '../secret'), /outside/);
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    faux.setResponses([async () => { await writeFile(join(root, 'library', 'index.js'), 'export const changedDuringReview=true;\n'); return fauxAssistantMessage('Observed source requires a runtime check.'); }]);
    const report = await runPiReview(workspace, { baseline: baseline.id, goal: 'Check current delta', requirements: [] },
      { modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, agentDir });
    assert.equal(report.status, 'stale'); assert.equal(report.sourceCurrent, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelled independent review produces no completed verdict', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  try {
    const baseline = await workspace.exclusive(() => workspace.checkpoint('cancelled review baseline'));
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    const controller = new AbortController(); controller.abort();
    const report = await runPiReview(workspace, { baseline: baseline.id, goal: 'Review cancelled', requirements: [] },
      { modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, agentDir, signal: controller.signal });
    assert.equal(report.status, 'cancelled'); assert.equal(faux.state.callCount, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
