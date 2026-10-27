import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ModelRuntime, SessionManager, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { WorkbenchSession, type ChatRecord, type WorkbenchEvent } from './workbench-session.js';
import { ensureDir, readJson, redact, safeId, writeJson } from './storage.js';
import { projectOverview } from './project-overview.js';
import { ProjectContext } from './project-context.js';
import { TaskReadingStore } from './task-reading.js';
import { Artifacts } from './artifacts.js';
import { observeChanges } from './changes.js';
import { ServiceManager } from './services.js';
import { BackgroundRuns } from './background.js';
import { TaskEvents } from './task-events.js';
import { Delegations } from './delegation.js';
import { readSource } from './reading.js';
import { html, css, clientScript } from './workbench-assets.js';
import { domainAction, domainData, uiActions } from './workbench-domain.js';
import { syncGatewayModels } from './workbench-models.js';
export interface WorkbenchOptions {
    agentDir?: string;
    modelRuntime?: ModelRuntime;
    provider?: string;
    model?: string;
    memory?: boolean;
    approval?: 'ask' | 'auto' | 'never';
    port?: number;
}
/** Authenticated local UI; browser state is a view over the existing domain and Pi sessions. */
export class Workbench {
    readonly token = randomBytes(32).toString('base64url');
    readonly sessions = new Map<string, WorkbenchSession>();
    private readonly opening = new Map<string, Promise<WorkbenchSession>>();
    private chats: ChatRecord[] = [];
    private readonly subscribers = new Set<{
        chat: string;
        response: ServerResponse;
    }>();
    private events: WorkbenchEvent[] = [];
    private sequence = 0;
    private catalogChain = Promise.resolve();
    private readonly server = createServer((request, response) => {
        void this.handle(request, response).catch(error => {
            if (!response.headersSent)
                this.json(response, 400, { error: redact(String(error), this.workspace.secrets) });
            else
                response.end();
        });
    });
    private constructor(readonly workspace: Workspace, readonly options: WorkbenchOptions, readonly models: ModelRuntime, readonly agentDir: string) { }
    static async open(root: string, options: WorkbenchOptions = {}) {
        const workspace = await Workspace.open(root), directory = await ensureDir(join(workspace.data, 'workbench'));
        await ensureDir(join(directory, 'sessions'));
        let agentDir = options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(workspace.data, 'pi-agent');
        if (!options.agentDir && !process.env.PI_CODING_AGENT_DIR)
            try {
                await access(join(agentDir, 'models.json'));
            }
            catch {
                agentDir = getAgentDir();
            }
        const models = options.modelRuntime ?? await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), allowModelNetwork: false });
        const host = new Workbench(workspace, options, models, agentDir);
        try {
            const catalog = await readJson<{
                schema: number;
                chats: ChatRecord[];
            }>(join(directory, 'chats.json'));
            if (catalog.schema !== 1 || !Array.isArray(catalog.chats) || catalog.chats.length > 200)
                throw new Error('Invalid workbench chat catalog');
            host.chats = catalog.chats;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
        return host;
    }
    private catalog() { return join(this.workspace.data, 'workbench', 'chats.json'); }
    private persist(chat: ChatRecord, previous?: ChatRecord) {
        this.catalogChain = this.catalogChain.then(async () => {
            if (previous) {
                this.sessions.delete(previous.id);
                const controller = [...this.sessions.values()].find(item => item.chat.id === chat.id);
                if (controller)
                    this.sessions.set(chat.id, controller);
            }
            const index = this.chats.findIndex(item => item.id === chat.id);
            if (index < 0)
                this.chats.push({ ...chat });
            else
                this.chats[index] = { ...chat };
            await writeJson(this.catalog(), { schema: 1, chats: this.chats });
            this.emit('catalog', chat.id, this.chats);
        });
        return this.catalogChain;
    }
    private emit(type: string, chat: string, data: unknown) {
        const safe = JSON.parse(redact(JSON.stringify(data), this.workspace.secrets)), event = { seq: ++this.sequence, type, chat, data: safe };
        this.events.push(event);
        if (this.events.length > 500)
            this.events.shift();
        const text = `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
        for (const client of this.subscribers)
            if (client.chat === chat || type === 'catalog')
                client.response.write(text);
    }
    async create(title = '新对话', provider?: string, model?: string) {
        if (this.chats.length >= 200 || !title.trim() || title.length > 120)
            throw new Error('Chat title/catalog budget exceeded');
        const settings = SettingsManager.create(this.workspace.root, this.agentDir), chosenProvider = provider ?? this.options.provider ?? settings.getDefaultProvider(), chosenModel = model ?? this.options.model ?? settings.getDefaultModel();
        if (!chosenProvider || !chosenModel || !this.models.getModel(chosenProvider, chosenModel))
            throw new Error('Configure an existing model backend before creating a workbench chat');
        const manager = SessionManager.create(this.workspace.root, join(this.workspace.data, 'workbench', 'sessions'));
        manager.appendCustomEntry('enigma.workbench', { title });
        const chat: ChatRecord = { id: randomUUID(), title, provider: chosenProvider, model: chosenModel, session: manager.getSessionId(), sessionFile: manager.getSessionFile()!, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await this.persist(chat);
        return chat;
    }
    async conversation(id: string) {
        safeId(id);
        const existing = this.sessions.get(id);
        if (existing)
            return existing;
        const pending = this.opening.get(id);
        if (pending)
            return await pending;
        const chat = this.chats.find(chat => chat.id === id);
        if (!chat)
            throw new Error('Unknown workbench conversation');
        const allowed = resolve(this.workspace.data, 'workbench', 'sessions'), rel = relative(allowed, resolve(chat.sessionFile));
        if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
            throw new Error('Catalog session is outside the project session directory');
        let manager: SessionManager | undefined;
        try {
            await access(chat.sessionFile);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || chat.started)
                throw error;
            manager = SessionManager.create(this.workspace.root, allowed);
            chat.session = manager.getSessionId();
            chat.sessionFile = manager.getSessionFile()!;
        }
        const controller = new WorkbenchSession({ ...chat }, { workspace: this.workspace, models: this.models, agentDir: this.agentDir, memory: this.options.memory ?? false, approval: this.options.approval ?? 'ask',
            emit: (type, chat, data) => this.emit(type, chat, data), persist: (record, previous) => {
                if (previous) {
                    this.sessions.delete(previous.id);
                    this.sessions.set(record.id, controller);
                }
                return this.persist(record, previous);
            } });
        const load = controller.open(manager).then(() => { this.sessions.set(controller.chat.id, controller); return controller; }).finally(() => this.opening.delete(id));
        this.opening.set(id, load);
        return await load;
    }
    async listen() {
        const port = this.options.port ?? 0;
        if (!Number.isInteger(port) || port < 0 || port > 65535)
            throw new Error('Invalid local workbench port');
        await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
        const address = this.server.address();
        if (!address || typeof address === 'string')
            throw new Error('Local workbench failed to bind');
        return { url: `http://127.0.0.1:${address.port}/#${this.token}`, origin: `http://127.0.0.1:${address.port}`, port: address.port };
    }
    private json(response: ServerResponse, status: number, data: unknown) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(redact(JSON.stringify(data), this.workspace.secrets)); }
    private authenticated(request: IncomingMessage) { const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? ''; const a = Buffer.from(supplied), b = Buffer.from(this.token); return a.length === b.length && timingSafeEqual(a, b); }
    private async body(request: IncomingMessage) {
        let size = 0, text = '';
        for await (const bytes of request) {
            size += bytes.length;
            if (size > 100000)
                throw new Error('Workbench request exceeds 100 KB');
            text += bytes;
        }
        return text ? JSON.parse(text) as Record<string, unknown> : {};
    }
    private async handle(request: IncomingMessage, response: ServerResponse) {
        const address = this.server.address();
        if (!address || typeof address === 'string')
            throw new Error('Workbench is not listening');
        const origin = `http://127.0.0.1:${address.port}`;
        if (request.headers.host !== `127.0.0.1:${address.port}` || request.headers.origin && request.headers.origin !== origin) {
            this.json(response, 403, { error: 'Local origin required' });
            return;
        }
        response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const url = new URL(request.url ?? '/', origin), path = url.pathname;
        if (request.method === 'GET' && ['/', '/assets/app.css', '/assets/app.js'].includes(path)) {
            response.writeHead(200, { 'content-type': path === '/' ? 'text/html; charset=utf-8' : path.endsWith('.css') ? 'text/css' : 'text/javascript', 'cache-control': 'no-store' });
            response.end(path === '/' ? html : path.endsWith('.css') ? css : clientScript);
            return;
        }
        if (!this.authenticated(request)) {
            this.json(response, 401, { error: 'Open the authenticated local workbench link' });
            return;
        }
        if (request.method === 'GET' && path === '/api/bootstrap') {
            await this.workspace.reload();
            const configured = new Set([...this.models.getRegisteredProviderIds(), ...(this.options.provider ? [this.options.provider] : [])]);
            this.json(response, 200, { root: this.workspace.root, repos: this.workspace.config.repos, checks: this.workspace.config.checks, chats: this.chats, actions: uiActions, models: this.models.getModels().filter(model => configured.has(model.provider) || this.models.hasConfiguredAuth(model.provider)).map(model => ({ provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens })), approval: this.options.approval ?? 'ask', memory: this.options.memory ?? false });
            return;
        }
        if (request.method === 'POST' && path === '/api/chats') {
            const body = await this.body(request);
            this.json(response, 201, await this.create(String(body.title ?? '新对话'), typeof body.provider === 'string' ? body.provider : undefined, typeof body.model === 'string' ? body.model : undefined));
            return;
        }
        if (request.method === 'POST' && path === '/api/models/refresh') {
            if ([...this.sessions.values()].some(s => !s.snapshot().idle))
                throw new Error('请等待当前运行结束后刷新模型目录。');
            this.json(response, 200, await syncGatewayModels(this.agentDir, this.models));
            return;
        }
        if (path === '/api/events' && request.method === 'GET') {
            const chat = safeId(url.searchParams.get('chat') ?? '');
            await this.conversation(chat);
            response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            const since = Number(url.searchParams.get('since') ?? 0), client = { chat, response };
            this.subscribers.add(client);
            response.write(`data: ${JSON.stringify({ seq: this.sequence, type: 'refresh', chat, data: { reconnect: true } })}\n\n`);
            for (const event of this.events)
                if (event.seq > since && event.chat === chat)
                    response.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
            const timer = setInterval(() => response.write(': heartbeat\n\n'), 15000);
            request.once('close', () => { clearInterval(timer); this.subscribers.delete(client); });
            return;
        }
        const match = /^\/api\/chats\/([^/]+)(?:\/(.*))?$/.exec(path);
        if (!match) {
            this.json(response, 404, { error: 'Unknown workbench endpoint' });
            return;
        }
        const controller = await this.conversation(match[1]!), action = match[2] ?? '', task = controller.runtime.session.sessionManager.getSessionId();
        if (request.method === 'GET') {
            if (action.startsWith('data/')) {
                this.json(response, 200, await domainData(controller, action.slice(5), url.searchParams.get('q') ?? ''));
                return;
            }
            if (!action) {
                this.json(response, 200, controller.snapshot());
                return;
            }
            if (action === 'project') {
                const project = await projectOverview(this.workspace, { task }), git = [];
                for (const repo of project.repositories) {
                    const snapshot = await this.workspace.snapshotRepo(repo.id, false);
                    git.push({ id: repo.id, head: snapshot.head, branch: snapshot.branch });
                }
                this.json(response, 200, { ...project, git });
                return;
            }
            if (action === 'materials') {
                this.json(response, 200, await new ProjectContext(this.workspace).search(url.searchParams.get('q') ?? '', { task }, 30));
                return;
            }
            if (action.startsWith('materials/')) {
                this.json(response, 200, await new ProjectContext(this.workspace).read(safeId(action.slice('materials/'.length)), { task }));
                return;
            }
            if (action === 'source') {
                const line = Number(url.searchParams.get('line') ?? 1);
                const start = Number(url.searchParams.get('start') ?? Math.max(1, line - 8)), end = Number(url.searchParams.get('end') ?? line + 30);
                if (!Number.isSafeInteger(line) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 300)
                    throw new Error('源码阅读范围须为 1–301 行');
                this.json(response, 200, await readSource(this.workspace, String(url.searchParams.get('repo')), String(url.searchParams.get('file')), start, end));
                return;
            }
            if (action === 'files') {
                const repo = String(url.searchParams.get('repo')), query = (url.searchParams.get('q') ?? '').toLowerCase(), offset = Number(url.searchParams.get('offset') ?? 0);
                if (!Number.isSafeInteger(offset) || offset < 0 || query.length > 200)
                    throw new Error('Invalid file listing range');
                const paths = (await this.workspace.files(repo)).filter(file => file.toLowerCase().includes(query));
                this.json(response, 200, { repo, files: paths.slice(offset, offset + 200), total: paths.length, offset, next: offset + 200 < paths.length ? offset + 200 : null, note: '按原工作区排除规则显示注册仓库文件。' });
                return;
            }
            if (action === 'checkpoints') {
                this.json(response, 200, await this.workspace.checkpoints());
                return;
            }
            if (action === 'diff') {
                const checkpoint = url.searchParams.get('baseline');
                if (!checkpoint)
                    throw new Error('Choose a diff baseline');
                this.json(response, 200, await this.workspace.exclusive(async () => { const current = await this.workspace.checkpoint('workbench diff'); return { observation: await observeChanges(this.workspace, checkpoint), patches: await this.workspace.compare(checkpoint, current.id) }; }));
                return;
            }
            if (action === 'artifacts') {
                this.json(response, 200, await new Artifacts(this.workspace).list(task));
                return;
            }
            if (action.startsWith('artifacts/')) {
                const artifact = await new Artifacts(this.workspace).read(safeId(action.slice('artifacts/'.length)), task), bytes = await readFile(artifact.path), image = artifact.record.kind === 'screenshot';
                response.writeHead(200, { 'content-type': image ? 'image/png' : 'application/octet-stream', 'content-disposition': image ? 'inline' : `attachment; filename="${artifact.record.id}${artifact.record.extension}"`, 'cache-control': 'no-store' });
                response.end(bytes);
                return;
            }
            if (action === 'maps') {
                let names: string[] = [];
                try {
                    names = await readdir(join(this.workspace.data, 'task-readings'));
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw error;
                }
                const maps = [];
                for (const name of names.filter(name => /^task-reading-[a-z0-9-]+\.json$/.test(name)))
                    try {
                        maps.push(await new TaskReadingStore(this.workspace).open(name.slice(0, -5), task));
                    }
                    catch { /* Other task maps remain scoped. */ }
                this.json(response, 200, maps);
                return;
            }
        }
        if (request.method === 'POST') {
            const body = await this.body(request);
            if (action === 'settings') {
                this.json(response, 200, await controller.settings(body));
                return;
            }
            if (action === 'actions') {
                const name = String(body.action), definition = uiActions.find(a => a.id === name);
                if (!definition)
                    throw new Error('未知工作台操作。');
                const args = body.args ?? {};
                if (!args || typeof args !== 'object' || Array.isArray(args))
                    throw new Error('操作参数必须是对象。');
                // Explicit operator actions use the existing domain boundary; they are not forged model tool results.
                if (name === 'observer-question') {
                    this.json(response, 200, await domainAction(controller, name, args as Record<string, unknown>, new AbortController().signal));
                    return;
                }
                if (!controller.snapshot().idle)
                    throw new Error('请等待或取消当前操作。');
                void controller.perform(definition.title, signal => domainAction(controller, name, args as Record<string, unknown>, signal), { action: name, args });
                this.json(response, 202, { accepted: true });
                return;
            }
            if (action === 'prompt') {
                const text = String(body.text ?? '');
                void controller.start(text).catch(error => this.emit('notice', controller.chat.id, { type: 'error', text: redact(String(error), this.workspace.secrets) }));
                this.json(response, 202, { accepted: true });
                return;
            }
            if (action === 'cancel') {
                await controller.cancel();
                this.json(response, 200, { cancelled: true, idle: controller.runtime.session.isIdle });
                return;
            }
            if (action === 'answer') {
                controller.answer(String(body.id), body.value);
                this.json(response, 200, { answered: true });
                return;
            }
            if (action === 'fork') {
                await controller.fork(String(body.entry));
                this.json(response, 200, controller.chat);
                return;
            }
            if (action === 'branch') {
                this.json(response, 200, await controller.navigate(String(body.entry)));
                return;
            }
            if (action === 'restore') {
                await controller.prompt('/enigma-restore ' + JSON.stringify({ target: body.target, expected: body.expected, context: body.context === true }));
                this.json(response, 200, controller.snapshot());
                return;
            }
            if (action === 'rename') {
                const title = String(body.title ?? '').trim();
                if (!title || title.length > 120)
                    throw new Error('Invalid chat title');
                controller.chat.title = title;
                await this.persist(controller.chat);
                this.json(response, 200, controller.chat);
                return;
            }
            if (action === 'repo-add') {
                this.json(response, 200, await this.workspace.exclusive(() => this.workspace.addRepo(String(body.id), String(body.path), { access: body.readOnly === true ? 'read' : 'write', role: String(body.role ?? '') })));
                return;
            }
            if (action === 'material-add') {
                this.json(response, 200, await new ProjectContext(this.workspace).add({ title: String(body.title), task: body.private === true ? task : undefined, source: { kind: 'file', repo: String(body.repo), file: String(body.file) } }));
                return;
            }
            if (action === 'material-remove') {
                await new ProjectContext(this.workspace).remove(String(body.id), { task });
                this.json(response, 200, { removed: true });
                return;
            }
            if (action === 'runtime') {
                const id = String(body.id), operation = String(body.operation);
                if (body.kind === 'service') {
                    const manager = new ServiceManager(this.workspace);
                    if (operation === 'start')
                        this.json(response, 200, await manager.start(id, { task }));
                    else if (operation === 'stop')
                        this.json(response, 200, await manager.stop(id));
                    else if (operation === 'restart')
                        this.json(response, 200, await manager.restart(id, { task }));
                    else
                        throw new Error('Unknown service control');
                    return;
                }
                if (body.kind === 'background' && operation === 'cancel') {
                    this.json(response, 200, await new BackgroundRuns(this.workspace).cancel(id, task));
                    return;
                }
                if (body.kind === 'delegation' && operation === 'cancel') {
                    this.json(response, 200, await new Delegations(this.workspace).cancel(id, task));
                    return;
                }
                if (body.kind === 'wait' && operation === 'cancel') {
                    this.json(response, 200, await new TaskEvents(this.workspace).cancel(id, task));
                    return;
                }
                throw new Error('Unknown runtime control');
            }
            if (action === 'command') {
                const name = String(body.name);
                if (!['checkpoint', 'knowledge-organize', 'memory-organize', 'handoff-export', 'enigma-review'].includes(name))
                    throw new Error('Unsupported workbench command');
                await controller.prompt(`/${name} ${String(body.args ?? '')}`);
                this.json(response, 200, controller.snapshot());
                return;
            }
        }
        this.json(response, 404, { error: 'Unknown workbench action' });
    }
    async close() {
        for (const client of this.subscribers)
            client.response.end();
        this.subscribers.clear();
        for (const controller of new Set(this.sessions.values()))
            await controller.close();
        await this.catalogChain;
        this.server.closeAllConnections();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}
