import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fixture } from '../dist/test/fixtures.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createProjectExtension } from '../dist/src/pi-project.js';
import { ProjectContext } from '../dist/src/project-context.js';
import { TaskReadingStore } from '../dist/src/task-reading.js';
import { configureGateway } from '../dist/src/model-config.js';
import { redact } from '../dist/src/storage.js';

// Explicit real-model acceptance; the source fixture and all resulting evidence remain inspectable.
const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/project-reading-phase1');
await mkdir(output, { recursive: true });
const { root, workspace } = await fixture();
const module = (name, dependencies = '') => `module example.test/${name}\n\ngo 1.24\n${dependencies}`;
await writeFile(join(root, 'library', 'go.mod'), module('library'));
await writeFile(join(root, 'library', 'greet.go'), 'package library\nfunc Greet() string { return "v1" }\n');
await writeFile(join(root, 'sdk', 'go.mod'), module('sdk', 'require example.test/library v0.0.0\nreplace example.test/library => ../library\n'));
await writeFile(join(root, 'sdk', 'sdk.go'), 'package sdk\nimport lib "example.test/library"\nfunc Call() string { return lib.Greet() }\n');
await writeFile(join(root, 'app', 'go.mod'), module('app', 'require (\nexample.test/library v0.0.0 // indirect\nexample.test/sdk v0.0.0\n)\nreplace example.test/library => ../library\nreplace example.test/sdk => ../sdk\n'));
await writeFile(join(root, 'app', 'main.go'), 'package main\nimport ("fmt"; client "example.test/sdk")\nfunc main() { fmt.Println(client.Call()) }\n');
await writeFile(join(root, 'library', 'requirements.md'), '# Go chain upgrade\nLibrary Greet must return v2. SDK Call must prefix sdk:. App must prefix app:. Final executable must print app:sdk:v2. Preserve existing JavaScript files, Go module files and user acceptance commands.\n');
const resource = await new ProjectContext(workspace).add({ title: 'Go 三仓库接口升级需求', source: { kind: 'file', repo: 'library', file: 'requirements.md' } });
const runner = join(workspace.data, 'check-go.mjs');
await writeFile(runner, `import {execFileSync} from 'node:child_process';const text=execFileSync('go',['run','.'],{cwd:${JSON.stringify(join(root, 'app'))},env:{...process.env,GOPROXY:'off',GOSUMDB:'off',GOTOOLCHAIN:'local',GOWORK:'off'}}).toString().trim();if(text!=='app:sdk:v2')throw new Error('Actual Go output: '+text);console.log(text);`);
await workspace.exclusive(async () => {
  await workspace.addCheck({ id: 'library-go', repo: 'library', argv: ['go', 'test', './...'] });
  await workspace.addCheck({ id: 'sdk-go', repo: 'sdk', argv: ['go', 'test', './...'] });
  await workspace.addCheck({ id: 'joint-go', repo: 'app', joint: true, argv: [process.execPath, runner] });
});
const baseline = await workspace.exclusive(() => workspace.checkpoint('Go v1 baseline'));
const agentDir = await configureGateway(workspace.data), modelId = process.env.ENIGMA_MODEL ?? 'gateway-gpt-6-1-sol';
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false });
const model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createProjectExtension({ workspace })] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, resourceLoader: loader, sessionManager: manager });
const errors = [], tools = [];
session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, error: event.isError, data: event.result?.structuredContent ?? event.result?.details }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } });
await session.bindExtensions({ onError: error => errors.push(error) });
const timeout = setTimeout(() => { process.stderr.write('Project reading acceptance timed out; cancelling.\n'); void session.abort(); }, 300000);
let report;
try {
  await session.prompt(`Complete a real three-Go-repository upgrade using the existing approved tools. First use project_context search/read to read resource ${resource.id}, then workspace_graph and code_trace for Greet in library. `
    + 'Implement the exact requirements in library/greet.go, sdk/sdk.go and app/main.go, preserving all other source and Go module files. Run workspace_verify and inspect actual checks. '
    + `Then use task_reading build with input JSON: goal, baseline="${baseline.id}", queries=[{"symbol":"Greet","repo":"library"},{"symbol":"Call","repo":"sdk"},{"symbol":"main","repo":"app"}], resources=["${resource.id}"], expectedFiles for the three Go files, requirements=[{"id":"output","text":"Executable prints app:sdk:v2","checks":["joint-go"]}], maxQueries=6. `
    + 'Inspect the returned map/source anchors and call task_reading annotate to add one source-cited explanation and a supported/insufficient/conflict assessment of output. Finally call task_reading coverage with the real verification evidence and report what was actually checked. Never invent source anchors or treat the map as runtime proof.');
  const verification = await workspace.exclusive(() => workspace.verify());
  assert.equal(verification.status, 'verified', JSON.stringify(verification)); assert.equal(errors.length, 0, JSON.stringify(errors));
  for (const name of ['project_context', 'code_trace', 'task_reading', 'workspace_verify']) assert(tools.some(tool => tool.tool === name && !tool.error), `Missing successful tool ${name}`);
  const entry = manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'enigma.task-reading').at(-1); assert(entry);
  const reading = await new TaskReadingStore(workspace).open(entry.data.id, manager.getSessionId());
  assert(reading.current); assert(reading.report.insights.length > 0); assert.equal(reading.report.unexpected.length, 0);
  const coverage = await new TaskReadingStore(workspace).coverage(reading.report.id, verification.evidence, manager.getSessionId());
  assert.equal(coverage.requirements[0]?.checksPassed, true); assert.equal(coverage.requirements[0]?.status, 'supported');
  assert.equal(await readFile(join(root, 'library', 'index.js'), 'utf8'), 'export function greet() { return "v1"; }\n');
  report = { status: 'verified', model: modelId, workspace: root, baseline: baseline.id, sessionFile: manager.getSessionFile(), tools, errors, verification, reading, coverage,
    answer: session.getLastAssistantText(), limits: ['One real three-module case; broad Go build-tag/runtime behavior and the remaining Goal phases still require acceptance.'] };
} catch (error) {
  report = { status: 'failed', error: String(error), model: modelId, workspace: root, sessionFile: manager.getSessionFile(), tools, errors }; process.exitCode = 1;
} finally {
  clearTimeout(timeout); session.dispose();
  await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets));
  console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json'), workspace: root, tools: tools.length }));
}
