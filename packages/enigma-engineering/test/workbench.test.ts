import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { Workbench } from '../src/workbench.js';
import { fixture } from './fixtures.js';
import { chromium } from 'playwright';

test('a configuration-only workbench lists its existing provider without an injected runtime or provider option', async () => {
  const { root } = await fixture(), agentDir = join(root, '.enigma-next', 'pi-agent'); await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { local: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'configured', name: 'Configured model', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 2000 }] } } }));
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'local', defaultModel: 'configured' }));
  const host = await Workbench.open(root), endpoint = await host.listen();
  try {
    const response = await fetch(endpoint.origin + '/api/bootstrap', { headers: { Authorization: 'Bearer ' + host.token } }); assert(response.ok);
    const data = await response.json(); assert(data.models.some((model: { provider: string; id: string }) => model.provider === 'local' && model.id === 'configured'));
    const chat = await host.create('Configured local model'); assert.equal(chat.provider, 'local'); assert.equal(chat.model, 'configured');
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test('local workbench uses real Pi streaming, interactive approval, native fork and persistent resume', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), agentDir = join(root, 'agent');
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const options = { agentDir, modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, approval: 'ask' as const };
  const host = await Workbench.open(root, options), endpoint = await host.listen(); let restarted: Workbench | undefined;
  const request = async (path: string, body?: unknown) => { const response = await fetch(endpoint.origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + host.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data; };
  try {
    assert.equal((await fetch(endpoint.origin + '/api/bootstrap')).status, 401);
    assert.equal((await fetch(endpoint.origin + '/api/bootstrap', { headers: { Authorization: 'Bearer ' + host.token, Origin: 'https://untrusted.example' } })).status, 403);
    await workspace.exclusive(() => workspace.addCheck({ id: 'written', repo: 'library', argv: [process.execPath, '-e', 'if(!require("fs").existsSync("UI.txt"))process.exit(1)'] }));
    const chat = await request('/chats', { title: 'UI workflow' });
    const controller = await host.conversation(chat.id); assert.equal(controller.snapshot().idle, true);
    faux.setResponses([fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'library', path: 'UI.txt', content: 'real Pi write' })], { stopReason: 'toolUse' }), fauxAssistantMessage('File written and actual checks passed.')]);
    await request('/chats/' + chat.id + '/prompt', { text: 'Write UI.txt and verify the actual file.' });
    let state; const until = Date.now() + 20000;
    while (Date.now() < until) { state = await request('/chats/' + chat.id); if (state.dialogs.length) break; await delay(30); }
    assert(state?.dialogs[0]); await assert.rejects(access(join(root, 'library', 'UI.txt')), /ENOENT/);
    await request('/chats/' + chat.id + '/answer', { id: state.dialogs[0].id, value: true });
    while (Date.now() < until) { state = await request('/chats/' + chat.id); if (state.dialogs.length) await request('/chats/' + chat.id + '/answer', { id: state.dialogs[0].id, value: true }); if (state.idle && state.messages.some((message: { text: string }) => message.text.includes('File written'))) break; await delay(30); }
    assert(state.idle, JSON.stringify(state)); assert.equal(await readFile(join(root, 'library', 'UI.txt'), 'utf8'), 'real Pi write'); assert(state.tools.some((tool: { state: string }) => tool.state === 'completed'));
    const fork = await request('/chats/' + chat.id + '/fork', { entry: state.messages[0].id }); assert.notEqual(fork.id, chat.id); assert.equal((await request('/bootstrap')).chats.length, 2);
    assert((await request('/chats/' + chat.id)).messages.some((message: { text: string }) => message.text.includes('File written')), 'Original chat must survive the fork');
    await host.close(); restarted = await Workbench.open(root, options); const loaded = await restarted.conversation(chat.id); assert(loaded.snapshot().messages.some(message => message.text.includes('File written')));
    assert(loaded.snapshot().tools.some(tool => tool.name==='repo_write'&&tool.state==='completed'), 'Persistent reopen must reconstruct actual finalized tool results from the native transcript');
  } finally { await restarted?.close(); await host.close(); await rm(root, { recursive: true, force: true }); }
});

