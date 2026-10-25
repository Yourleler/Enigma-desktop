import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createEnigmaExtension, toolNames } from '../src/pi-extension.js';
import { CONTEXT_CHECKPOINT, MODEL_REWIND, contextCheckpoints, prepareContextRewind } from '../src/context-rewind.js';
import { fixture } from './fixtures.js';

test('model-initiated context rewind continues one prompt with its lesson, retains files and original checks, and removes the detour only from model context', async () => {
  const { root, workspace } = await fixture();
  const agentDir = join(root, 'agent'), manager = SessionManager.create(root, join(root, 'sessions'));
  await workspace.addCheck({ id: 'joint', repo: 'app', argv: [process.execPath, '--input-type=module', '-e', 'import {main} from "./index.js";if(main()!=="v2")process.exit(1);console.log("JOINT_OK")'], joint: true });
  const checks = JSON.stringify(workspace.config.checks);
  const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 1000 }] }); runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true,
    extensionFactories: [createEnigmaExtension({ workspace, approval: 'auto', managed: true })] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: toolNames });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  const outcomes: unknown[] = [];
  session.subscribe(event => { if (event.type === 'tool_execution_end') outcomes.push({ tool: event.toolName, error: event.isError, result: event.result }); });
  const tool = (name: string, args: Parameters<typeof fauxToolCall>[1], text?: string) => fauxAssistantMessage([...(text ? [{ type: 'text' as const, text }] : []), fauxToolCall(name, args)], { stopReason: 'toolUse' });
  let resumed = false;
  try {
    faux.setResponses([
      tool('repo_write', { repo: 'sdk', path: 'completed.txt', content: 'KEEP_COMPLETED_FILE\n' }),
      tool('repo_edit', { repo: 'library', path: 'index.js', edits: [{ oldText: 'v1', newText: 'wrong' }] }, 'DETOUR_ONLY_TOKEN'),
      tool('workspace_verify', {}),
      tool('time_machine', { action: 'list' }),
      () => tool('time_machine', { action: 'rewind', checkpoint: contextCheckpoints(manager)[0]!.id,
        reason: 'The wrong return value fails the existing joint check.', lesson: 'LESSON_KEEP_FILES: completed.txt already exists; change the actual wrong value to v2.', nextStep: 'Read current source and repair the failed value without repeating completed writes.' }),
      async context => {
        const visible = JSON.stringify(context.messages);
        assert(visible.includes('ORIGINAL_REQUIREMENT_KEEP_JOINT'));
        assert(visible.includes('LESSON_KEEP_FILES'));
        assert(!visible.includes('DETOUR_ONLY_TOKEN'));
        assert.equal(await readFile(join(root, 'sdk', 'completed.txt'), 'utf8'), 'KEEP_COMPLETED_FILE\n');
        assert((await readFile(join(root, 'library', 'index.js'), 'utf8')).includes('wrong'));
        resumed = true; return tool('repo_read', { repo: 'library', file: 'index.js' });
      },
      tool('repo_edit', { repo: 'library', path: 'index.js', edits: [{ oldText: 'wrong', newText: 'v2' }] }),
      tool('workspace_verify', {}),
      fauxAssistantMessage('Recovered and completed the original v2 task.'),
    ]);
    await session.prompt('ORIGINAL_REQUIREMENT_KEEP_JOINT: return v2 across all three repos; keep the existing joint check and completed files.');
    assert(resumed, JSON.stringify({ errors, outcomes, calls: faux.state.callCount, last: session.getLastAssistantText() })); assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(JSON.stringify(workspace.config.checks), checks);
    const state = JSON.parse(await readFile(join(workspace.data, `session-${manager.getSessionId()}.json`), 'utf8'));
    assert.equal(state.lastVerification, 'verified'); assert.equal(faux.state.callCount, 9);
    const rewinds = manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === MODEL_REWIND);
    assert.equal(rewinds.length, 1);
    assert(manager.getEntries().some(entry => entry.type === 'message' && JSON.stringify(entry.message).includes('DETOUR_ONLY_TOKEN')));
    assert(!JSON.stringify(manager.buildSessionProjection().messages).includes('DETOUR_ONLY_TOKEN'));
    assert.equal(manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'user').length, 1, 'Continuation must not manufacture a new user command');
    assert.equal((rewinds[0] as any).data.codeRestored, false);
    assert.equal(state.requests, (rewinds[0] as any).data.requests, 'Context rewind must preserve the recorded request accounting');
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('context rewind rejects another branch or a checkpoint before compaction and preserves newer user input', () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: 'user', content: 'original goal', timestamp: 1 });
  const early = manager.appendCustomEntry(CONTEXT_CHECKPOINT, { session: manager.getSessionId(), label: 'early', request: 1 });
  const oldAnswer = manager.appendMessage(fauxAssistantMessage('old route'));
  manager.appendCompaction('existing summary', oldAnswer, 10);
  const current = manager.appendCustomEntry(CONTEXT_CHECKPOINT, { session: manager.getSessionId(), label: 'current', request: 2 });
  const failed = manager.appendMessage(fauxAssistantMessage('bad route'));
  const latestUser = manager.appendMessage({ role: 'user', content: 'new user constraint must survive', timestamp: 2 });
  const input = { checkpoint: early, reason: 'reason', lesson: 'lesson', nextStep: 'next' };
  assert.throws(() => prepareContextRewind(manager, input), /current compaction/);
  const prepared = prepareContextRewind(manager, { ...input, checkpoint: current });
  assert(prepared.omittedEntries.includes(failed)); assert(prepared.preservedUserEntries.includes(latestUser));
  assert(!prepared.omittedEntries.includes(latestUser));
  const abandoned = manager.getLeafId()!;
  manager.branch(current);
  assert.throws(() => prepareContextRewind(manager, { ...input, checkpoint: abandoned }), /surviving/);
});
