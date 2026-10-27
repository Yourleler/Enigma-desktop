import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { chromium } from 'playwright';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { fixture } from './fixtures.js';
import { Workbench } from '../src/workbench.js';
import { syncGatewayModels } from '../src/workbench-models.js';
import { uiActions } from '../src/workbench-domain.js';
import { BackgroundRuns } from '../src/background.js';
import { ServiceManager } from '../src/services.js';
import { Delegations } from '../src/delegation.js';
import { TaskEvents } from '../src/task-events.js';

test('contextual forms omit unrelated fields and run the saved procedure with its original acceptance', { timeout: 60000 }, async () => {
    const { root, workspace } = await fixture(), dir = join(root, 'agent');
    const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false }), faux = fauxProvider();
    runtime.registerNativeProvider(faux.provider);
    const host = await Workbench.open(root, { agentDir: dir, modelRuntime: runtime, provider: faux.getModel().provider, model: faux.getModel().id, approval: 'auto' });
    const chat = await host.create('Contextual procedures'), endpoint = await host.listen(), browser = await chromium.launch(), page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const api = async (path: string, body?: unknown) => {
        const response = await fetch(endpoint.origin + '/api/chats/' + chat.id + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + host.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data;
    };
    const settle = async () => {
        const until = Date.now() + 15000;
        while (Date.now() < until) {
            const state = await api('');
            if (state.idle) { assert.equal(state.operation.state, 'completed', JSON.stringify(state.operation)); return state.operation.result; }
            await delay(40);
        }
        throw Error('Form operation did not settle');
    };
    const operation = async (action: string, args: unknown) => { await api('/actions', { action, args }); return settle(); };
    const open = async (group: string, title: string) => {
        await page.locator('#tools-launcher').click(); await page.locator('#tools-search').fill(group);
        await page.locator('.capability').click();
        await page.locator('#panel-actions > summary').click();
        await page.locator('#panel-actions .action-grid').getByRole('button', { name: new RegExp('^' + title) }).click();
        await page.locator('#action-title').getByText(title, { exact: true }).waitFor();
    };
    const submit = async () => {
        const response = page.waitForResponse(r => r.url().endsWith('/actions'));
        await page.locator('#action-submit').click(); const result = await response;
        const request = result.request().postDataJSON(); assert(result.ok(), await result.text());
        await page.locator('#action-dialog').waitFor({ state: 'hidden' }); await settle(); return request.args;
    };
    let waitId: string | undefined;
    try {
        await operation('check-add', { id: 'contextual-marker', repo: 'library', argv: [process.execPath, '-e', 'if(require("fs").readFileSync("contextual.txt","utf8")!=="FORM_OK")process.exit(2)'] });
        await page.goto(endpoint.url); await page.getByRole('heading', { name: chat.title, exact: true }).waitFor();
        await open('技能与配方', '创建 / 编辑配方');
        const form = page.locator('#action-fields');
        await form.getByLabel('记录 ID', { exact: true }).first().fill('contextual');
        await form.getByLabel('名称', { exact: true }).fill('Contextual original acceptance');
        const rows = form.locator('[data-field-wrap="steps"] > div > .nested-fields'), command = rows.first();
        assert.equal(await command.getByLabel('步骤类型', { exact: true }).inputValue(), 'verify');
        assert.equal(await command.getByLabel('仓库', { exact: true }).isVisible(), false);
        await command.getByLabel('步骤类型', { exact: true }).selectOption('command');
        assert.equal(await command.getByLabel('仓库', { exact: true }).isVisible(), true);
        assert.equal(await command.getByLabel('服务', { exact: true }).isVisible(), false);
        await command.getByLabel('记录 ID', { exact: true }).fill('write');
        await command.getByLabel('仓库', { exact: true }).selectOption('library');
        await command.getByLabel('命令与参数', { exact: true }).fill([process.execPath, '-e', 'require("fs").writeFileSync("contextual.txt","FORM_OK")'].join('\n'));
        await form.locator('[data-field-wrap="steps"]').getByRole('button', { name: '＋ 添加', exact: true }).click();
        const acceptance = rows.last();
        await acceptance.getByLabel('记录 ID', { exact: true }).fill('acceptance');
        await acceptance.getByLabel('步骤类型', { exact: true }).selectOption('verify');
        const saved = await submit();
        assert.deepEqual(saved.steps[1], { id: 'acceptance', kind: 'verify' });
        assert.equal(saved.steps[0].service, undefined);
        const run = await operation('recipe-run', { id: 'contextual' });
        assert.equal(run.status, 'passed', JSON.stringify(run));
        assert(run.run.evidence); assert((await workspace.evidenceStatus(run.run.evidence)).valid);
        assert.equal(await readFile(join(workspace.repo('library').root, 'contextual.txt'), 'utf8'), 'FORM_OK');
        await operation('service-add', { id: 'contextual-service', label: 'Contextual service', repo: 'app', argv: [process.execPath, '-e', 'console.log("ready")'], readiness: { type: 'log', includes: 'ready' } });
        await open('环境与验证', '配置浏览器验收');
        await form.getByLabel('记录 ID', { exact: true }).fill('contextual-browser');
        await form.getByLabel('名称', { exact: true }).fill('Contextual browser');
        const step = form.locator('.nested-fields').first();
        await step.getByLabel('动作', { exact: true }).selectOption('screenshot');
        assert.equal(await step.getByLabel('CSS 选择器', { exact: true }).isVisible(), false);
        await step.getByLabel('截图名', { exact: true }).fill('unused');
        await step.getByLabel('动作', { exact: true }).selectOption('expect');
        assert.equal(await step.getByLabel('截图名', { exact: true }).isVisible(), false);
        await step.getByLabel('CSS 选择器', { exact: true }).fill('#value');
        await step.getByLabel('预期文本', { exact: true }).fill('FORM_OK');
        const scenario = await submit();
        assert.deepEqual(scenario.steps, [{ action: 'expect', selector: '#value', includes: 'FORM_OK' }]);
        const background = await operation('background-start', { label: 'Contextual wait', repo: 'library', argv: [process.execPath, '-e', 'console.log("WAIT_OK")'], maxRuntimeMs: 10000 });
        await new BackgroundRuns(workspace).wait(background.spec.id, { timeoutMs: 10000 });
        assert((await new BackgroundRuns(workspace).drain(background.spec.id)).drained);
        await open('环境与验证', '等待结果并接续');
        await form.getByLabel('名称', { exact: true }).fill('Contextual background wait');
        assert.equal(await form.getByLabel('子任务 ID', { exact: true }).isVisible(), false);
        await form.getByLabel('来源', { exact: true }).selectOption('service');
        assert.equal(await form.getByLabel('服务状态', { exact: true }).isVisible(), true);
        await form.getByLabel('服务 ID', { exact: true }).fill('unused-service');
        await form.getByLabel('来源', { exact: true }).selectOption('background');
        assert.equal(await form.getByLabel('服务状态', { exact: true }).isVisible(), false);
        await form.getByLabel('后台 ID 或 GitHub run 编号', { exact: true }).fill(background.spec.id);
        const waited = await submit();
        assert.deepEqual(waited.condition, { kind: 'background', run: background.spec.id });
        waitId = (await api('')).operation.result.id;
        assert.deepEqual(errors, []);
    } catch (error) {
        console.error('Contextual form validation failed:', error);
        throw error;
    } finally {
        try {
            if (waitId) {
                const events = new TaskEvents(workspace);
                await events.cancel(waitId, (await host.conversation(chat.id)).chat.session);
                const until = Date.now() + 10000;
                while (Date.now() < until) {
                    const state = await events.status(waitId);
                    if (state.state.workerPid > 0 && state.worker.state === 'gone') break;
                    await delay(50);
                }
                assert.equal((await events.status(waitId)).worker.state, 'gone');
            }
        } finally {
            await browser.close(); await host.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    }
});
test('Gateway discovery preserves default config and real IDs, works through Messages and keeps a previous catalogue on failure', async () => {
    const { root } = await fixture(), dir = join(root, 'agent');
    await mkdir(dir);
    let broken = false;
    const calls: {
        model: string;
        effort: unknown;
    }[] = [], paths: string[] = [];
    const server = createServer((req, res) => {
        paths.push(req.url ?? '');
        if (req.url === '/v1/models') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: broken ? [] : ['first', 'second'].map(id => ({ id, display_name: id, max_input_tokens: 100000, max_tokens: 2048, capabilities: { effort: { supported: true, low: { supported: true }, high: { supported: true } }, image_input: { supported: false } } })) }));
            return;
        }
        if (req.url?.startsWith('/v1/messages')) {
            let text = '';
            req.on('data', chunk => text += chunk);
            req.on('end', () => {
                const body = JSON.parse(text);
                calls.push({ model: body.model, effort: body.output_config?.effort ?? body.thinking });
                res.setHeader('content-type', 'text/event-stream');
                const event = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
                event('message_start', { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
                event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
                event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'MODEL ' + body.model } });
                event('content_block_stop', { type: 'content_block_stop', index: 0 });
                event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
                event('message_stop', { type: 'message_stop' });
                res.end();
            });
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    const original = { providers: { gateway: { baseUrl: `http://127.0.0.1:${address.port}`, api: 'anthropic-messages', apiKey: 'fixture-only', models: [{ id: 'default-model', contextWindow: 100000, maxTokens: 2048 }] }, existing: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'other', models: [{ id: 'existing-model' }] } } };
    await writeFile(join(dir, 'models.json'), JSON.stringify(original));
    const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: join(dir, 'models.json') });
    try {
        assert.equal((await syncGatewayModels(dir, runtime)).count, 2);
        const saved = JSON.parse(await readFile(join(dir, 'models.json'), 'utf8'));
        assert.equal(saved.providers.gateway.api, original.providers.gateway.api);
        assert.equal(saved.providers.gateway.apiKey, original.providers.gateway.apiKey);
        assert.deepEqual(saved.providers.gateway.models[0], original.providers.gateway.models[0]);
        assert.deepEqual(saved.providers.existing, original.providers.existing);
        for (const id of ['first', 'second']) {
            const model = runtime.getModel('gateway', id);
            assert(model);
            const result = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Reply', timestamp: Date.now() }] }, { reasoning: 'high', maxTokens: 100 });
            assert.equal(result.stopReason, 'stop', result.errorMessage + ' ' + JSON.stringify(paths));
            assert.equal(result.content.filter(p => p.type === 'text').map(p => p.text).join(''), 'MODEL ' + id);
        }
        assert.deepEqual(calls.map(c => c.model), ['first', 'second']);
        assert(calls.every(c => c.effort == null), 'Discovery must not invent unsupported thinking capabilities');
        broken = true;
        await assert.rejects(syncGatewayModels(dir, runtime), /目录/);
        assert(runtime.getModel('gateway', 'first'));
        assert.deepEqual(JSON.parse(await readFile(join(dir, 'models.json'), 'utf8')), saved);
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
    }
});
test('current chat model/thinking and plugin settings persist through public SDK reload and reject in-flight changes', { timeout: 60000 }, async () => {
    const { root } = await fixture(), dir = join(root, 'agent'), runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ models: [{ id: 'one', contextWindow: 100000, maxTokens: 2000, reasoning: true }, { id: 'two', contextWindow: 200000, maxTokens: 2000, reasoning: true }] });
    runtime.registerNativeProvider(faux.provider);
    const host = await Workbench.open(root, { agentDir: dir, modelRuntime: runtime, provider: faux.getModel().provider, model: 'one' }), chat = await host.create('Persist settings');
    try {
        const controller = await host.conversation(chat.id);
        await controller.settings({ model: 'two', thinking: 'high', memory: true, approval: 'auto' });
        assert.equal(controller.chat.model, 'two');
        assert.equal(controller.snapshot().thinking, 'high');
        assert(controller.snapshot().memory);
        faux.setResponses([fauxAssistantMessage('Settings preserved.')]);
        await controller.prompt('Reply only.');
        await controller.settings({ memory: false, approval: 'ask' });
        assert(controller.snapshot().messages.some(m => m.text === 'Settings preserved.'));
        assert.equal(controller.runtime.session.model?.id, 'two');
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const running = controller.perform('owned wait', async () => { await gate; return 'finished'; });
        await assert.rejects(controller.settings({ model: 'one' }), /等待/);
        release();
        await running;
        await host.close();
        const reopened = await Workbench.open(root, { agentDir: dir, modelRuntime: runtime, provider: faux.getModel().provider, model: 'one' });
        try {
            const restored = await reopened.conversation(chat.id);
            assert.equal(restored.runtime.session.model?.id, 'two');
            assert.equal(restored.snapshot().thinking, 'high');
            assert.equal(restored.snapshot().memory, false);
            assert.equal(restored.snapshot().approval, 'ask');
        }
        finally {
            await reopened.close();
        }
    }
    finally {
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});
test('browser forms use real task, material, memory and service operations, keep layout usable at desktop and narrow widths', { timeout: 90000 }, async () => {
    const { root, workspace } = await fixture(), dir = join(root, 'agent'), runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false }), faux = fauxProvider({ models: [{ id: 'first', contextWindow: 100000, maxTokens: 2000, reasoning: true }, { id: 'second', contextWindow: 100000, maxTokens: 2000, reasoning: true }] });
    runtime.registerNativeProvider(faux.provider);
    const host = await Workbench.open(root, { agentDir: dir, modelRuntime: runtime, provider: faux.getModel().provider, model: 'first', memory: true, approval: 'auto' }), endpoint = await host.listen(), browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const api = async (path: string, body?: unknown) => { const r = await fetch(endpoint.origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + host.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await r.json(); assert(r.ok, JSON.stringify(data)); return data; };
    let id: string = '';
    const operation = async (action: string, args: unknown) => { await api('/chats/' + id + '/actions', { action, args }); const until = Date.now() + 30000; let state; while (Date.now() < until) {
        state = await api('/chats/' + id);
        if (state.idle) {
            assert.equal(state.operation.state, 'completed', JSON.stringify(state.operation));
            return state.operation.result;
        }
        await delay(40);
    } throw Error('Operation did not settle ' + action); };
    try {
        await page.goto(endpoint.url);
        await page.getByRole('button', { name: '＋ 新对话' }).click();
        await page.locator('#new-title').fill('Full interface');
        await page.getByRole('button', { name: '创建对话' }).click();
        await page.getByRole('heading', { name: 'Full interface', exact: true }).waitFor();
        id = (await api('/bootstrap')).chats[0].id;
        await page.locator('#model-picker').click();
        await page.getByRole('textbox', { name: '搜索模型' }).fill('second');
        await page.locator('.model-row').click();
        await page.waitForFunction(() => document.getElementById('selected-model')?.textContent === 'second');
        await Promise.all([page.waitForResponse(r => r.url().endsWith('/settings')), page.getByLabel('思考级别').selectOption('high')]);
        await page.locator('#tools-launcher').click();
        await page.getByRole('textbox', { name: '搜索功能' }).fill('计划');
        await page.locator('.capability').getByText('目标与计划').click();
        await page.locator('#panel-actions > summary').click();
        await page.locator('#panel-actions').getByText('建立任务目标', { exact: true }).click();
        await page.getByLabel('任务目标', { exact: true }).first().fill('Keep original task acceptance');
        const row = page.locator('#action-fields .nested-fields').first();
        await row.getByLabel('记录 ID', { exact: true }).fill('prepare');
        await row.getByLabel('仓库', { exact: true }).selectOption('library');
        await row.getByLabel('任务目标', { exact: true }).fill('Read the source');
        await page.locator('#action-submit').click();
        await page.locator('#panel').getByRole('heading', { name: 'Keep original task acceptance' }).waitFor();
        const material = await operation('material-note', { title: 'UI contract', content: '新接口字段属于 data.message。', private: true });
        assert(material.id);
        const saved = await operation('memory-save', { title: '契约经验', content: '读取 data.message 后运行联合检查。', kind: 'contract', scope: 'project' });
        assert(saved.id);
        const recalled = await operation('memory-search', { query: '接口 契约 data.message' });
        assert(recalled.items.some((item: {
            id: string;
        }) => item.id === saved.id));
        await operation('memory-forget', { id: saved.id });
        const forgotten = await operation('memory-search', { query: 'data.message' });
        assert(!forgotten.items.some((item: {
            id: string;
        }) => item.id === saved.id));
        await operation('check-add', { id: 'actual-file', repo: 'library', argv: [process.execPath, '-e', 'if(!require("fs").existsSync("index.js"))process.exit(2)'] });
        const verified = await operation('verify', {});
        assert.equal(verified.status, 'verified');
        const baseline = await operation('checkpoint', { label: 'UI checkpoint' });
        assert(baseline.id);
        const reading = await operation('code-read', { query: 'greet' });
        assert(reading.symbols.some((s: {
            repo: string;
        }) => s.repo === 'library'));
        const skillDir = join(root, 'local-skill');
        await mkdir(skillDir);
        const skillFile = join(skillDir, 'SKILL.md');
        await writeFile(skillFile, '---\nname: interface-skill\ndescription: Verify the exact interface skill marker\n---\nUse the background marker INTERFACE_SKILL_REFERENCE.\n');
        await operation('skills-paths', { paths: [skillFile] });
        const skills = await api('/chats/' + id + '/data/skills');
        assert(skills.catalog.skills.some((s: {
            name: string;
        }) => s.name === 'interface-skill'));
        assert((await host.conversation(id)).runtime.session.resourceLoader.getSkills().skills.some(s => s.name === 'interface-skill'));
        let skillSeen = false;
        faux.setResponses([(context) => { skillSeen = JSON.stringify(context.messages).includes('INTERFACE_SKILL_REFERENCE'); return fauxAssistantMessage('Native skill was expanded.'); }]);
        await (host.sessions.get(id)!).prompt('/skill:interface-skill Read the marker.');
        assert(skillSeen, 'The native skill command must actually expand its selected reference into the model request');
        const bg = await operation('background-start', { label: 'UI real process', repo: 'library', argv: [process.execPath, '-e', 'console.log("UI_PROCESS_OK")'], maxRuntimeMs: 30000 });
        assert(bg.spec.id);
        const background = new BackgroundRuns(workspace);
        const receipt = await background.wait(bg.spec.id, { timeoutMs: 10000 });
        assert.equal(receipt.state.status, 'passed');
        assert(receipt.state.output.includes('UI_PROCESS_OK'));
        assert((await background.drain(bg.spec.id)).drained);
        await operation('service-add', { id: 'ui-server', label: 'Actual UI service', repo: 'app', argv: [process.execPath, '-e', 'const s=require("http").createServer((q,r)=>r.end("<div id=value>UI_SERVICE_OK</div>"));s.listen(0,"127.0.0.1",()=>console.log("READY: "+s.address().port));'], portPrefix: 'READY: ', readiness: { type: 'http', includes: 'UI_SERVICE_OK' } });
        const ready = await operation('service-start', { id: 'ui-server' });
        assert(ready.ready, JSON.stringify(ready));
        await operation('browser-add', { id: 'ui-flow', label: 'Actual browser flow', service: 'ui-server', steps: [{ action: 'expect', selector: '#value', includes: 'UI_SERVICE_OK' }] });
        assert.equal((await operation('browser-run', { id: 'ui-flow' })).status, 'passed');
        await operation('service-stop', { id: 'ui-server' });
        for (const group of [...new Set(uiActions.map(a => a.group))].filter(g => !['project', 'materials', 'artifacts'].includes(g))) {
            const result = await api('/chats/' + id + '/data/' + group);
            assert(result !== undefined);
        }
        await page.setViewportSize({ width: 615, height: 724 });
        await page.locator('#panel-close').click();
        await page.locator('#composer-tools').click();
        await page.getByRole('textbox', { name: '搜索功能' }).fill('记忆');
        await page.locator('.capability').click();
        await page.locator('#panel-title').getByText('项目记忆').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(errors, []);
        const sourceState = await api('/chats/' + id), sourceId = id;
        const request = sourceState.messages.find((m: {
            role: string;
        }) => m.role === 'user');
        assert(request);
        await operation('handoff-export', { goal: 'Read common background', entries: [request.id], mode: 'background', destination: join(root, 'handoff') });
        assert((await readFile(join(root, 'handoff', 'handoff.md'), 'utf8')).includes('Read common background'));
        const packaged = await operation('package-export', { goal: 'Reproduce original source', entries: [request.id] });
        assert(packaged.directory);
        const reproduced = await operation('package-restore', { directory: packaged.directory, destination: join(root, 'reproduction'), writeRepos: ['library', 'sdk', 'app'], activateRuntime: true });
        assert(reproduced.workspace);
        await api('/chats/' + id + '/actions', { action: 'new-context', args: { goal: 'A separate task using common background', entries: [request.id] } });
        const until = Date.now() + 15000;
        let newChat;
        while (Date.now() < until) {
            newChat = (await api('/bootstrap')).chats.find((c: {
                id: string;
            }) => c.id !== sourceId);
            if (newChat && (await api('/chats/' + newChat.id)).idle)
                break;
            await delay(40);
        }
        assert(newChat);
        const newState = await api('/chats/' + newChat.id);
        assert(newState.idle);
        assert(newState.messages.some((m: {
            text: string;
        }) => m.text.includes('A separate task')));
        assert((await api('/chats/' + sourceId)).messages.length > 0);
    }
    finally {
        await new ServiceManager(workspace).stop('ui-server').catch(() => { });
        await browser.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});
