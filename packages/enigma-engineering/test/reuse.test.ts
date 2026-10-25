import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { SkillDiscovery, configureSkillPaths, loadNativeSkills, skillPaths } from '../src/skill-discovery.js';
import { RecipeStore, type RecipeInput } from '../src/recipes.js';
import { PlanStore } from '../src/planning.js';
import { ServiceManager } from '../src/services.js';
import { BrowserValidation } from '../src/browser-validation.js';
import { createEnigmaExtension } from '../src/pi-extension.js';
import { createReuseExtension } from '../src/pi-reuse.js';
import { fixture } from './fixtures.js';
import { writeJson } from '../src/storage.js';

test('native skill discovery preserves manual-only semantics, Chinese search, version changes and read-only repository grants', async () => {
  const { root, workspace } = await fixture('library');
  try {
    const skills = join(root, 'library', 'skills'); await mkdir(join(skills, 'migration'), { recursive: true }); await mkdir(join(skills, 'manual'));
    const source = join(skills, 'migration', 'SKILL.md');
    await writeFile(source, '---\nname: migration\ndescription: 跨仓库接口迁移与联合验收\n---\nRead the actual contract before editing.\n');
    await writeFile(join(skills, 'manual', 'SKILL.md'), '---\nname: manual\ndescription: 跨仓库迁移的人工操作\ndisable-model-invocation: true\n---\nUser-selected only.\n');
    await configureSkillPaths(workspace, [skills]);
    const discovery = new SkillDiscovery(() => skillPaths(workspace).then(activePaths => loadNativeSkills(workspace, { activePaths })));
    const search = await discovery.search('接口迁移'); assert.equal(search.skills.length, 1); assert.equal(search.skills[0]?.name, 'migration');
    const selected = search.skills[0]!; assert((await discovery.open(selected.id, selected.version)).content.includes('actual contract'));
    const manual = (await discovery.search('', { includeManual: true })).skills.find(skill => skill.name === 'manual')!;
    await assert.rejects(discovery.open(manual.id, manual.version), /Manual-only/);
    await writeFile(source, '---\nname: migration\ndescription: 新版接口迁移\n---\nChanged procedure.\n');
    await assert.rejects(discovery.open(selected.id, selected.version), /changed/);
    assert((await discovery.search('新版')).skills.some(skill => skill.name === 'migration'));
    assert.equal(workspace.repo('library').access, 'read');
    await assert.rejects(workspace.exclusive(() => workspace.mutate('library', 'write', () => writeFile(source, 'bypass'))), /read-only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('recipe uses literal argv data, real service/browser actions and original joint acceptance, then invalidates changed evidence', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), recipes = new RecipeStore(workspace), services = new ServiceManager(workspace);
  const value = 'hello; $(touch injected.txt) `touch injected.txt`';
  try {
    await writeFile(join(root, 'app', 'web.mjs'), 'import{createServer}from"node:http";const server=createServer((q,r)=>r.end(`<button id="go" onclick="document.querySelector(\'#out\').textContent=\'done\'">Go</button><div id="out"></div>`));server.listen(0,"127.0.0.1",()=>console.log("READY: "+server.address().port));');
    await services.add({ id: 'web', repo: 'app', label: 'recipe UI', argv: [process.execPath, 'web.mjs'], portPrefix: 'READY: ', readiness: { type: 'http', includes: 'button' } });
    await new BrowserValidation(workspace).add({ id: 'click', label: 'Real click', service: 'web', steps: [{ action: 'click', selector: '#go' }, { action: 'expect', selector: '#out', includes: 'done' }] });
    await workspace.exclusive(() => workspace.addCheck({ id: 'literal', repo: 'library', joint: true, argv: [process.execPath, '-e', `if(require('node:fs').readFileSync('result.txt','utf8')!==${JSON.stringify(value)})process.exit(1)`] }));
    const input: RecipeInput = { id: 'migration', label: 'Parameterized migration', parameters: { message: { description: 'Literal text' } }, steps: [
      { id: 'write', kind: 'command', repo: 'library', argv: [process.execPath, '-e', "require('node:fs').writeFileSync('result.txt',process.argv[1])", '--', '{{message}}'] },
      { id: 'launch', kind: 'service', service: 'web', action: 'start' }, { id: 'ui', kind: 'browser', scenario: 'click' },
      { id: 'stop', kind: 'service', service: 'web', action: 'stop' }, { id: 'acceptance', kind: 'verify' } ] };
    const definition = await recipes.save(input), run = await recipes.run(input.id, { message: value }, { task: 'task-a', expectedVersion: definition.version });
    assert.equal(run.status, 'passed', JSON.stringify(run)); assert(run.current); assert.equal(run.run.steps.length, 5);
    assert.equal(await readFile(join(root, 'library', 'result.txt'), 'utf8'), value); await assert.rejects(access(join(root, 'library', 'injected.txt')), /ENOENT/);
    assert((await workspace.operations()).some(operation => operation.scope === 'workspace' && operation.status === 'settled'));
    await assert.rejects(recipes.readRun(run.run.id, 'task-b'), /ownership/);
    await assert.rejects(recipes.save(input), /current revision/);
    await recipes.save({ ...input, label: 'Revised procedure' }, definition.revision);
    assert.equal((await recipes.readRun(run.run.id)).current, false);
    await assert.rejects(recipes.run(input.id, { message: value }, { expectedVersion: definition.version }), /changed/);
    await assert.rejects(recipes.save({ ...input, id: 'unsafe', steps: [{ id: 'code', kind: 'command', repo: 'library', argv: [process.execPath, '-e', '{{message}}'] }, { id: 'acceptance', kind: 'verify' }] }), /inline code/);
    await assert.rejects(recipes.save({ ...input, id: 'embedded', steps: [{ id: 'code', kind: 'command', repo: 'library', argv: ['echo', 'prefix{{message}}'] }, { id: 'acceptance', kind: 'verify' }] }), /whole argv/);
    await assert.rejects(recipes.save({ ...input, id: 'shell-code', steps: [{ id: 'code', kind: 'command', repo: 'library', argv: ['bash', '-lc', '{{message}}'] }, { id: 'acceptance', kind: 'verify' }] }), /inline code/);
  } finally { await services.stop('web').catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('pending original requirements block recipe dispatch even with auto approval', async () => {
  const { root, workspace } = await fixture(), agentDir = join(root, 'pi-home'), manager = SessionManager.inMemory(root);
  try {
    await new RecipeStore(workspace).save({ id: 'migration', label: 'Pending requirements', steps: [{ id: 'write', kind: 'command', repo: 'library', argv: [process.execPath, '-e', "require('node:fs').writeFileSync('unreviewed.txt','wrong')"] }, { id: 'verify', kind: 'verify' }] });
    await writeJson(join(workspace.data, `session-${manager.getSessionId()}.json`), { schema: 1, requirements: ['Review the preserved original requirement before continuing.'], requirementEntries: [], reviewEntries: [], requests: 0, corrections: 0, evidence: [] });
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true,
      extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createReuseExtension({ workspace, approval: 'auto' })] }); await loader.reload();
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), settingsManager: settings, sessionManager: manager, resourceLoader: loader });
    const outcomes: string[] = []; session.subscribe(event => { if (event.type === 'tool_execution_end') outcomes.push(JSON.stringify(event)); }); await session.bindExtensions({});
    try {
      faux.setResponses([fauxAssistantMessage([fauxToolCall('recipe_manage', { action: 'run', id: 'migration' })], { stopReason: 'toolUse' }), fauxAssistantMessage('Pending requirement remains unread.')]); await session.prompt('Try the recipe.');
      assert(outcomes.some(outcome => outcome.includes('Read pending original user updates'))); await assert.rejects(access(join(root, 'library', 'unreviewed.txt')), /ENOENT/);
      assert.equal((await new RecipeStore(workspace).runs()).length, 0);
    } finally { session.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a successful plan produces a non-executable proposal with actual goals/check evidence and preserves current acceptance', async () => {
  const { root, workspace } = await fixture(), recipes = new RecipeStore(workspace), plans = new PlanStore(workspace);
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'behavior', repo: 'app', joint: true, argv: [process.execPath, '-e', "import('./index.js').then(m=>{if(m.main()!=='v1')process.exit(1)})"] }));
    const plan = await plans.create({ goal: 'Preserve application behavior', steps: [{ id: 'result', repo: 'app', goal: 'Application still returns v1', checks: ['behavior'] }] });
    await assert.rejects(recipes.propose(plan), /fully verified/);
    const checked = await workspace.exclusive(() => workspace.verify()); assert.equal(checked.status, 'verified');
    const done = await plans.advance('result', plan.revision, { phase: 'verified', evidence: checked.evidence }, plan.id);
    const proposal = await recipes.propose(done, 'task-a'); assert.deepEqual(proposal.origin.evidence, [checked.evidence]); assert.equal(proposal.goals[0]?.goal, 'Application still returns v1');
    assert.equal((await recipes.list()).length, 0); assert((await workspace.evidenceStatus(checked.evidence)).valid);
    await assert.rejects(recipes.run(proposal.input.id, {}), /Unknown recipe/);
    await recipes.save(proposal.input); assert.equal((await recipes.run(proposal.input.id, {})).status, 'passed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('recipe cancellation preserves durable receipts, rejects concurrent recipes and never dispatches the later operation', { timeout: 30_000 }, async () => {
  const { root, workspace } = await fixture(), recipes = new RecipeStore(workspace), controller = new AbortController();
  try {
    await writeFile(join(root, 'library', 'long.mjs'), 'import{writeFileSync}from"node:fs";writeFileSync("started.txt","started");setTimeout(()=>writeFileSync("escaped.txt","wrong"),10000);');
    await recipes.save({ id: 'long', label: 'Cancelable recipe', steps: [{ id: 'slow', kind: 'command', repo: 'library', argv: [process.execPath, 'long.mjs'] },
      { id: 'later', kind: 'command', repo: 'library', argv: [process.execPath, '-e', "require('node:fs').writeFileSync('later.txt','wrong')"] }, { id: 'acceptance', kind: 'verify' }] });
    const running = recipes.run('long', {}, { signal: controller.signal });
    let started = false; for (let attempt = 0; attempt < 200; attempt++) { try { await access(join(root, 'library', 'started.txt')); started = true; break; } catch { await delay(30); } }
    assert(started, 'Actual command must have started before cancellation');
    await assert.rejects(recipes.run('long', {}), /Another recipe/);
    const directories = await readdir(join(workspace.data, 'recipe-runs')); assert.equal(directories.length, 1);
    controller.abort(); const result = await running;
    assert(['cancelled', 'unknown'].includes(result.status), JSON.stringify(result)); assert.equal(result.run.steps.length, 1);
    if (result.status === 'unknown') assert((await workspace.operations()).some(operation => operation.status === 'unknown'));
    await delay(100); await assert.rejects(access(join(root, 'library', 'later.txt')), /ENOENT/); await assert.rejects(access(join(root, 'library', 'escaped.txt')), /ENOENT/);
    await assert.rejects(access(join(workspace.data, 'recipe.lock')), /ENOENT/);
  } finally { controller.abort(); await rm(root, { recursive: true, force: true }); }
});

