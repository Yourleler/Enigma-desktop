import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { fixture } from './fixtures.js';
import { runProcess } from '../src/process.js';
import { storePath, writeJson } from '../src/storage.js';

test('a workspace command records all repo effects with one before and after capture per repo', async () => {
  const { root, workspace } = await fixture();
  try {
    const snapshots: string[] = []; workspace.activity = event => { if (event.kind === 'end' && event.stage === 'snapshot') snapshots.push(event.repo!); };
    await workspace.exclusive(() => workspace.mutate('app', 'command', () => runProcess([process.execPath, '-e', 'require("fs").writeFileSync("../sdk/change.txt","changed")'], workspace.repo('app').root)));
    assert.equal(snapshots.length, 6);
    for (const repo of workspace.config.repos) assert.equal(snapshots.filter(id => id === repo.id).length, 2);
    const op = (await workspace.operations())[0]!; assert.equal(op.beforeWorkspace?.length, 3); assert.equal(op.afterWorkspace?.length, 3);
    assert.equal(await readFile(join(root, 'sdk', 'change.txt'), 'utf8'), 'changed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('settlement reuses fresh explicit checks but reruns after actual external source changes', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent'), counter = join(root, 'count.txt');
  await workspace.exclusive(() => workspace.addCheck({ id: 'real-check', repo: 'library', argv: [process.execPath, '-e',
    `const fs=require('fs');const p=${JSON.stringify(counter)};fs.writeFileSync(p,String((fs.existsSync(p)?Number(fs.readFileSync(p)):0)+1));if(!fs.readFileSync('index.js','utf8').includes('greet'))process.exit(2);`] }));
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
    extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' })] }); await loader.reload();
  const manager = SessionManager.create(root, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), settingsManager: settings, resourceLoader: loader, sessionManager: manager });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  try {
    faux.setResponses([fauxAssistantMessage([fauxToolCall('workspace_verify', {})], { stopReason: 'toolUse' }), fauxAssistantMessage('Actual checks passed.')]);
    await session.prompt('Run the check and finish.');
    assert.equal(await readFile(counter, 'utf8'), '1');
    assert(manager.getBranch().some(entry => entry.type === 'custom' && entry.customType === 'enigma.verification' && (entry.data as { reused?: boolean }).reused));
    let changeOnFinish = true;
    const unsubscribe = session.subscribe(event => {
      if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'stop' && changeOnFinish) {
        changeOnFinish = false;
        // This external edit races after the explicit check but before settlement revalidation.
        writeFileSync(join(root, 'library', 'index.js'), 'export function greet(){return "external";}\n');
      }
    });
    faux.setResponses([fauxAssistantMessage([fauxToolCall('workspace_verify', {})], { stopReason: 'toolUse' }), fauxAssistantMessage('Check again, then a user changes the source.')]);
    await session.prompt('Revalidate external source changes.'); unsubscribe();
    assert.equal(await readFile(counter, 'utf8'), '3', 'source changed after explicit check; settlement must rerun it');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('verification reuse remains invalid after changed rules and unknown execution effects', async () => {
  const { root, workspace } = await fixture();
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'syntax', repo: 'library', argv: [process.execPath, '--check', 'index.js'] }));
    const accepted = await workspace.exclusive(() => workspace.verify());
    assert(await workspace.exclusive(() => workspace.reusableVerification(accepted.evidence)));
    await writeJson(storePath(workspace.data, 'operations', 'unresolved'), { schema: 1, id: 'unresolved', status: 'unknown', scope: 'workspace' });
    await assert.rejects(workspace.exclusive(() => workspace.reusableVerification(accepted.evidence)), /Unknown operation/);
    await workspace.exclusive(() => workspace.acknowledgeOperation('unresolved', 'Observed all registered repositories; no effect to replay.'));
    await workspace.exclusive(() => workspace.addCheck({ id: 'stricter', repo: 'app', argv: [process.execPath, '-e', 'process.exit(2)'] }));
    assert.equal(await workspace.exclusive(() => workspace.reusableVerification(accepted.evidence)), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