test('web operation failures remain explicit, and cancelling a real long command prevents late source effects', { timeout: 45000 }, async () => {
    const { root, workspace } = await fixture(), dir = join(root, 'agent'), runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false }), faux = fauxProvider({ models: [{ id: 'model', contextWindow: 100000, maxTokens: 2000 }] });
    runtime.registerNativeProvider(faux.provider);
    const host = await Workbench.open(root, { agentDir: dir, modelRuntime: runtime, provider: faux.getModel().provider, model: 'model', approval: 'auto' }), endpoint = await host.listen(), chat = await host.create('Cancellation boundary'), controller = await host.conversation(chat.id);
    const post = async (action: string, args: unknown) => { const response = await fetch(endpoint.origin + '/api/chats/' + chat.id + '/actions', { method: 'POST', headers: { Authorization: 'Bearer ' + host.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, args }) }); assert.equal(response.status, 202); };
    const settled = async () => { const deadline = Date.now() + 15000; while (!controller.snapshot().idle && Date.now() < deadline)
        await delay(25); assert(controller.snapshot().idle); };
    try {
        await workspace.exclusive(() => workspace.addCheck({ id: 'must-fail', repo: 'library', argv: [process.execPath, '-e', 'process.exit(3)'] }));
        await post('verify', {});
        await settled();
        assert.equal(controller.operation?.outcome, 'failed');
        assert.equal((controller.operation?.result as {
            results: {
                status: string;
            }[];
        }).results[0]?.status, 'failed');
        await post('recipe-save', { id: 'long-run', label: 'Long cancellable command', steps: [{ id: 'late', kind: 'command', repo: 'library', argv: [process.execPath, '-e', 'setTimeout(()=>require("fs").writeFileSync("LATE_UI.txt","wrong"),2500)'] }, { id: 'original-acceptance', kind: 'verify' }] });
        await settled();
        assert.equal(controller.operation?.state, 'completed', JSON.stringify(controller.operation));
        await post('recipe-run', { id: 'long-run' });
        await delay(250);
        await controller.cancel();
        await settled();
        assert.equal(controller.operation?.state, 'cancelled');
        await delay(2600);
        await assert.rejects(readFile(join(root, 'library', 'LATE_UI.txt')), /ENOENT/);
        const unknown = await fetch(endpoint.origin + '/api/chats/' + chat.id + '/actions', { method: 'POST', headers: { Authorization: 'Bearer ' + host.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'not-registered', args: {} }) });
        assert.equal(unknown.status, 400);
    }
    finally {
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});
test('workbench collaboration action dispatches a real isolated worker, previews its changes and merges under original parent checks', { timeout: 60000 }, async () => {
    const { root, workspace } = await fixture(), dir = join(root, 'agent');
    await mkdir(dir);
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body), done = data.messages.some((m: {
                role: string;
            }) => m.role === 'tool');
            const delta = done ? { content: 'Isolated document prepared.' } : { tool_calls: [{ index: 0, id: 'ui-write', type: 'function', function: { name: 'repo_write', arguments: JSON.stringify({ repo: 'library', path: 'UI_CHILD.md', content: 'Source-owned isolated document\n' }) } }] };
            res.setHeader('content-type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: done ? 'stop' : 'tool_calls' }] })}\n\n`);
            res.end('data: [DONE]\n\n');
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    await writeFile(join(dir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'model', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 2000 }] } } }));
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'model' }));
    await workspace.exclusive(() => workspace.addCheck({ id: 'owned-document', repo: 'library', argv: [process.execPath, '-e', 'if(require("fs").readFileSync("UI_CHILD.md","utf8")!=="Source-owned isolated document\\n")process.exit(2)'] }));
    const host = await Workbench.open(root, { agentDir: dir, approval: 'auto' }), endpoint = await host.listen(), chat = await host.create('Actual collaboration'), controller = await host.conversation(chat.id);
    let childId;
    const action = async (name: string, args: unknown) => { const response = await fetch(endpoint.origin + '/api/chats/' + chat.id + '/actions', { method: 'POST', headers: { Authorization: 'Bearer ' + host.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name, args }) }); assert.equal(response.status, 202); const deadline = Date.now() + 20000; while (!controller.snapshot().idle && Date.now() < deadline)
        await delay(30); assert(controller.snapshot().idle); assert.equal(controller.operation?.state, 'completed', JSON.stringify(controller.operation)); return controller.operation!.result as any; };
    try {
        const started = await action('delegate-start', { goal: 'Prepare UI_CHILD.md using the actual source', target: 'pi', writeRepos: ['library'], checks: ['owned-document'], timeoutMs: 30000, maxRequests: 8 });
        childId = started.spec.id;
        const done = await new Delegations(workspace).wait(childId, { timeoutMs: 20000, task: controller.chat.session });
        assert.equal(done.state.status, 'completed', JSON.stringify(done));
        await assert.rejects(readFile(join(root, 'library', 'UI_CHILD.md')), /ENOENT/);
        const preview = await action('delegate-preview', { id: childId });
        assert(preview.applyAllowed);
        assert(preview.changes.some((c: {
            file: string;
        }) => c.file === 'UI_CHILD.md'));
        const merged = await action('delegate-merge', { id: preview.id });
        assert.equal(merged.verification.status, 'verified');
        assert.equal(await readFile(join(root, 'library', 'UI_CHILD.md'), 'utf8'), 'Source-owned isolated document\n');
        assert((await new Delegations(workspace).drain(childId)).drained);
    }
    finally {
        if (childId) {
            await new Delegations(workspace).cancel(childId).catch(() => { });
            assert((await new Delegations(workspace).drain(childId)).drained);
        }
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});
