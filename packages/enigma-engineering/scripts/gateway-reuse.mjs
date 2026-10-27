import { homedir as userHomeDirectory } from 'node:os';
// Explicit real-model opt-in; not part of ordinary CI.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fixture } from '../dist/test/fixtures.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createReuseExtension } from '../dist/src/pi-reuse.js';
import { RecipeStore } from '../dist/src/recipes.js';
import { configureSkillPaths } from '../dist/src/skill-discovery.js';
import { ServiceManager } from '../dist/src/services.js';
import { BrowserValidation } from '../dist/src/browser-validation.js';
import { PlanStore } from '../dist/src/planning.js';
import { runProcess } from '../dist/src/process.js';
import { configureGateway } from '../dist/src/model-config.js';
import { redact } from '../dist/src/storage.js';

const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/skill-recipes'); await mkdir(output, { recursive: true });
const { root, workspace } = await fixture(), services = new ServiceManager(workspace), recipes = new RecipeStore(workspace);
const skill = join(root, 'skills', 'SKILL.md'); await mkdir(join(root, 'skills'));
await writeFile(skill, '---\nname: migration-recipe\ndescription: 三仓库接口迁移、可复用任务配方与浏览器联合验收\n---\nFor this prepared workspace, inspect the promoted migration recipe. Run it with version=v2, then use the returned fresh evidence to verify the session plan. Finally propose a new draft from that verified plan. Do not alter checks or claim historical evidence is new success.\n');
await configureSkillPaths(workspace, [skill]);
await writeFile(join(root, 'library', 'migrate.mjs'), 'import{writeFileSync}from"node:fs";const version=process.argv[2];writeFileSync("index.js",`export function greet(){return ${JSON.stringify(version)}}\n`);writeFileSync("../sdk/index.js",\'import {greet} from "../library/index.js"; export function call(){return "sdk:"+greet()}\\n\');writeFileSync("../app/index.js",\'import {call} from "../sdk/index.js"; export function main(){return "app:"+call()}\\n\');');
await writeFile(join(root, 'app', 'web.mjs'), 'import{createServer}from"node:http";import{main}from"./index.js";const server=createServer((q,r)=>r.end(`<button id="go" onclick="document.querySelector(\'#out\').textContent=\'${main()}\'">Run</button><div id="out"></div>`));server.listen(0,"127.0.0.1",()=>console.log("READY: "+server.address().port));');
await services.add({ id: 'web', repo: 'app', label: 'Migration application', argv: [process.execPath, 'web.mjs'], portPrefix: 'READY: ', readiness: { type: 'http', includes: 'button' } });
await new BrowserValidation(workspace).add({ id: 'click', label: 'Migrated response', service: 'web', steps: [{ action: 'click', selector: '#go' }, { action: 'expect', selector: '#out', includes: 'app:sdk:v2' }, { action: 'screenshot', label: 'migrated' }] });
for (const [repo, method, expected] of [['library', 'greet', 'v2'], ['sdk', 'call', 'sdk:v2'], ['app', 'main', 'app:sdk:v2']]) await workspace.exclusive(() => workspace.addCheck({ id: repo, repo, joint: repo === 'app', argv: [process.execPath, '-e', `import('./index.js').then(m=>{if(m.${method}()!==${JSON.stringify(expected)})process.exit(1);console.log(m.${method}())})`] }));
await recipes.save({ id: 'migration', label: 'Three-repository migration and browser acceptance', parameters: { version: { description: 'Response version as a literal argv data value' } }, steps: [
  { id: 'migrate', kind: 'command', repo: 'library', argv: [process.execPath, 'migrate.mjs', '{{version}}'] }, { id: 'start', kind: 'service', service: 'web', action: 'start' },
  { id: 'browser', kind: 'browser', scenario: 'click' }, { id: 'stop', kind: 'service', service: 'web', action: 'stop' }, { id: 'acceptance', kind: 'verify' } ] });
const agentDir = await configureGateway(workspace.data), modelId = process.env.ENIGMA_GATEWAY_MODEL;
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false }), model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createReuseExtension({ workspace, approval: 'auto' })] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, sessionManager: manager, resourceLoader: loader });
const tools = [], errors = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, failed: event.isError, result: event.result }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } });
await session.bindExtensions({ onError: error => errors.push(error) });
const deadline = setTimeout(() => { void session.abort(); }, 240000); let report;
try {
  await session.prompt('请完成预备好的三仓库接口迁移。先使用 skill_discover 按“接口迁移”发现并 open 当前版本的技能，再 inspect migration 配方。建立当前会话的一步计划（repo=app，checks=[library,sdk,app]）覆盖整个迁移目标；用 recipe_manage 运行配方，version=v2。确认实际浏览器和原联合检查结果，再用新证据 advance 该计划并 propose 待用户确认的新配方。保留原检查，不自行编辑或推广配方，不直接重复执行已通过的脚本。最后说明真实结果和草稿局限。');
  const runs = await recipes.runs(manager.getSessionId()), successful = runs.find(run => run.status === 'passed'); assert(successful, JSON.stringify(runs));
  assert(tools.some(tool => tool.tool === 'skill_discover' && tool.result?.details?.content?.includes('For this prepared workspace')));
  assert(tools.some(tool => tool.tool === 'recipe_manage' && tool.result?.details?.origin?.plan));
  const view = await new PlanStore(workspace).view(); assert(view && view.completed === view.total && !view.gaps.length); assert.equal(errors.length, 0, JSON.stringify(errors));
  const actual = await runProcess([process.execPath, '-e', "import('./index.js').then(m=>{console.log(m.main());if(m.main()!=='app:sdk:v2')process.exit(1)})"], join(root, 'app')); assert.equal(actual.status, 'passed');
  const browser = successful.run.steps.find(step => step.kind === 'browser')?.data; assert.equal(browser?.status, 'passed'); assert(browser.screenshots.length);
  report = { status: 'verified', scope: 'Real model skill discovery/open and operator-promoted recipe execution/proposal; prepared migration script is not proof of general model coding skill', workspace: root, model: modelId, tools, errors, runs, plan: view, actual, browser, sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText(), source: await readFile(join(root, 'app', 'index.js'), 'utf8') };
} catch (error) { report = { status: 'failed', workspace: root, model: modelId, tools, errors, error: String(error), sessionFile: manager.getSessionFile() }; process.exitCode = 1; }
finally { clearTimeout(deadline); await services.stop('web').catch(() => {}); session.dispose(); await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json'), workspace: root })); }
