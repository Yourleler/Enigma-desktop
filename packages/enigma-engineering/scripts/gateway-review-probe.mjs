import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { crossLanguageFixture } from '../dist/test/cross-language-fixtures.js';
import { configureGateway } from '../dist/src/model-config.js';
import { runPiReview } from '../dist/src/pi-review.js';

const directory = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/live-review');
await mkdir(directory, { recursive: true });
const { root, workspace } = await crossLanguageFixture();
const baseline = await workspace.exclusive(() => workspace.checkpoint('before response migration'));
await writeFile(join(root, 'server', 'model.py'), 'def greet():\n    return {"data": {"message": "v2"}}\n');
const before = await readFile(join(root, 'server', 'model.py'), 'utf8');
const agentDir = await configureGateway(workspace.data);
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false });
const report = await runPiReview(workspace, { baseline: baseline.id, goal: 'Change the service JSON response while preserving the SDK/app string result.',
  requirements: [{ text: 'After the migration, the JS SDK must read data.message and the app must still display the message string. Inspect consumers when a producer changes shape.', reference: 'explicit validation objective' }] },
  { modelRuntime: runtime, provider: 'gateway', model: process.env.ENIGMA_GATEWAY_MODEL, agentDir, timeoutMs: 180000 });
assert.equal(report.status, 'completed', JSON.stringify(report));
assert(report.text.includes('sdk') && report.text.toLowerCase().includes('message'), report.text);
assert.equal(await readFile(join(root, 'server', 'model.py'), 'utf8'), before);
const artifact = { kind: 'real-isolated-review-validation', workspace: root, report,
  injectedFault: 'Python producer moved message under data while JS SDK still reads top-level message', sourceUnchanged: true,
  limitations: ['one real known-defect case, not broad review precision/recall', 'model advisory finding, no runtime checks performed by reviewer'] };
await writeFile(join(directory, 'report.json'), JSON.stringify(artifact, null, 2)); console.log(JSON.stringify({ report: join(directory, 'report.json'), status: report.status }));
