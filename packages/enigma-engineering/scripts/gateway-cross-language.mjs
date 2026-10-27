import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { crossLanguageFixture } from '../dist/test/cross-language-fixtures.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createObserverExtension } from '../dist/src/pi-observer.js';
import { configureGateway } from '../dist/src/model-config.js';
import { readObserverStatus } from '../dist/src/observer.js';

// Explicit opt-in real model validation. Never run in ordinary CI.
const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/gateway-cross-language');
await mkdir(output, { recursive: true });
const { root, workspace } = await crossLanguageFixture();
const agentDir = await configureGateway(workspace.data);
const modelId = process.env.ENIGMA_GATEWAY_MODEL;
const python = process.env.ENIGMA_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const runner = join(workspace.data, 'joint-check.mjs');
const helpers = pathToFileURL(resolve('dist/test/cross-language-fixtures.js')).href;
await writeFile(runner, `import {actualGreeting} from ${JSON.stringify(helpers)};const result=await actualGreeting(${JSON.stringify(root)});if(result!=='app:v2')throw new Error('Expected app:v2, received '+result);console.log(result);`);
await workspace.exclusive(async () => {
  await workspace.addCheck({ id: 'server-syntax', repo: 'server', argv: [python, '-I', '-c', 'import ast,pathlib;ast.parse(pathlib.Path("model.py").read_text());ast.parse(pathlib.Path("server.py").read_text())'] });
  await workspace.addCheck({ id: 'sdk-syntax', repo: 'sdk', argv: [process.execPath, '--check', 'index.js'] });
  await workspace.addCheck({ id: 'app-syntax', repo: 'app', argv: [process.execPath, '--check', 'index.js'] });
  await workspace.addCheck({ id: 'joint-http', repo: 'app', joint: true, argv: [process.execPath, runner], timeoutMs: 30000 });
});
const manifest = join(workspace.repo('server').root, '.enigma-contracts.json');
const contracts = JSON.parse(await readFile(manifest, 'utf8')); contracts.contracts[0].checks = ['joint-http']; await writeFile(manifest, JSON.stringify(contracts));
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false });
const model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  extensionFactories: [createObserverExtension({ enabled: true }), createEnigmaExtension({ workspace, managed: true, approval: 'auto' })] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, resourceLoader: loader, sessionManager: manager });
const errors = [], tools = [];
session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, isError: event.isError }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } });
await session.bindExtensions({ onError: error => errors.push(error) });
const timeout = setTimeout(() => { process.stderr.write('Cross-language live probe timed out; cancelling.\n'); void session.abort(); }, 300000);
try {
  await session.prompt('Complete this real three-repository HTTP API migration. Inspect workspace_graph and workspace_contracts to identify the Python service, JS SDK and JS application. '
    + 'Use code_trace to find the Python greet function and its aliased caller. Create a task_plan for the three repositories with their registered checks and necessary dependencies. '
    + 'Change server/model.py so greet() returns {"data":{"message":"v2"}}. Keep the existing Python HTTP route. '
    + 'Change sdk/index.js getGreeting(baseURL) to read data.message from the response. Change app/index.js display(baseURL) to prefix the result with "app:". '
    + 'Preserve the relative imports, source mapping and user-defined acceptance commands. Run workspace_verify and use actual evidence to mark plan steps verified in dependency order. '
    + 'Report source locations, contract confidence and real joint check result. Static routes alone are not runtime proof.');
  const verification = await workspace.exclusive(() => workspace.verify());
  assert.equal(verification.status, 'verified', JSON.stringify(verification));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert(tools.some(tool => tool.tool === 'workspace_contracts' && !tool.isError));
  assert(tools.some(tool => tool.tool === 'code_trace' && !tool.isError));
  assert(tools.some(tool => tool.tool === 'task_plan' && !tool.isError));
  const observer = await readObserverStatus(root);
  const report = { kind: 'real-model-cross-language-validation', model: modelId, api: 'openai-responses', workspace: root, tools, errors, verification,
    observer, sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText(), limitations: ['one controlled live coding task, not general success-rate evidence', 'cross-service static links require real checks'] };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: join(output, 'report.json'), workspace: root, tools: tools.length, status: verification.status }));
} finally { clearTimeout(timeout); session.dispose(); }
