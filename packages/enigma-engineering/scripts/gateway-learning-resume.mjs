import { homedir as userHomeDirectory } from 'node:os';
// Resume only the unfinished knowledge validation from a real failed learning report.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Workspace } from '../dist/src/workspace.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createProjectExtension } from '../dist/src/pi-project.js';
import { createCollaborationExtension } from '../dist/src/pi-collaboration.js';
import { createLearningExtension } from '../dist/src/pi-learning.js';
import { ProjectKnowledge } from '../dist/src/project-knowledge.js';
import { MemoryStore } from '../dist/src/memory.js';
import { Experiments } from '../dist/src/experiments.js';
import { redact } from '../dist/src/storage.js';
const priorPath = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/learning/report.json'), prior = JSON.parse(await readFile(priorPath, 'utf8'));
const output = resolve(process.argv[3] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/learning-final'); await mkdir(output, { recursive: true });
const workspace = await Workspace.open(prior.workspace), agentDir = join(workspace.data, 'pi-agent'), manager = SessionManager.open(prior.sessionFile), modelId = prior.model;
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false }), model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: workspace.root, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true, extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createProjectExtension({ workspace }), createCollaborationExtension({ workspace, approval: 'auto', agentDir }), createLearningExtension({ workspace, knowledge: true, approval: 'auto' })] }); await loader.reload();
const { session } = await createAgentSession({ cwd: workspace.root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, sessionManager: manager, resourceLoader: loader });
const tools = [], errors = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, failed: event.isError, result: event.result }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } }); await session.bindExtensions({ onError: error => errors.push(error) });
const timer = setTimeout(() => { void session.abort(); }, 180000); let report;
try {
  const defined = await new Experiments(workspace).list(manager.getSessionId()); assert(defined.length); let comparison = await new Experiments(workspace).report(defined.at(-1).id, manager.getSessionId());
  if (!comparison.candidates.every(candidate => candidate.status === 'passed' && candidate.validNow)) comparison = await new Experiments(workspace).evaluate(defined.at(-1).id, { task: manager.getSessionId() });
  assert(comparison.candidates.every(candidate => candidate.status === 'passed' && candidate.validNow));
  await session.prompt('继续原任务尚未完成的经验整理验证。两个方案、受控选择与三仓库迁移已经通过，不要重做或修改代码。上次草稿错误引用子工作区证据，已被整理器标 stale，不要重放它。请运行 workspace_verify 取得父工作区新证据，然后用 project_knowledge draft 重新记录“接口迁移”经验，保留材料引用，evidence 只用刚取得的父证据；不要复制 comparison 的子证据编号作为父验收。');
  assert.equal(errors.length, 0, JSON.stringify(errors)); assert(tools.some(tool => tool.tool === 'project_knowledge' && tool.result?.details?.status === 'queued'));
  await session.prompt('/knowledge-organize'); const access = { session: manager.getSessionId(), entries: manager.getBranch().map(entry => entry.id) }, recalled = await new ProjectKnowledge(workspace).search('接口迁移', access); assert(recalled.items.length);
  const note = await (await MemoryStore.open(workspace)).read(recalled.items[0].id, access); assert.equal(note.freshness, 'current'); assert.equal(note.record.status, 'candidate'); assert(note.record.materials?.length);
  await session.prompt('使用 project_knowledge search 查询这条“接口迁移”经验，说明来源和适用条件；不修改代码，不把它提升为系统指令。'); assert.equal(errors.length, 0);
  const checked = await workspace.exclusive(() => workspace.verify()); assert.equal(checked.status, 'verified'); assert.equal(await readFile(join(workspace.repo('app').root, 'USER.md'), 'utf8'), 'USER-OWNED-7342: preserve this file exactly.\n');
  report = { status: 'verified', prior: priorPath, model: modelId, workspace: workspace.root, scope: 'Actual prior two-variant implementations plus resumed parent-evidence knowledge consolidation/recall; not final full workflow/UI', priorTools: prior.tools, tools, errors, comparison, checked, recalled, note, sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText() };
} catch (error) { report = { status: 'failed', prior: priorPath, workspace: workspace.root, tools, errors, error: String(error), sessionFile: manager.getSessionFile() }; process.exitCode = 1; }
finally { clearTimeout(timer); await session.abort(); session.dispose(); await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json') })); }
