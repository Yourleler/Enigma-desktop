import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { crossLanguageFixture } from '../dist/test/cross-language-fixtures.js';
import { configureGateway } from '../dist/src/model-config.js';
import { exportHandoff, inspectHandoff } from '../dist/src/handoff.js';
import { runCodexHandoff } from '../dist/src/codex-handoff.js';
import { importPiHandoff } from '../dist/src/pi-session.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';

const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/live-handoff');
await mkdir(output, { recursive: true });
const { root, workspace } = await crossLanguageFixture();
const goal = 'Using the same three-repository HTTP project background, inspect the actual Python route and JS consumers, then add sdk/HANDOFF.md documenting method/path, producer, consumer, and the response field currently read. Do not migrate the API or edit any existing source. Verify the documented facts using the actual source files.';
const first = join(root, 'to-codex');
await exportHandoff(workspace, first, { mode: 'background', goal, source: { agent: 'pi', session: 'prior-project-context', requests: 18 }, notes: [
  { role: 'user', kind: 'background', reference: 'project-brief', text: 'There are three independent repos: server is a Python HTTP producer; sdk is a JS fetch consumer; app calls the SDK. A previous task considered changing response structure, but this new task is only documentation.' },
  { role: 'source', kind: 'observation', reference: 'source-layout', text: 'Relevant entries: server/model.py and server/server.py, sdk/index.js, app/index.js. Contract manifest is in server/.enigma-contracts.json. Read actual files to establish current behavior.' },
] });
const codex = await runCodexHandoff(workspace, first, { writable: true, model: 'gateway-gpt-6-1-sol', timeoutMs: 240000 });
assert.equal(codex.report.status, 'passed', JSON.stringify(codex.report));
const artifact = await readFile(join(root, 'sdk', 'HANDOFF.md'), 'utf8'); assert(artifact.includes('/greet')); assert(artifact.toLowerCase().includes('message'));
assert((await readFile(join(root, 'server', 'model.py'), 'utf8')).includes('"v1"'));
const returning = join(root, 'to-pi');
await exportHandoff(workspace, returning, { mode: 'background', goal: 'Verify sdk/HANDOFF.md against actual source. State whether the document matches route method/path and JSON response field; do not edit source.',
  source: { agent: 'codex', session: codex.report.threadId }, notes: [{ role: 'assistant', kind: 'observation', reference: `codex:${codex.report.threadId ?? 'unavailable'}`, text: codex.report.answer ?? 'Codex prepared sdk/HANDOFF.md; verify the physical artifact.' },
    { role: 'source', kind: 'background', reference: 'sdk/HANDOFF.md', text: artifact }] });
const inspection = await inspectHandoff(workspace, returning); const imported = await importPiHandoff(workspace, inspection);
const agentDir = await configureGateway(workspace.data);
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false });
const model = runtime.getModel('gateway', 'gateway-gpt-6-1-sol'); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' })] }); await loader.reload();
const manager = SessionManager.open(imported.sessionFile);
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, sessionManager: manager, settingsManager: settings, resourceLoader: loader });
const tools = [], errors = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push(event.toolName); process.stderr.write('Pi '+event.toolName+'\n'); } });
await session.bindExtensions({ onError: error => errors.push(error) });
const timer = setTimeout(() => { void session.abort(); }, 180000);
try {
  await session.prompt('Continue only the new document verification objective from the imported context. Read the actual artifact and source through repo_read and compare.');
  assert(tools.includes('repo_read')); assert.equal(errors.length, 0, JSON.stringify(errors));
  const report = { kind: 'real-cross-agent-context-validation', workspace: root, codex: codex.report, artifact, pi: { sessionFile: manager.getSessionFile(), tools, errors, answer: session.getLastAssistantText() },
    limitation: 'Portable background import, not conversion of private histories or process state. One real task using the existing local Gateway provider.' };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ report: join(output, 'report.json'), codexThread: codex.report.threadId, piTools: tools.length }));
} finally { clearTimeout(timer); session.dispose(); }
