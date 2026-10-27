// Opt-in real model validation. It never runs as part of npm test or CI.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Workspace, createEnigmaExtension, toolNames } from '../dist/src/index.js';

const exec = promisify(execFile);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(process.argv[2] ?? join(projectRoot, '.enigma-next', 'live-validation', `gateway-${Date.now()}`));
const modelId = process.env.ENIGMA_GATEWAY_MODEL;
const agentDir = join(projectRoot, '.enigma-next', 'pi-agent');
await mkdir(root, { recursive: true });
const workspace = await Workspace.open(root);
assert.equal(workspace.config.repos.length, 0, 'Use a fresh validation directory');
for (const repo of ['library', 'sdk', 'app']) {
  const dir = join(root, repo); await mkdir(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: repo, type: 'module', dependencies: repo === 'sdk' ? { library: '*' } : repo === 'app' ? { sdk: '*' } : {} }) + '\n');
  await writeFile(join(dir, 'index.js'), repo === 'library' ? 'export function greet() { return "v1"; }\n'
    : repo === 'sdk' ? 'import { greet } from "../library/index.js";\nexport function call() { return greet(); }\n'
    : 'import { call } from "../sdk/index.js";\nexport function main() { return call(); }\n');
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await workspace.exclusive(() => workspace.addRepo(repo, dir));
}
await workspace.exclusive(async () => {
  for (const repo of workspace.config.repos) await workspace.addCheck({ id: `${repo.id}-syntax`, repo: repo.id, argv: [process.execPath, '--check', 'index.js'] });
  await workspace.addCheck({ id: 'joint-runtime', repo: 'app', joint: true, argv: [process.execPath, '-e',
    'import("./index.js").then(({show})=>{if(show()!=="v2 user")process.exit(2)}).catch(()=>process.exit(3))'] });
});
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false });
const model = runtime.getModel('gateway', modelId); assert(model, 'Gateway model must be configured');
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const resources = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true,
  noPromptTemplates: true, noThemes: true, extensionFactories: [createEnigmaExtension({ workspace, approval: 'auto', managed: true })] });
await resources.reload(); assert.deepEqual(resources.getExtensions().errors, []);
const manager = SessionManager.create(root, join(root, 'sessions'));
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low',
  settingsManager: settings, resourceLoader: resources, sessionManager: manager, tools: toolNames });
const events = []; const errors = []; let textChunks = 0;
session.subscribe(event => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') textChunks++;
  if (event.type === 'tool_execution_end') {
    events.push({ tool: event.toolName, isError: event.isError });
    process.stderr.write(`tool ${event.toolName} ${event.isError ? 'failed' : 'completed'}\n`);
  }
});
await session.bindExtensions({ onError: error => errors.push(error) });
const timer = setTimeout(() => { process.stderr.write('Live model validation timeout; cancelling.\n'); void session.abort(); }, 240_000);
try {
  await session.prompt('Complete this real three-repository API migration. Inspect workspace_graph and use code_trace to locate greet and its callers. '
    + 'In library/index.js change greet(name) to return an object with message equal to "v2 " + name. '
    + 'Update sdk/index.js so call() returns greet("user").message. '
    + 'Update app/index.js to export show() returning call(); main may be removed. '
    + 'Preserve relative imports. Modify all three source files, run the registered syntax and joint-runtime checks, and report results. Do not alter acceptance commands.');
  const checked = await workspace.exclusive(() => workspace.verify());
  const sources = Object.fromEntries(await Promise.all(workspace.config.repos.map(async repo => [repo.id, await readFile(join(repo.root, 'index.js'), 'utf8')])));
  assert.equal(checked.status, 'verified', JSON.stringify(checked));
  assert(events.some(event => event.tool === 'code_trace' && !event.isError), 'Real code reading must run');
  assert(events.some(event => event.tool === 'repo_edit' || event.tool === 'repo_write'), 'Real file tools must run');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const report = { kind: 'real-model-validation', model: modelId, provider: 'gateway', api: 'openai-responses',
    pi: '1.4.0', workspace: root, streamedTextChunks: textChunks, events, errors, verification: checked,
    finalAnswer: session.getLastAssistantText(), sources, sessionFile: manager.getSessionFile(),
    limitations: ['one real migration task; not a success-rate benchmark', 'compatibility is limited to the explicitly selected provider and model'] };
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: join(root, 'report.json'), status: checked.status, model: modelId, streamedTextChunks: textChunks, tools: events.length }));
} finally { clearTimeout(timer); session.dispose(); }
