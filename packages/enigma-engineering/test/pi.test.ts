import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createEnigmaExtension, toolNames } from '../src/pi-extension.js';
import { fixture } from './fixtures.js';
import { runProcess } from '../src/process.js';
import { collectUserNotes } from '../src/pi-session.js';

test('real Pi SDK executes registered file tools and verifies three repos; tree navigation preserves branch and actual code', async () => {
  const { root, workspace } = await fixture();
  const docsRoot = join(root, 'docs'); await mkdir(docsRoot);
  await writeFile(join(docsRoot, 'README.md'), 'Repository added during the task.\n');
  assert.equal((await runProcess(['git', 'init', '-b', 'main'], docsRoot)).status, 'passed');
  const agentDir = join(root, 'pi-agent');
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100_000, maxTokens: 2000 }] });
  modelRuntime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [createEnigmaExtension({ workspace, approval: 'auto', managed: true })] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const manager = SessionManager.create(root, join(root, 'pi-sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime, model: faux.getModel(), settingsManager: settings,
    resourceLoader: loader, sessionManager: manager, tools: toolNames });
  const errors: unknown[] = [];
  const outcomes: unknown[] = [];
  session.subscribe(event => { if (event.type === 'tool_execution_end') outcomes.push(event); });
  await session.bindExtensions({ onError: err => errors.push(err) });
  try {
    faux.setResponses([fauxAssistantMessage('Initial state inspected.')]);
    await session.prompt('Keep user requirements across branches. ' + 'user-note-marker '.repeat(2000));
    assert(!session.systemPrompt.includes('user-note-marker'), 'raw user history must not be copied into the system prompt');
    const initial = manager.getLeafId(); assert(initial);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('workspace_graph', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('repo_add', { id: 'docs', path: docsRoot, readOnly: true })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('code_trace', { query: 'greet' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([
        fauxToolCall('repo_edit', { repo: 'library', path: 'index.js', edits: [{ oldText: 'v1', newText: 'v2' }] }),
        fauxToolCall('repo_write', { repo: 'sdk', path: 'migration.txt', content: 'v2 中文\n' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('repo_run', { repo: 'app', argv: [process.execPath, '--check', 'index.js'] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Actual files changed. No registered acceptance checks; unverified.'),
    ]);
    await session.prompt('Upgrade library and sdk; check the app syntax.');
    assert((await readFile(join(root, 'library', 'index.js'), 'utf8')).includes('v2'), JSON.stringify({ outcomes, errors }, null, 2));
    assert.equal(await readFile(join(root, 'sdk', 'migration.txt'), 'utf8'), 'v2 中文\n');
    assert.equal(workspace.config.repos.length, 4);
    assert.equal(workspace.repo('docs').access, 'read');
    const oldLeaf = manager.getLeafId(); assert(oldLeaf);
    const beforeSwitchCheckpoints = await workspace.checkpoints();
    const baseline = beforeSwitchCheckpoints[0]!;
    const expected = beforeSwitchCheckpoints.at(-1)!;
    const navigation = await session.navigateTree(initial, { summarize: false }); assert.equal(navigation.cancelled, false);
    assert(manager.getEntries().some(entry => entry.id === oldLeaf));
    assert((await readFile(join(root, 'library', 'index.js'), 'utf8')).includes('v2'));
    faux.setResponses([fauxAssistantMessage('The actual v2 code remains after a context-only switch.')]);
    await session.prompt('Continue without repeating completed edits.');
    assert(manager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'enigma.actual-state'));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const statePath = join(workspace.data, `session-${manager.getSessionId()}.json`);
    const requestsBeforeRestore = JSON.parse(await readFile(statePath, 'utf8')).requests;
    await session.prompt(`/enigma-restore ${JSON.stringify({ target: baseline.id, expected: expected.id, context: true })}`);
    assert((await readFile(join(root, 'library', 'index.js'), 'utf8')).includes('v1'));
    await assert.rejects(readFile(join(root, 'sdk', 'migration.txt')), /ENOENT/);
    assert(manager.getEntries().some(entry => entry.id === oldLeaf));
    assert(manager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'enigma.restore-handoff'));
    const stateAfterRestore = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(stateAfterRestore.requests, requestsBeforeRestore);
    assert(stateAfterRestore.requirementEntries.some((id: string) => collectUserNotes(manager).get(id)?.text === 'Continue without repeating completed edits.'), JSON.stringify({ refs: stateAfterRestore.requirementEntries, notes: [...collectUserNotes(manager).values()].map(note => ({ id: note.id, text: note.text.slice(0,120) })) }));
    assert.equal(workspace.config.repos.length, 4);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'sdk', path: 'blocked.txt', content: 'must not be written' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('task_requirements', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('task_requirements', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'sdk', path: 'reviewed.txt', content: 'review complete' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Original user updates reviewed before the new edit.'),
    ]);
    await session.prompt('Continue after the rewind using all original user instructions.');
    await assert.rejects(readFile(join(root, 'sdk', 'blocked.txt')), /ENOENT/);
    assert.equal(await readFile(join(root, 'sdk', 'reviewed.txt'), 'utf8'), 'review complete');
    assert(!session.systemPrompt.includes('user-note-marker'));
    const file = manager.getSessionFile(); assert(file);
    assert(SessionManager.open(file).getEntries().some(entry => entry.id === oldLeaf));
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('Pi settlement gate corrects a premature final using actual registered checks', async () => {
  const { root, workspace } = await fixture(); const agentDir = join(root, 'agent');
  await workspace.exclusive(() => workspace.addCheck({ id: 'accept-version', repo: 'library', argv: [process.execPath, '-e',
    'if(!require("fs").readFileSync("index.js","utf8").includes("v2"))process.exit(2)'] }));
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100_000, maxTokens: 2000 }] }); modelRuntime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true,
    extensionFactories: [createEnigmaExtension({ workspace, approval: 'auto', managed: true })] }); await loader.reload();
  const manager = SessionManager.create(root, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime, model: faux.getModel(), settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: toolNames });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  try {
    faux.setResponses([
      fauxAssistantMessage('Done already.'),
      fauxAssistantMessage([fauxToolCall('repo_edit', { repo: 'library', path: 'index.js', edits: [{ oldText: 'v1', newText: 'v2' }] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('The required code is now v2.'),
    ]);
    await session.prompt('Change library to v2 and pass its acceptance command.');
    assert.equal(faux.state.callCount, 3);
    assert(manager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'enigma.verification-needed'));
    const verified = manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'enigma.verification');
    const last = verified.at(-1); assert(last?.type === 'custom');
    assert.equal((last.data as { status: string }).status, 'verified');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    await workspace.exclusive(() => workspace.addCheck({ id: 'strict', repo: 'library', argv: [process.execPath, '-e', 'process.exit(1)'] }));
    const modifyChecks = `const fs=require('fs');const p=${JSON.stringify(join(workspace.data, 'workspace.json'))};const c=JSON.parse(fs.readFileSync(p,'utf8'));c.checks[1].argv=${JSON.stringify([process.execPath, '-e', 'process.exit(0)'])};fs.writeFileSync(p,JSON.stringify(c));`;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('repo_run', { repo: 'library', argv: [process.execPath, '-e', modifyChecks] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('The modified checks now pass.'),
    ]);
    await session.prompt('Exercise detection of acceptance rules changed by a host command.');
    const errorEntry = manager.getBranch().findLast(entry => entry.type === 'custom' && entry.customType === 'enigma.verification-error');
    assert(errorEntry?.type === 'custom');
    assert((errorEntry.data as { error: string }).error.includes('Acceptance commands changed'));
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('Pi file tool cannot write into a registered read-only repository', async () => {
  const { root, workspace } = await fixture('sdk'); const agentDir = join(root, 'agent');
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100_000, maxTokens: 1000 }] }); modelRuntime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true,
    extensionFactories: [createEnigmaExtension({ workspace, approval: 'auto', managed: true })] }); await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime, model: faux.getModel(), settingsManager: settings, resourceLoader: loader, tools: toolNames });
  await session.bindExtensions({});
  const before = await readFile(join(root, 'sdk', 'index.js'));
  const outcomes: boolean[] = []; session.subscribe(event => { if (event.type === 'tool_execution_end') outcomes.push(event.isError); });
  try {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'sdk', path: 'index.js', content: 'bad overwrite' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('The repository is read-only; no change was applied.'),
    ]);
    await session.prompt('Exercise a denied mutation.');
    assert.deepEqual(outcomes, [true]); assert.deepEqual(await readFile(join(root, 'sdk', 'index.js')), before);
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});
