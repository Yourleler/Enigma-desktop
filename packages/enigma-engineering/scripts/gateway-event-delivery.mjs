import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fixture } from '../dist/test/fixtures.js';
import { createEnigmaExtension } from '../dist/src/pi-extension.js';
import { createDeliveryExtension } from '../dist/src/pi-delivery.js';
import { createRuntimeExtension } from '../dist/src/pi-runtime.js';
import { BackgroundRuns } from '../dist/src/background.js';
import { TaskEvents } from '../dist/src/task-events.js';
import { configureGateway } from '../dist/src/model-config.js';
import { Artifacts } from '../dist/src/artifacts.js';
import { redact } from '../dist/src/storage.js';
import { setTimeout as delay } from 'node:timers/promises';

const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/event-delivery'); await mkdir(output, { recursive: true });
const { root, workspace } = await fixture(), agentDir = await configureGateway(workspace.data), modelId = process.env.ENIGMA_GATEWAY_MODEL;
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false }), model = runtime.getModel('gateway', modelId); assert(model);
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), manager = SessionManager.create(root, join(workspace.data, 'sessions'));
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createRuntimeExtension({ workspace, approval: 'auto' }), createDeliveryExtension({ workspace, pollMs: 250 })] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low', settingsManager: settings, sessionManager: manager, resourceLoader: loader });
const errors = [], tools = []; session.subscribe(event => { if (event.type === 'tool_execution_end') { tools.push({ tool: event.toolName, failed: event.isError }); process.stderr.write(`${event.toolName}: ${event.isError ? 'failed' : 'completed'}\n`); } });
await session.bindExtensions({ onError: error => errors.push(error) });
let report;
try {
  await session.prompt('A selected background result will arrive after this turn. For now acknowledge and wait; do not write files yet. When the event arrives, read its actual output and create sdk/RESULT.md documenting the exact result marker. Keep all API code unchanged. Register the document using artifact_manage so the user can inspect its source/version.');
  const run = await new BackgroundRuns(workspace).start({ repo: 'library', label: 'selected result', task: manager.getSessionId(), argv: [process.execPath, '-e', 'setTimeout(()=>console.log("EVENT-CONTRACT-7342"),400)'] });
  await new TaskEvents(workspace).start({ label: 'Selected result ready', task: manager.getSessionId(), entry: manager.getLeafId() ?? undefined, condition: { kind: 'background', run: run.spec.id }, resume: true, pollMs: 250, timeoutMs: 10000 });
  const deadline = Date.now() + 180000; let content;
  while (Date.now() < deadline) {
    try { content = await readFile(join(root, 'sdk', 'RESULT.md'), 'utf8'); if (content.includes('EVENT-CONTRACT-7342') && session.isIdle) break; } catch {}
    await delay(100);
  }
  assert(content?.includes('EVENT-CONTRACT-7342'));
  const artifacts = await new Artifacts(workspace).list(manager.getSessionId()); assert(artifacts.some(artifact => artifact.record.origin.file === 'RESULT.md'));
  const entries = manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'enigma.event-delivery'); assert.equal(entries.length, 1); assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(await readFile(join(root, 'library', 'index.js'), 'utf8'), 'export function greet() { return "v1"; }\n');
  report = { status: 'verified', model: modelId, workspace: root, tools, errors, deliveryMarkers: entries, artifacts, document: content, sessionFile: manager.getSessionFile(), answer: session.getLastAssistantText() };
} catch (error) { report = { status: 'failed', model: modelId, workspace: root, tools, errors, error: String(error), sessionFile: manager.getSessionFile() }; process.exitCode = 1; }
finally { session.dispose(); await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json'), workspace: root })); }
