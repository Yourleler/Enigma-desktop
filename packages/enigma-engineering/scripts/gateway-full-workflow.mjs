import { homedir as userHomeDirectory } from 'node:os';
// Explicit real-model all-domain integration, before final UI acceptance.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { workflowFixture } from './workflow-fixture.mjs';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createProjectExtension } from '../dist/src/pi-project.js';
import { createRuntimeExtension } from '../dist/src/pi-runtime.js';
import { createDeliveryExtension } from '../dist/src/pi-delivery.js';
import { createReuseExtension } from '../dist/src/pi-reuse.js';
import { createCollaborationExtension } from '../dist/src/pi-collaboration.js';
import { createLearningExtension } from '../dist/src/pi-learning.js';
import { createMemoryExtension } from '../dist/src/pi-memory.js';
import { createObserverExtension } from '../dist/src/pi-observer.js';
import { configureGateway } from '../dist/src/model-config.js';
import { TaskReadingStore } from '../dist/src/task-reading.js';
import { Experiments } from '../dist/src/experiments.js';
import { Delegations } from '../dist/src/delegation.js';
import { RecipeStore } from '../dist/src/recipes.js';
import { ServiceManager } from '../dist/src/services.js';
import { BackgroundRuns } from '../dist/src/background.js';
import { TaskEvents } from '../dist/src/task-events.js';
import { Artifacts } from '../dist/src/artifacts.js';
import { TaskPackages } from '../dist/src/task-package.js';
import { readObserverStatus } from '../dist/src/observer.js';
import { hash, readJson, redact } from '../dist/src/storage.js';
import { validationBuild } from './validation-evidence.mjs';