test('Pi native catalogue and managed dispatch use the reuse plugin without bypassing recipe approval', { timeout: 30_000 }, async () => {
  const { root, workspace } = await fixture(), agentDir = join(root, 'pi-home');
  try {
    const skill = join(root, 'skills', 'SKILL.md'); await mkdir(join(root, 'skills')); await writeFile(skill, '---\nname: migration\ndescription: Multi-repository migration\n---\nRead contracts first.\n');
    await configureSkillPaths(workspace, [skill]);
    await new RecipeStore(workspace).save({ id: 'blocked', label: 'Approval check', steps: [{ id: 'write', kind: 'command', repo: 'library', argv: [process.execPath, '-e', "require('node:fs').writeFileSync('blocked.txt','wrong')"] }, { id: 'verify', kind: 'verify' }] });
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), manager = SessionManager.inMemory(root);
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createReuseExtension({ workspace, approval: 'never' })] });
    await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: faux.getModel(), settingsManager: settings, sessionManager: manager, resourceLoader: loader });
    const outcomes: { tool: string; error: boolean; text: string }[] = [], errors: unknown[] = [];
    session.subscribe(event => { if (event.type === 'tool_execution_end') outcomes.push({ tool: event.toolName, error: event.isError, text: JSON.stringify(event.result) }); });
    await session.bindExtensions({ onError: error => errors.push(error) });
    try {
      faux.setResponses([fauxAssistantMessage([fauxToolCall('skill_discover', { action: 'search', query: 'migration' })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxToolCall('recipe_manage', { action: 'run', id: 'blocked' })], { stopReason: 'toolUse' }), fauxAssistantMessage('Discovery complete; execution was denied.')]);
      await session.prompt('Discover migration skill and test denied recipe.');
      assert(outcomes.some(outcome => outcome.tool === 'skill_discover' && !outcome.error && outcome.text.includes('Read contracts') === false && outcome.text.includes('migration')), JSON.stringify(outcomes));
      assert(outcomes.some(outcome => outcome.tool === 'recipe_manage' && outcome.error && outcome.text.includes('approval')), JSON.stringify(outcomes));
      await assert.rejects(access(join(root, 'library', 'blocked.txt')), /ENOENT/); assert.deepEqual(errors, []);
    } finally { session.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
