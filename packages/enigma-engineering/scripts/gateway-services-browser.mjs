import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { crossLanguageFixture } from '../dist/test/cross-language-fixtures.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createProjectExtension } from '../dist/src/pi-project.js';
import { createRuntimeExtension } from '../dist/src/pi-runtime.js';
import { ServiceManager } from '../dist/src/services.js';
import { BrowserValidation } from '../dist/src/browser-validation.js';
import { configureGateway } from '../dist/src/model-config.js';
import { redact } from '../dist/src/storage.js';

const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/services-browser'); await mkdir(output, { recursive: true });
const { root, workspace } = await crossLanguageFixture(), services = new ServiceManager(workspace), browser = new BrowserValidation(workspace);
const python = process.env.ENIGMA_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const serverPath = join(root, 'server', 'server.py'), original = await readFile(serverPath, 'utf8');
await writeFile(serverPath, original.replace('print(server.server_address[1], flush=True)', 'print("READY: " + str(server.server_address[1]), flush=True)'));
await writeFile(join(root, 'app', 'web.mjs'), 'import{createServer}from"node:http";import{display}from"./index.js";const html=`<button id="go">Load</button><div id="out"></div><script>document.querySelector("#go").onclick=async()=>document.querySelector("#out").textContent=await(await fetch("/value")).text()</script>`;const s=createServer(async(q,r)=>{try{r.setHeader("Content-Type",q.url==="/value"?"text/plain":"text/html");r.end(q.url==="/value"?await display(process.env.API_URL):html)}catch(e){r.statusCode=500;r.end(String(e))}});s.listen(0,"127.0.0.1",()=>console.log("READY: "+s.address().port));');
await services.add({ id: 'api', repo: 'server', label: 'Python API', argv: [python, '-u', 'server.py'], portPrefix: 'READY: ', readiness: { type: 'http', path: '/greet', includes: 'message' } });
await services.add({ id: 'web', repo: 'app', label: 'JS application', argv: [process.execPath, 'web.mjs'], dependsOn: ['api'], envFromServices: { API_URL: { service: 'api', value: 'url' } }, portPrefix: 'READY: ', readiness: { type: 'http', includes: 'button' } });
await browser.add({ id: 'greeting-ui', label: 'Live UI acceptance', service: 'web', steps: [{ action: 'click', selector: '#go' }, { action: 'expect', selector: '#out', includes: 'app:v2' }, { action: 'screenshot', label: 'greeting' }] });
await workspace.exclusive(async () => {
  await workspace.addCheck({ id: 'python-syntax', repo: 'server', argv: [python, '-I', '-c', 'import ast,pathlib;ast.parse(pathlib.Path("model.py").read_text())'] });
  await workspace.addCheck({ id: 'sdk-syntax', repo: 'sdk', argv: [process.execPath, '--check', 'index.js'] });
  await workspace.addCheck({ id: 'app-syntax', repo: 'app', argv: [process.execPath, '--check', 'index.js'] });
  await workspace.addCheck({ id: 'browser-joint', repo: 'app', joint: true, argv: [process.execPath, resolve('dist/src/cli.js'), '--workspace', root, 'browser', 'run', 'greeting-ui'], timeoutMs: 30000 });
});
const agentDir = await configureGateway(workspace.data), modelId = process.env.ENIGMA_MODEL ?? 'gateway-gpt-6-1-sol';
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false }), model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createProjectExtension({ workspace }), createRuntimeExtension({ workspace, approval: 'auto' })] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, resourceLoader: loader, sessionManager: manager });
const tools = [], errors = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, failed: event.isError }); process.stderr.write(event.toolName + ': ' + (event.isError ? 'failed' : 'completed') + '\n'); } });
await session.bindExtensions({ onError: error => errors.push(error) });
const timer = setTimeout(() => { void session.abort(); }, 300000); let report;
try {
  await session.prompt('Complete a real Python service, JS SDK and JS application migration. Inspect registered repositories/contracts and existing launch/scenario configuration. '
    + 'Change only server/model.py to return {"data":{"message":"v2"}}, sdk/index.js getGreeting to consume data.message, and app/index.js display to prefix app:. Preserve server.py, web.mjs, module files, all launch settings, browser scenario and registered acceptance rules. '
    + 'Use service_manage to start the existing web service and its dependency. Run browser_validate greeting-ui to exercise the actual webpage, then workspace_verify for all registered syntax and joint browser checks. '
    + 'Report actual source changes, ready services and physical browser screenshot/trace evidence. Do not change acceptance configuration or replace the UI check with a text-only assertion.');
  const verification = await workspace.exclusive(() => workspace.verify()); assert.equal(verification.status, 'verified', JSON.stringify(verification));
  assert.equal(errors.length, 0, JSON.stringify(errors)); assert(tools.some(tool => tool.tool === 'service_manage' && !tool.failed)); assert(tools.some(tool => tool.tool === 'browser_validate' && !tool.failed));
  const scenario = await browser.run('greeting-ui'); assert.equal(scenario.status, 'passed', JSON.stringify(scenario)); assert(scenario.trace && scenario.screenshots.length);
  report = { status: 'verified', model: modelId, workspace: root, tools, errors, verification, browser: scenario, services: await services.list(), sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText() };
} catch (error) { report = { status: 'failed', model: modelId, workspace: root, tools, errors, error: String(error), sessionFile: manager.getSessionFile() }; process.exitCode = 1; }
finally { clearTimeout(timer); session.dispose(); await services.stop('web').catch(() => {}); await services.stop('api').catch(() => {}); await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, workspace: root, report: join(output, 'report.json'), tools: tools.length })); }
