import { homedir as userHomeDirectory } from 'node:os';
// Explicit real-model opt-in. Exercises the public Pi -> Codex -> Pi path.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fixture } from '../dist/test/fixtures.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createProjectExtension } from '../dist/src/pi-project.js';
import { createCollaborationExtension } from '../dist/src/pi-collaboration.js';
import { createDeliveryExtension } from '../dist/src/pi-delivery.js';
import { configureGateway } from '../dist/src/model-config.js';
import { Delegations } from '../dist/src/delegation.js';
import { TaskPackages } from '../dist/src/task-package.js';
import { ProjectContext } from '../dist/src/project-context.js';
import { Artifacts } from '../dist/src/artifacts.js';
import { redact } from '../dist/src/storage.js';
import { hash } from '../dist/src/storage.js';
import { Workspace } from '../dist/src/workspace.js';

const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/isolated-collaboration'); await mkdir(output, { recursive: true });
const { root, workspace } = await fixture(), agentDir = await configureGateway(workspace.data), modelId = process.env.ENIGMA_MODEL ?? 'gateway-gpt-6-1-sol';
await writeFile(join(root, 'library', 'API.md'), '# API\nThe library exports greet(), SDK exports call(), and application exports main(). Current result is v1. Document the real call chain without changing the API.\n');
const resource = await new ProjectContext(workspace).add({ title: 'Current API', source: { kind: 'file', repo: 'library', file: 'API.md' } });
await workspace.exclusive(() => workspace.addCheck({ id: 'document', repo: 'sdk', argv: [process.execPath, '-e', 'const fs=require("node:fs");const s=fs.readFileSync("DESIGN.md","utf8");for(const name of ["greet","call","main","v1"])if(!s.includes(name))process.exit(1)'] }));
await workspace.exclusive(() => workspace.addCheck({ id: 'joint', repo: 'app', joint: true, argv: [process.execPath, '-e', 'import("./index.js").then(m=>{console.log(m.main());if(m.main()!=="v1")process.exit(1)})'] }));
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false }), model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } }), manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createProjectExtension({ workspace }), createCollaborationExtension({ workspace, approval: 'auto', agentDir }), createDeliveryExtension({ workspace })] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, sessionManager: manager, resourceLoader: loader });
const tools = [], errors = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, failed: event.isError, result: event.result }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } }); await session.bindExtensions({ onError: error => errors.push(error) });
const timer = setTimeout(() => { void session.abort(); }, 300000); let report;
try {
  await session.prompt(`请在保持三个仓库所有 API 不变的前提下，为 SDK 增加 DESIGN.md。先阅读实际调用链和项目资料 ${resource.id}。必须用 delegate_task 启动 target=codex 的独立子任务，writeRepos=["sdk"]，checks=["document"]，并传入该资料；让它阅读三个仓库，说明 greet -> call -> main 和当前 v1 结果。主任务不能自行代写文档。等待子任务真实结束，读取结果，preview 再 merge 到父工作区并执行原 document、joint 检查。然后通过 task_package 导出包含该资料、文档产物和新验证证据的任务包。对子任务的声明必须回读实际文件核对；不要改源码或缩小原验收。`);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const delegates = await new Delegations(workspace).list(manager.getSessionId()); assert(delegates.some(child => child.spec.target === 'codex' && child.state.status === 'completed' && child.state.thread));
  const content = await readFile(join(root, 'sdk', 'DESIGN.md'), 'utf8'); for (const word of ['greet', 'call', 'main', 'v1']) assert(content.includes(word));
  const merge = tools.find(tool => tool.tool === 'delegate_task' && tool.result?.details?.delegation && tool.result?.details?.verification);
  assert(merge, 'Parent must use the controlled merge operation');
  const selectedChild = delegates.find(child => child.spec.id === merge.result.details.delegation); assert(selectedChild?.state.thread);
  const isolated = await Workspace.open(selectedChild.spec.workspace), childDocument = await readFile(join(isolated.repo('sdk').root, 'DESIGN.md'), 'utf8');
  assert.equal(hash(content), hash(childDocument), 'Parent document must match the actual Codex child result');
  const operations = await workspace.operations();
  for (const operation of operations.filter(operation => ['command', 'write', 'edit'].includes(operation.operation))) {
    const before = operation.beforeWorkspace?.find(repo => repo.repo.id === 'sdk') ?? (operation.before?.repo.id === 'sdk' ? operation.before : undefined);
    const after = operation.afterWorkspace?.find(repo => repo.repo.id === 'sdk') ?? (operation.after?.repo.id === 'sdk' ? operation.after : undefined);
    if (before && after) assert.equal(before.files['DESIGN.md']?.hash, after.files['DESIGN.md']?.hash, 'Parent tools must not write the document outside controlled merge');
  }
  for (const [repo, expected] of [['library', 'export function greet() { return "v1"; }\n'], ['sdk', 'import { greet } from "../library/index.js";\nexport function call() { return greet(); }\n'], ['app', 'import { call } from "../sdk/index.js";\nexport function main() { return call(); }\n']]) assert.equal(await readFile(join(root, repo, 'index.js'), 'utf8'), expected);
  const verified = await workspace.exclusive(() => workspace.verify()); assert.equal(verified.status, 'verified');
  const packages = tools.filter(tool => tool.tool === 'task_package' && tool.result?.details?.manifest?.id); assert(packages.length);
  const packageDirectory = packages.at(-1).result.details.directory;
  const restored = await TaskPackages.restore(packageDirectory, join(root, 'reproduced'), { writeRepos: ['library', 'sdk', 'app'], activateRuntime: true, task: 'reproduced' });
  const reproduced = await restored.workspace.exclusive(() => restored.workspace.verify()); assert.equal(reproduced.status, 'verified');
  report = { status: 'verified', scope: 'Actual isolated Codex subtask, source-preserving Pi result merge, original checks and task package reproduction; not the final all-capability workflow', model: modelId, workspace: root, tools, errors, delegates, document: content, documentHash: hash(content), childDocumentHash: hash(childDocument), operations, verified, packageDirectory, reproduced: { workspace: restored.workspace.root, verification: reproduced }, artifacts: await new Artifacts(workspace).list(manager.getSessionId()), sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText() };
} catch (error) { report = { status: 'failed', workspace: root, model: modelId, tools, errors, error: String(error), delegates: await new Delegations(workspace).list().catch(() => []), sessionFile: manager.getSessionFile() }; process.exitCode = 1; }
finally { clearTimeout(timer); await session.abort(); session.dispose(); for (const child of await new Delegations(workspace).list()) if (!child.terminal) await new Delegations(workspace).cancel(child.spec.id).catch(() => {}); await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json'), workspace: root })); }
