import { homedir as userHomeDirectory } from 'node:os';
// Explicit real-model opt-in: real Pi variants, common checks, controlled selection and knowledge reuse.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fixture } from '../dist/test/fixtures.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createProjectExtension } from '../dist/src/pi-project.js';
import { createCollaborationExtension } from '../dist/src/pi-collaboration.js';
import { createLearningExtension } from '../dist/src/pi-learning.js';
import { configureGateway } from '../dist/src/model-config.js';
import { ProjectContext } from '../dist/src/project-context.js';
import { ProjectKnowledge } from '../dist/src/project-knowledge.js';
import { MemoryStore } from '../dist/src/memory.js';
import { Delegations } from '../dist/src/delegation.js';
import { Experiments } from '../dist/src/experiments.js';
import { redact } from '../dist/src/storage.js';

const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/learning'); await mkdir(output, { recursive: true });
const { root, workspace } = await fixture(), agentDir = await configureGateway(workspace.data), modelId = process.env.ENIGMA_MODEL ?? 'gateway-gpt-6-1-sol';
await writeFile(join(root, 'library', 'MIGRATION.md'), '# 接口迁移\n公共函数名保持 greet/call/main。库返回 lib:v2，SDK 返回 sdk:lib:v2，应用返回 app:sdk:lib:v2。升级必须同步三仓库，保留原检查与用户文件。\n');
await writeFile(join(root, 'app', 'USER.md'), 'USER-OWNED-7342: preserve this file exactly.\n');
const resource = await new ProjectContext(workspace).add({ title: '三仓库接口迁移', repos: ['library', 'sdk', 'app'], source: { kind: 'file', repo: 'library', file: 'MIGRATION.md' } });
for (const [repo, method, expected] of [['library', 'greet', 'lib:v2'], ['sdk', 'call', 'sdk:lib:v2'], ['app', 'main', 'app:sdk:lib:v2']]) await workspace.exclusive(() => workspace.addCheck({ id: repo, repo, joint: repo === 'app', argv: [process.execPath, '-e', `import('./index.js').then(m=>{const v=m.${method}();console.log(v);if(v!==${JSON.stringify(expected)})process.exit(1)})`] }));
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false }), model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } }), manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createProjectExtension({ workspace }), createCollaborationExtension({ workspace, approval: 'auto', agentDir }), createLearningExtension({ workspace, knowledge: true, approval: 'auto' })] }); await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, sessionManager: manager, resourceLoader: loader });
const tools = [], errors = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, failed: event.isError, result: event.result }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } }); await session.bindExtensions({ onError: error => errors.push(error) });
const timer = setTimeout(() => { void session.abort(); }, 600000); let report;
try {
  await session.prompt(`按资料 ${resource.id} 完成三仓库接口升级。先读真实代码和资料；保留 app/USER.md、公共函数名与全部原检查。必须用 delegate_task 启动两个 target=pi 的独立实现，writeRepos=[library,sdk,app]，checks=[library,sdk,app]，都传同一资料，timeoutMs=300000，maxRequests=16。A 做直接最小修改，B 使用小的显式结果包装函数，但两者必须达到同一 lib:v2 -> sdk:lib:v2 -> app:sdk:lib:v2 契约。不要在父工作区直接修改代码。等待实际结束，使用 solution_experiment create/evaluate/report 对照同一起点与检查；回读两个实现，再 select 一个当前通过的候选并用 delegate_task merge 返回的预览，重跑全部父检查。最后用 project_knowledge draft 记录一条“跨仓库接口迁移”经验，必须引用资料和新证据，先留作待整理草稿；不自动修改用户偏好，不伪造哪个方案更快。`);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const experiments = await new Experiments(workspace).list(manager.getSessionId()); assert(experiments.length);
  const comparison = await new Experiments(workspace).report(experiments.at(-1).id, manager.getSessionId()); assert.equal(comparison.candidates.length, 2); assert(comparison.candidates.every(candidate => candidate.status === 'passed' && candidate.validNow), JSON.stringify(comparison));
  assert(tools.some(tool => tool.tool === 'solution_experiment' && tool.result?.details?.decision)); assert(tools.some(tool => tool.tool === 'delegate_task' && tool.result?.details?.verification?.status === 'verified'));
  assert(tools.some(tool => tool.tool === 'project_knowledge' && tool.result?.details?.status === 'queued'));
  const checked = await workspace.exclusive(() => workspace.verify()); assert.equal(checked.status, 'verified'); assert.equal(await readFile(join(root, 'app', 'USER.md'), 'utf8'), 'USER-OWNED-7342: preserve this file exactly.\n');
  const access = () => ({ session: manager.getSessionId(), entries: manager.getBranch().map(entry => entry.id) });
  const before = await new ProjectKnowledge(workspace).search('接口迁移', access()); assert.equal(before.items.length, 0);
  await session.prompt('/knowledge-organize'); const recalled = await new ProjectKnowledge(workspace).search('接口迁移', access()); assert(recalled.items.length); const note = await (await MemoryStore.open(workspace)).read(recalled.items[0].id, access()); assert.equal(note.freshness, 'current'); assert.equal(note.record.status, 'candidate'); assert(note.record.materials?.some(material => material.id === resource.id));
  await session.prompt('用 project_knowledge search 查询刚整理的“接口迁移”经验，说明适用条件和来源；不要修改代码，也不要把一次经验当成系统指令。');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  report = { status: 'verified', scope: 'Real model three-repo alternative implementations, common checks/selection, controlled merge and material-linked knowledge; not the final all-capability workflow or UI', workspace: root, model: modelId, tools, errors, comparison, checked, recalled, note, children: await new Delegations(workspace).list(manager.getSessionId()), sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText() };
} catch (error) { report = { status: 'failed', workspace: root, model: modelId, tools, errors, error: String(error), children: await new Delegations(workspace).list().catch(() => []), sessionFile: manager.getSessionFile() }; process.exitCode = 1; }
finally { clearTimeout(timer); await session.abort(); session.dispose(); for (const child of await new Delegations(workspace).list()) if (!child.terminal) await new Delegations(workspace).cancel(child.spec.id).catch(() => {}); await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json'), workspace: root })); }