const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/full-workflow'); await mkdir(output, { recursive: true });
const { root, workspace, material, commonChecks } = await workflowFixture(), agentDir = await configureGateway(workspace.data), modelId = process.env.ENIGMA_GATEWAY_MODEL;
const build = await validationBuild(['gateway-full-workflow.mjs', 'workflow-fixture.mjs', 'validation-evidence.mjs']), originalCriteria = hash(JSON.stringify(workspace.config.checks));
const protectedFiles = [['server', 'server.py'], ['server', 'DESIGN.md'], ['server', 'response.schema.json'], ['app', 'web.mjs'], ['app', 'USER.md'], ['sdk', 'package.json'], ['app', 'package.json']];
const protectedHashes = Object.fromEntries(await Promise.all(protectedFiles.map(async ([repo, file]) => [`${repo}:${file}`, hash(await readFile(join(root, repo, file)))])));
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false }), model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } }), manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createProjectExtension({ workspace }), createRuntimeExtension({ workspace, approval: 'auto' }), createDeliveryExtension({ workspace, pollMs: 250 }), createReuseExtension({ workspace, approval: 'auto' }), createCollaborationExtension({ workspace, approval: 'auto', agentDir }), createLearningExtension({ workspace, knowledge: true, approval: 'auto' }), createMemoryExtension({ workspace, enabled: true }), createObserverExtension({ enabled: true })] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, sessionManager: manager, resourceLoader: loader });
const tools = [], errors = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, failed: event.isError, result: event.result }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } }); await session.bindExtensions({ onError: error => errors.push(error) });
const timer = setTimeout(() => { void session.abort(); }, 900000); let report, target;
try {
  const first = session.prompt(`完成真实 Python API、JS SDK 和 JS 网页应用的三仓库 v2 迁移。先通过 skill_discover search/open 使用当前迁移技能；读资料 ${material.id}，用 schema_reading、code_trace 和 task_reading 建立入口-接口-实现-消费者-测试地图。必须保留 server.py、web.mjs、DESIGN.md、schema、USER.md、package.json 和所有原检查。仅修改 server/model.py 产生 {data:{message:"v2"}}、sdk/index.js 消费 data.message、app/index.js 输出 app:v2。建立当前任务计划。用 delegate_task 创建两个真实 Pi 独立方案（A 直接实现，B 小型显式解析函数），writeRepos=[server,sdk,app]，checks=${JSON.stringify(commonChecks)}，同一资料和标准，maxRequests=24，timeoutMs=300000。不要直接改父代码。等待、solution_experiment 创建/实际评估/比较，回读方案，选择当前通过方案并 delegate_task merge。父完整标准还包含 browser-joint，因此合并后可能暂时未验收；必须启动/重启现有服务，通过 recipe_manage 运行 serve-accept，再显式 browser_validate greeting-ui 和 workspace_verify 全部原检查。不得删除或换掉浏览器检查。重新建立或刷新任务地图，检查三仓库和需求的真实证据；登记截图/结果产物，并把基于父新证据的迁移经验留作 project_knowledge 草稿。`);
  await delay(500); const observationDuringRun = await readObserverStatus(root); assert(observationDuringRun.available);
  await first; assert.equal(errors.length, 0, JSON.stringify(errors));
  const verified = await workspace.exclusive(() => workspace.verify()); assert.equal(verified.status, 'verified', JSON.stringify(verified));
  for (const [repo, file] of protectedFiles) assert.equal(hash(await readFile(join(root, repo, file))), protectedHashes[`${repo}:${file}`], `Protected source changed: ${repo}:${file}`);
  for (const name of ['skill_discover', 'schema_reading', 'code_trace', 'task_reading', 'delegate_task', 'solution_experiment', 'recipe_manage', 'browser_validate', 'workspace_verify', 'project_knowledge']) assert(tools.some(tool => tool.tool === name && !tool.failed), `Required workflow capability unused: ${name}`);
  const experiments = await new Experiments(workspace).list(manager.getSessionId()); assert(experiments.length); const comparison = await new Experiments(workspace).report(experiments.at(-1).id, manager.getSessionId()); assert(comparison.candidates.every(candidate => candidate.status === 'passed'));
  const maps = tools.filter(tool => tool.tool === 'task_reading' && tool.result?.details?.nodes).map(tool => tool.result.details); assert(maps.length); const currentMaps = await Promise.all(maps.map(map => new TaskReadingStore(workspace).open(map.id, manager.getSessionId()))); assert(currentMaps.some(map => map.current));
  await session.prompt('/knowledge-organize');
  const snapshots = await workspace.checkpoints(), initial = snapshots.find(checkpoint => checkpoint.label === 'session baseline'); assert(initial);
  const beforeRestore = await readJson(join(workspace.data, `session-${manager.getSessionId()}.json`));
  await new ServiceManager(workspace).stop('web'); await new ServiceManager(workspace).stop('api');
  const expected = await workspace.exclusive(() => workspace.checkpoint('before explicit workflow rewind'));
  await session.prompt('/enigma-restore ' + JSON.stringify({ target: initial.id, expected: expected.id, context: true }));
  assert.equal(await readFile(join(root, 'server', 'model.py'), 'utf8'), 'def greet():\n    return {"message": "v1"}\n');
  const afterRestore = await readJson(join(workspace.data, `session-${manager.getSessionId()}.json`)); assert.equal(afterRestore.requests, beforeRestore.requests, 'A code/context restore must not reset or invent consumed requests'); assert(afterRestore.requirementEntries.length >= beforeRestore.requirementEntries.length);
  await session.prompt(`继续同一个 v2 目标。刚进行了显式代码和上下文回溯，原要求、权限和累计消耗仍保留。先 task_requirements 读取缺失原用户更新；不要重放已结束子任务。方案实验 ${comparison.experiment.id} 和实际子结果仍在，重新 report/select/preview/merge 当前通过方案，核对现在工作区。服务已停，使用现有 serve-accept 配方和真实浏览器重新完成全部原检查；重新核对过期地图和资料，不能复用旧父通过状态。`);
  const recovered = await workspace.exclusive(() => workspace.verify()); assert.equal(recovered.status, 'verified');
  const receiptDirectory = join(workspace.data, 'runs', 'workflow-event'); await mkdir(receiptDirectory, { recursive: true });
  const receiptFile = join(receiptDirectory, 'result.txt'), background = await new BackgroundRuns(workspace).start({ repo: 'app', task: manager.getSessionId(), label: 'workflow result receipt', argv: [process.execPath, '-e', 'setTimeout(()=>{require("fs").writeFileSync(process.argv[1],"WORKFLOW-9142");console.log("WORKFLOW-9142")},300)', receiptFile] });
  await session.prompt('稍后会收到已选择的后台结果。当前只确认等待；结果到达后读取真实后台输出，登记其 result.txt 为 report 产物，说明 WORKFLOW-9142 标记。不要修改任何源码或原检查。');
  await new TaskEvents(workspace).start({ task: manager.getSessionId(), entry: manager.getLeafId() ?? undefined, label: 'selected workflow result', condition: { kind: 'background', run: background.spec.id }, timeoutMs: 30000, pollMs: 250, resume: true });
  const until = Date.now() + 180000;
  while (Date.now() < until) { const artifacts = await new Artifacts(workspace).list(manager.getSessionId()); if (artifacts.some(artifact => artifact.record.origin.runtime === relative(workspace.data, receiptFile)) && session.isIdle) break; await delay(100); }
  const artifacts = await new Artifacts(workspace).list(manager.getSessionId()); assert(artifacts.some(artifact => artifact.record.origin.runtime === relative(workspace.data, receiptFile))); assert.equal(await readFile(receiptFile, 'utf8'), 'WORKFLOW-9142');
  await session.prompt(`导出此实际完成任务的 task_package，包含原资料 ${material.id}、当前父检查证据和产物。保留用户来源角色，不把子证据或历史检查当作新工作区验收。`);
  const exported = tools.filter(tool => tool.tool === 'task_package' && tool.result?.details?.directory).at(-1); assert(exported);
  target = await TaskPackages.restore(exported.result.details.directory, join(root, 'reproduced-workflow'), { writeRepos: ['server', 'sdk', 'app'], activateRuntime: true, preparePi: true });
  const reproduction = await new RecipeStore(target.workspace).run('serve-accept', {}); assert.equal(reproduction.status, 'passed', JSON.stringify(reproduction));
  const final = await workspace.exclusive(() => workspace.verify()); assert.equal(final.status, 'verified'); assert.equal(errors.length, 0, JSON.stringify(errors));
  const finalProtected = Object.fromEntries(await Promise.all(protectedFiles.map(async ([repo, file]) => [`${repo}:${file}`, hash(await readFile(join(root, repo, file)))])));
  assert.deepEqual(finalProtected, protectedHashes, 'All protected files must survive the entire restore, event and export sequence');
  await workspace.reload(); assert.equal(hash(JSON.stringify(workspace.config.checks)), originalCriteria, 'Original complete acceptance definitions must remain unchanged');
  const normalDeliveries = manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'enigma.event-delivery'); assert.equal(normalDeliveries.length, 1);
  const workers = [];
  for (const child of await new Delegations(workspace).list()) { const ended = await new Delegations(workspace).drain(child.spec.id); assert(ended.drained, `Child ${child.spec.id} did not physically exit`); workers.push({ id: child.spec.id, status: ended.status, drained: ended.drained }); }
  report = { status: 'verified', build, model: modelId, workspace: root, scope: 'Real Python/JS three-repo full domain workflow; desktop UI is a separate final gate', tools, errors, observationDuringRun, verified, recovered, final, comparison, currentMaps, artifacts, protectedHashes, finalProtected, originalCriteria, normalDeliveryMarkers: normalDeliveries.length, workers, sourcePackage: exported.result.details.directory, reproduction: { workspace: target.workspace.root, result: reproduction, session: target.piSession }, beforeRestore, afterRestore, sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText() };
} catch (error) { report = { status: 'failed', build, model: modelId, workspace: root, tools, errors, error: String(error), children: await new Delegations(workspace).list().catch(() => []), sessionFile: manager.getSessionFile() }; process.exitCode = 1; }
finally {
  clearTimeout(timer); await session.abort(); session.dispose();
  for (const ws of [workspace, target?.workspace].filter(Boolean)) { const services = new ServiceManager(ws); await services.stop('web').catch(() => {}); await services.stop('api').catch(() => {}); for (const child of await new Delegations(ws).list()) if (!child.terminal) await new Delegations(ws).cancel(child.spec.id).catch(() => {}); }
  await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json'), workspace: root }));
}