test('browser workbench creates a chat, streams its answer and reconnects without replaying writes', { timeout: 60_000 }, async () => {
  const { root } = await fixture(), agentDir = join(root, 'agent');
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const host = await Workbench.open(root, { agentDir, modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, approval: 'auto' }), endpoint = await host.listen(), browser = await chromium.launch({ headless: true }), page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(endpoint.url); assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), false, 'A composer without a selected conversation must not silently discard messages');
    await page.getByRole('button', { name: '＋ 新对话' }).click(); await page.locator('#new-title').fill('Browser flow'); await page.getByRole('button', { name: '创建对话' }).click(); await page.getByRole('heading', { name: 'Browser flow' }).waitFor();
    faux.setResponses([fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'library', path: 'BROWSER.txt', content: 'one actual write' })], { stopReason: 'toolUse' }), fauxAssistantMessage('Browser stream finished.')]);
    await page.getByRole('textbox', { name: '任务消息' }).fill('Create the browser result.'); await page.getByRole('button', { name: '发送', exact: true }).click(); await page.getByText('Browser stream finished.', { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await readFile(join(root, 'library', 'BROWSER.txt'), 'utf8'), 'one actual write'); await page.reload(); await page.getByText('Browser stream finished.', { exact: true }).waitFor(); await page.waitForFunction(() => !(document.getElementById('send') as HTMLButtonElement).disabled); assert.deepEqual(errors, []);
    await page.locator('.task-nav [data-panel=timeline]').click(); await page.getByRole('button', { name: '恢复代码', exact: true }).waitFor();
    const initial = await host.conversation([...host.sessions.keys()][0]!); const checkpoints = await initial.options.workspace.checkpoints();
    await page.locator('#panel select').selectOption(checkpoints.find(checkpoint => checkpoint.label === 'session baseline')!.id);
    await page.getByRole('button', { name: '恢复代码', exact: true }).click();
    const [restored] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/actions') && response.request().method() === 'POST'), page.locator('#action-submit').click()]);
    assert(restored.ok(), await restored.text());
    const until = Date.now() + 10000; while (Date.now() < until) { try { await access(join(root, 'library', 'BROWSER.txt')); } catch { break; } await delay(30); }
    await assert.rejects(access(join(root, 'library', 'BROWSER.txt')), /ENOENT/);
    while (!initial.snapshot().idle && Date.now() < until) await delay(30);
    assert(initial.snapshot().idle, 'File restoration and its session/record settlement must complete before another workspace operation');
    let release!: () => void, requested!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { requested = resolve; });
    await page.route('**/api/chats/*/materials', async route => { requested(); await gate; await route.fulfill({ json: { items: [{ id: 'old-material', title: 'Stale delayed material', revision: 1, freshness: 'current', source: {} }] } }); });
    await page.locator('.workspace-nav [data-panel=materials]').click(); await entered;
    await page.locator('.project-switcher').click(); await page.locator('#panel .card h3').filter({ hasText: 'library' }).waitFor();
    release(); await page.waitForResponse(response => response.url().endsWith('/materials')); await page.waitForTimeout(100);
    assert.equal(await page.getByText('Stale delayed material', { exact: true }).count(), 0, 'An older panel response cannot replace the currently selected project');
    const { Artifacts } = await import('../src/artifacts.js'), content = '<h1>Saved artifact version</h1><script>window.previewInjected = true</script>';
    await writeFile(join(root, 'library', 'PREVIEW.html'), content);
    const saved = await new Artifacts(initial.options.workspace).add({ title: 'Historical document', kind: 'document', repo: 'library', file: 'PREVIEW.html' });
    await writeFile(join(root, 'library', 'PREVIEW.html'), 'Changed source after publication');
    await page.locator('.workspace-nav [data-panel=artifacts]').click(); await page.getByRole('button', { name: '预览内容', exact: true }).click();
    assert.equal(await page.locator('#panel .artifact-preview').textContent(), content, 'Preview must use immutable saved bytes, not the changed source');
    assert.equal(await page.evaluate(() => (window as Window & { previewInjected?: boolean }).previewInjected), undefined, 'Artifact HTML must be rendered as text');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '打开 / 下载', exact: true }).click()]);
    const downloaded = await download.path(); assert(downloaded); assert.equal(await readFile(downloaded, 'utf8'), content); assert(saved.hash);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await host.close(); await rm(root, { recursive: true, force: true }); }
});

test('workbench cancellation dismisses a real pending permission and leaves the source unchanged', { timeout: 30_000 }, async () => {
  const { root } = await fixture(), agentDir = join(root, 'agent');
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const host = await Workbench.open(root, { agentDir, modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, approval: 'ask' }), endpoint = await host.listen(), chat = await host.create('Cancel permission');
  try {
    faux.setResponses([fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'library', path: 'DENIED.txt', content: 'wrong' })], { stopReason: 'toolUse' }), fauxAssistantMessage('Done.')]);
    const controller = await host.conversation(chat.id), running = controller.prompt('Try the file write.');
    const until = Date.now() + 10000; while (!controller.dialogs.size && Date.now() < until) await delay(20); assert(controller.dialogs.size);
    const response = await fetch(endpoint.origin + '/api/chats/' + chat.id + '/cancel', { method: 'POST', headers: { Authorization: 'Bearer ' + host.token, 'Content-Type': 'application/json' }, body: '{}' }); assert(response.ok);
    await running; assert(controller.runtime.session.isIdle); assert.equal(controller.dialogs.size, 0); await assert.rejects(access(join(root, 'library', 'DENIED.txt')), /ENOENT/);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test('cancel immediately after submission cannot dispatch a later model write', { timeout: 30_000 }, async () => {
  const { root } = await fixture(), agentDir = join(root, 'agent'), runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 2000 }] }); runtime.registerNativeProvider(faux.provider);
  const host = await Workbench.open(root, { agentDir, modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, approval: 'auto' }), chat = await host.create('Immediate cancellation');
  try {
    const controller = await host.conversation(chat.id); faux.setResponses([fauxAssistantMessage([fauxToolCall('repo_write', { repo: 'library', path: 'IMMEDIATE.txt', content: 'unexpected' })], { stopReason: 'toolUse' }), fauxAssistantMessage('Done')]);
    const pending = controller.start('Write the immediate result.'); await controller.cancel(); await pending;
    assert(controller.snapshot().idle); await assert.rejects(access(join(root, 'library', 'IMMEDIATE.txt')), /ENOENT/);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});
