import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager, type AgentSessionRuntime, type AgentSession, type ModelRuntime, type ExtensionUIContext, type ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { createEnigmaExtension } from './pi-extension.js';
import { createProjectExtension } from './pi-project.js';
import { createRuntimeExtension } from './pi-runtime.js';
import { createDeliveryExtension } from './pi-delivery.js';
import { createReuseExtension } from './pi-reuse.js';
import { createCollaborationExtension } from './pi-collaboration.js';
import { createLearningExtension } from './pi-learning.js';
import { createMemoryExtension } from './pi-memory.js';
import { createObserverExtension } from './pi-observer.js';
import handoffExtension from './pi-handoff.js';
import reviewExtension from './pi-review.js';
import { redact } from './storage.js';
import { skillPaths } from './skill-discovery.js';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/compat';
export interface ChatRecord {
    id: string;
    title: string;
    sessionFile: string;
    session: string;
    provider: string;
    model: string;
    createdAt: string;
    updatedAt: string;
    started?: boolean;
    thinking?: string;
    memory?: boolean;
    approval?: 'ask' | 'auto' | 'never';
}
export interface Dialog {
    id: string;
    kind: 'confirm' | 'select' | 'input' | 'editor';
    title: string;
    message?: string;
    options?: string[];
    value?: string;
}
export interface WorkbenchEvent {
    seq: number;
    type: string;
    chat: string;
    data: unknown;
}
export interface WorkbenchSessionOptions {
    workspace: Workspace;
    models: ModelRuntime;
    agentDir: string;
    memory: boolean;
    approval: 'ask' | 'auto' | 'never';
    emit: (type: string, chat: string, data: unknown) => void;
    persist: (chat: ChatRecord, previous?: ChatRecord) => Promise<void>;
}
/** UI host using public Pi runtime/session replacement. Domain tools stay in existing plugins. */
export class WorkbenchSession {
    runtime!: AgentSessionRuntime;
    readonly dialogs = new Map<string, {
        dialog: Dialog;
        finish: (value: unknown) => void;
    }>();
    readonly notices: {
        text: string;
        type: string;
    }[] = [];
    readonly statuses: Record<string, string> = {};
    readonly tools = new Map<string, {
        name: string;
        args?: unknown;
        state: string;
        result?: unknown;
    }>();
    private editor = '';
    protected unsubscribe?: () => void;
    protected closed = false;
    private inputRunning = false;
    private cancelRequested = false;
    protected inflight?: Promise<void>;
    protected operationAbort?: AbortController;
    operation?: {
        id: string;
        title: string;
        state: string;
        outcome?: string;
        result?: unknown;
        error?: string;
    };
    constructor(public chat: ChatRecord, readonly options: WorkbenchSessionOptions) { }
    protected emit(type: string, data: unknown) {
        if (!this.closed)
            this.options.emit(type, this.chat.id, data);
    }
    private safe(value: unknown) { return value === undefined ? null : JSON.parse(redact(JSON.stringify(value), this.options.workspace.secrets)); }
    async open(manager?: SessionManager) {
        const initial = manager ?? SessionManager.open(this.chat.sessionFile);
        this.runtime = await createAgentSessionRuntime(async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
            if (cwd !== this.options.workspace.root)
                throw new Error('Workbench session cwd must remain in its registered project');
            const workspace = await Workspace.open(cwd);
            const modelMethods = new Set<PropertyKey>(['stream', 'complete', 'streamSimple', 'completeSimple', 'streamDeferred', 'fetchDeferred']);
            const guardedModels = new Proxy(this.options.models, { get: (target, key) => {
                    const value = Reflect.get(target, key, target);
                    if (typeof value !== 'function')
                        return value;
                    return (...args: unknown[]) => {
                        if (modelMethods.has(key) && this.inputRunning && this.cancelRequested)
                            throw new Error('Workbench input cancelled before model dispatch');
                        return Reflect.apply(value, target, args);
                    };
                } });
            const cancellationGuard = (pi: import('@earendil-works/pi-coding-agent').ExtensionAPI) => { pi.on('tool_call', () => this.cancelRequested && this.inputRunning ? { block: true, terminate: true, reason: 'Workbench run was cancelled before tool dispatch' } : undefined); };
            const memory = this.chat.memory ?? this.options.memory, approval = this.chat.approval ?? this.options.approval;
            const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime: guardedModels, settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true } }),
                resourceLoaderOptions: { noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, additionalSkillPaths: await skillPaths(workspace),
                    extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval }), createProjectExtension({ workspace }),
                        createRuntimeExtension({ workspace, approval }), createDeliveryExtension({ workspace }), createReuseExtension({ workspace, approval }),
                        createCollaborationExtension({ workspace, approval, agentDir }), createLearningExtension({ workspace, knowledge: memory, approval }),
                        createMemoryExtension({ workspace, enabled: memory }), createObserverExtension({ enabled: true }), handoffExtension, reviewExtension, cancellationGuard] } });
            const model = this.options.models.getModel(this.chat.provider, this.chat.model);
            if (!model)
                throw new Error('Selected workbench model is unavailable');
            const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel: (this.chat.thinking ?? 'low') as import('@earendil-works/pi-ai').ThinkingLevel, noTools: 'builtin' });
            return { ...result, services, diagnostics: services.diagnostics };
        }, { cwd: this.options.workspace.root, agentDir: this.options.agentDir, sessionManager: initial });
        this.runtime.setBeforeSessionInvalidate(() => { this.unsubscribe?.(); this.unsubscribe = undefined; this.dismiss(); });
        this.runtime.setRebindSession(session => this.bind(session));
        await this.bind(this.runtime.session);
        return this;
    }
    protected async adopt(session: AgentSession) {
        const previous = { ...this.chat }, sessionId = session.sessionManager.getSessionId(), file = session.sessionManager.getSessionFile();
        if (!file)
            throw new Error('Workbench session was not persisted');
        if (sessionId !== this.chat.session)
            this.chat = { ...this.chat, id: randomUUID(), session: sessionId, sessionFile: file, title: `${this.chat.title} · 分支`, createdAt: new Date().toISOString() };
        this.chat.updatedAt = new Date().toISOString();
        await this.options.persist(this.chat, sessionId !== previous.session ? previous : undefined);
        if (sessionId !== previous.session)
            this.options.emit('conversation_replaced', previous.id, { chat: this.chat });
    }
    protected async bind(session: AgentSession) {
        await this.adopt(session);
        this.unsubscribe?.();
        this.unsubscribe = session.subscribe(event => {
            if (event.type === 'message_update') {
                const change = event.assistantMessageEvent;
                if (change.type === 'text_delta')
                    this.emit('text_delta', { text: redact(change.delta, this.options.workspace.secrets) });
            }
            if (event.type === 'tool_execution_start') {
                this.tools.set(event.toolCallId, { name: event.toolName, args: this.safe(event.args), state: 'running' });
                this.emit('tool', { id: event.toolCallId, ...this.tools.get(event.toolCallId) });
            }
            if (event.type === 'tool_execution_end') {
                const tool = this.tools.get(event.toolCallId) ?? { name: event.toolName, state: '' };
                tool.state = event.isError ? 'failed' : 'completed';
                tool.result = this.safe(event.result);
                this.tools.set(event.toolCallId, tool);
                this.emit('tool', { id: event.toolCallId, ...tool });
            }
            if (['message_end', 'agent_settled', 'agent_end', 'compaction_start', 'compaction_end', 'auto_retry_start', 'auto_retry_end'].includes(event.type))
                this.emit('refresh', { event: event.type });
        });
        await session.bindExtensions({ mode: 'rpc', uiContext: this.ui(), onError: error => { this.notices.push({ text: redact(JSON.stringify(error), this.options.workspace.secrets), type: 'error' }); this.emit('notice', this.notices.at(-1)); },
            commandContextActions: { waitForIdle: () => this.runtime.session.waitForIdle(), newSession: options => this.runtime.newSession(options), fork: (entry, options) => this.runtime.fork(entry, options),
                navigateTree: (entry, options) => this.runtime.session.navigateTree(entry, options), switchSession: async (path, options) => {
                    if (!path.startsWith(join(this.options.workspace.data, 'workbench', 'sessions')) && !path.startsWith(join(this.options.workspace.data, 'sessions')))
                        throw new Error('UI session switching is restricted to this project');
                    return await this.runtime.switchSession(path, options);
                }, reload: () => this.runtime.session.reload() }, abortHandler: () => { void this.cancel(); }, shutdownHandler: () => { void this.close(); } });
    }
    protected ui(): ExtensionUIContext {
        const noTerminal = () => { throw new Error('Terminal-only extension UI is unavailable in the web workbench'); };
        const methods: Record<string, unknown> = {
            confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) => this.dialog({ kind: 'confirm', title, message }, opts).then(value => value === true),
            select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) => this.dialog({ kind: 'select', title, options }, opts).then(value => typeof value === 'string' && options.includes(value) ? value : undefined),
            input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) => this.dialog({ kind: 'input', title, message: placeholder }, opts).then(value => typeof value === 'string' ? value : undefined),
            editor: (title: string, value?: string) => this.dialog({ kind: 'editor', title, value }).then(value => typeof value === 'string' ? value : undefined),
            notify: (text: string, type = 'info') => {
                const notice = { text: redact(text, this.options.workspace.secrets), type };
                this.notices.push(notice);
                if (this.notices.length > 50)
                    this.notices.shift();
                this.emit('notice', notice);
            },
            setStatus: (key: string, value?: string) => {
                if (value === undefined)
                    delete this.statuses[key];
                else
                    this.statuses[key] = redact(value, this.options.workspace.secrets);
                this.emit('status', this.statuses);
            },
            setWorkingMessage: (value?: string) => this.emit('working', { message: value }), setWorkingVisible: () => { }, setWorkingIndicator: () => { }, setHiddenThinkingLabel: () => { },
            setWidget: () => { }, setFooter: () => { }, setHeader: () => { }, setTitle: (value: string) => this.emit('title', { title: value }),
            setEditorText: (text: string) => { this.editor = text; this.emit('editor', { text }); }, getEditorText: () => this.editor, pasteToEditor: (text: string) => { this.editor += text; this.emit('editor', { text: this.editor }); },
            onTerminalInput: () => () => { }, custom: noTerminal, addAutocompleteProvider: noTerminal, setEditorComponent: noTerminal, getEditorComponent: () => undefined,
            getAllThemes: () => [], getTheme: () => undefined, setTheme: () => ({ success: false, error: 'Use workbench appearance settings' }), getToolsExpanded: () => true, setToolsExpanded: () => { },
        };
        return new Proxy(methods, { get(target, key) {
                if (typeof key === 'string' && key in target)
                    return target[key];
                throw new Error(`Unsupported web extension UI: ${String(key)}`);
            } }) as unknown as ExtensionUIContext;
    }
    protected dialog(input: Omit<Dialog, 'id'>, opts: ExtensionUIDialogOptions = {}) {
        const dialog: Dialog = { ...input, id: randomUUID(), title: redact(input.title, this.options.workspace.secrets), message: input.message ? redact(input.message, this.options.workspace.secrets) : undefined };
        return new Promise<unknown>(resolve => {
            let timer: NodeJS.Timeout | undefined;
            const abort = () => finish(undefined);
            const finish = (value: unknown) => {
                if (!this.dialogs.delete(dialog.id))
                    return;
                if (timer)
                    clearTimeout(timer);
                opts.signal?.removeEventListener('abort', abort);
                this.emit('dialog_closed', { id: dialog.id });
                resolve(value);
            };
            this.dialogs.set(dialog.id, { dialog, finish });
            if (opts.timeout)
                timer = setTimeout(abort, opts.timeout);
            opts.signal?.addEventListener('abort', abort, { once: true });
            if (opts.signal?.aborted)
                abort();
            else
                this.emit('dialog', dialog);
        });
    }
    answer(id: string, value: unknown) {
        const pending = this.dialogs.get(id);
        if (!pending)
            throw new Error('This approval/input is no longer pending');
        pending.finish(value);
    }
    private dismiss() {
        for (const pending of [...this.dialogs.values()])
            pending.finish(undefined);
    }
    snapshot() {
        const session = this.runtime.session, entries = session.sessionManager.getBranch(), messages = [], recordedTools = new Map<string, {
            name: string;
            args?: unknown;
            state: string;
            result?: unknown;
        }>();
        for (const entry of entries) {
            if (entry.type === 'message') {
                const message = entry.message;
                if (message.role === 'assistant')
                    for (const part of message.content)
                        if (part.type === 'toolCall')
                            recordedTools.set(part.id, { name: part.name, args: this.safe(part.arguments), state: 'recorded' });
                if (message.role === 'toolResult')
                    recordedTools.set(message.toolCallId, { ...recordedTools.get(message.toolCallId), name: message.toolName, state: message.isError ? 'failed' : 'completed', result: this.safe({ content: message.content, details: message.details }) });
                if (message.role === 'assistant' || message.role === 'user') {
                    const content = message.content, text = typeof content === 'string' ? content : content.filter(item => item.type === 'text').map(item => item.text).join('\n');
                    if (text) {
                        let visible = text;
                        if (message.role === 'user' && text.startsWith('工作台操作请求：'))
                            try {
                                const request = JSON.parse(text.slice('工作台操作请求：'.length)) as {
                                    title: string;
                                    request: {
                                        args?: {
                                            goal?: string;
                                            title?: string;
                                            label?: string;
                                        };
                                    };
                                };
                                visible = '项目工具 · ' + request.title + (request.request.args?.goal ? '\n' + request.request.args.goal : '');
                            }
                            catch { /* Corrupt or older user text remains visible verbatim. */ }
                        messages.push({ id: entry.id, role: message.role, text: redact(visible, this.options.workspace.secrets) });
                    }
                }
            }
            else if (entry.type === 'custom_message' && entry.display) {
                const content = entry.content, text = typeof content === 'string' ? content : content.filter(item => item.type === 'text').map(item => item.text).join('\n');
                messages.push({ id: entry.id, role: 'event', text: redact(text, this.options.workspace.secrets) });
            }
        }
        for (const [id, tool] of this.tools)
            recordedTools.set(id, tool);
        return { chat: this.chat, idle: session.isIdle && !this.inputRunning, operation: this.operation, thinking: session.thinkingLevel, thinkingLevels: session.getAvailableThinkingLevels(), memory: this.chat.memory ?? this.options.memory, approval: this.chat.approval ?? this.options.approval, messages: messages.slice(-200), tools: [...recordedTools].slice(-60).map(([id, tool]) => ({ id, ...tool })), dialogs: [...this.dialogs.values()].map(item => item.dialog), notices: this.notices, statuses: this.statuses,
            context: session.getContextUsage(), branch: entries.map(entry => ({ id: entry.id, parent: entry.parentId, type: entry.type })), tree: session.sessionManager.getEntries().map(entry => ({ id: entry.id, parent: entry.parentId, type: entry.type })) };
    }
    async prompt(text: string) {
        if (!text.trim() || text.length > 48000)
            throw new Error('Message must contain 1–48,000 characters');
        if (!this.runtime.session.isIdle || this.inputRunning)
            throw new Error('This conversation is already running; cancel or wait before sending another message');
        this.inputRunning = true;
        this.cancelRequested = false;
        this.tools.clear();
        this.emit('run_start', {});
        try {
            this.inflight = this.runtime.session.prompt(text);
            await this.inflight;
        }
        finally {
            this.inputRunning = false;
            this.inflight = undefined;
            this.chat.started = this.runtime.session.sessionManager.getBranch().some(entry => entry.type === 'message');
            this.chat.updatedAt = new Date().toISOString();
            await this.options.persist(this.chat);
            this.emit('refresh', { event: 'settled' });
        }
    }
    start(text: string) {
        if (!text.trim() || text.length > 48000 || !this.runtime.session.isIdle || this.inputRunning)
            throw new Error('Provide a bounded message in an idle conversation');
        return this.prompt(text);
    }
    async cancel() { this.cancelRequested = true; this.operationAbort?.abort(); this.dismiss(); await this.runtime.session.abort(); await this.inflight?.catch(() => { }); await this.runtime.session.waitForIdle(); this.emit('refresh', { event: 'cancelled' }); }
    async settings(input: {
        provider?: string;
        model?: string;
        thinking?: string;
        memory?: boolean;
        approval?: 'ask' | 'auto' | 'never';
    }) {
        if (!this.snapshot().idle)
            throw new Error('请等待当前操作结束后调整会话设置。');
        this.inputRunning = true;
        this.cancelRequested = false;
        const work = this.applySettings(input);
        this.inflight = work.then(() => { }, () => { });
        try {
            await work;
        }
        finally {
            this.inputRunning = false;
            this.inflight = undefined;
            this.emit('refresh', { event: 'settings' });
        }
        return this.snapshot();
    }
    private async applySettings(input: {
        provider?: string;
        model?: string;
        thinking?: string;
        memory?: boolean;
        approval?: 'ask' | 'auto' | 'never';
    }) {
        if (input.approval !== undefined && !['ask', 'auto', 'never'].includes(input.approval))
            throw new Error('Invalid approval');
        if (input.memory !== undefined && typeof input.memory !== 'boolean')
            throw new Error('Invalid memory setting');
        const session = this.runtime.session;
        const chosen = input.provider || input.model ? this.options.models.getModel(input.provider ?? this.chat.provider, input.model ?? this.chat.model) : session.model;
        if (!chosen)
            throw new Error('所选模型不可用。');
        if (input.thinking && !getSupportedThinkingLevels(chosen).includes(input.thinking as import('@earendil-works/pi-ai').ThinkingLevel))
            throw new Error('此模型不支持该思考级别。');
        if (input.provider || input.model) {
            const model = this.options.models.getModel(input.provider ?? this.chat.provider, input.model ?? this.chat.model);
            if (!model)
                throw new Error('所选模型不可用。');
            await session.setModel(model);
            this.chat.provider = model.provider;
            this.chat.model = model.id;
        }
        if (input.thinking) {
            if (!session.getAvailableThinkingLevels().includes(input.thinking as import('@earendil-works/pi-ai').ThinkingLevel))
                throw new Error('此模型不支持该思考级别。');
            session.setThinkingLevel(input.thinking as import('@earendil-works/pi-ai').ThinkingLevel);
        }
        this.chat.thinking = session.thinkingLevel;
        const reload = input.memory !== undefined && input.memory !== (this.chat.memory ?? this.options.memory) || input.approval !== undefined && input.approval !== (this.chat.approval ?? this.options.approval);
        if (input.memory !== undefined)
            this.chat.memory = input.memory;
        if (input.approval !== undefined) {
            if (!['ask', 'auto', 'never'].includes(input.approval))
                throw new Error('Invalid approval');
            this.chat.approval = input.approval;
        }
        await this.options.persist(this.chat);
        if (reload) {
            const manager = this.runtime.session.sessionManager;
            this.unsubscribe?.();
            this.dismiss();
            await this.runtime.dispose();
            await this.open(manager);
        }
        this.emit('refresh', { event: 'settings' });
        return this.snapshot();
    }
    async runCommand(name: string, args: string) {
        const before = this.notices.length;
        await this.runtime.session.prompt(`/${name} ${args}`);
        const notices = this.notices.slice(before), error = notices.find(n => n.type === 'error');
        if (error)
            throw new Error(error.text);
        return { chat: this.chat, notices };
    }
    protected operationRequestText(title: string, request: unknown) { return '工作台操作请求：' + JSON.stringify(this.safe({ title, request })); }
    async perform(title: string, action: (signal: AbortSignal) => Promise<unknown>, request?: unknown) {
        if (!this.snapshot().idle)
            throw new Error('请等待或取消当前运行后再操作。');
        this.inputRunning = true;
        this.cancelRequested = false;
        const controller = new AbortController(), operation: NonNullable<WorkbenchSession['operation']> = { id: randomUUID(), title, state: 'running' };
        this.operationAbort = controller;
        this.operation = operation;
        this.emit('run_start', {});
        const work = (async () => {
            try {
                if (request !== undefined) {
                    this.runtime.session.sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text: this.operationRequestText(title, request) }], timestamp: Date.now() });
                    this.runtime.session.refreshContext();
                    this.chat.started = true;
                    await this.options.persist(this.chat);
                }
                controller.signal.throwIfAborted();
                const result = await action(controller.signal);
                operation.result = this.safe(result);
                operation.state = controller.signal.aborted ? 'cancelled' : 'completed';
                const value = result as {
                    status?: string;
                    verification?: {
                        status?: string;
                    };
                    report?: {
                        status?: string;
                    };
                } | null;
                operation.outcome = value?.verification?.status ?? value?.report?.status ?? value?.status;
            }
            catch (error) {
                operation.state = controller.signal.aborted ? 'cancelled' : 'failed';
                operation.error = redact(String(error), this.options.workspace.secrets);
            }
            try {
                const summary = JSON.stringify(this.safe(operation));
                this.runtime.session.sessionManager.appendCustomMessageEntry('enigma.workbench-operation', summary.slice(0, 20000), false, { operation: operation.id, title, state: operation.state });
                this.runtime.session.refreshContext();
            }
            catch (error) {
                operation.state = 'unknown';
                operation.error = '操作记录未完整保存：' + redact(String(error), this.options.workspace.secrets);
            }
            finally {
                this.inputRunning = false;
                this.operationAbort = undefined;
                this.inflight = undefined;
                this.emit('refresh', { event: 'settled' });
            }
        })();
        this.inflight = work;
        await work;
        return operation;
    }
    async fork(entry: string) {
        if (!this.runtime.session.isIdle || this.inputRunning)
            throw new Error('Fork requires a fully settled conversation');
        return await this.runtime.fork(entry, { position: 'at' });
    }
    async navigate(entry: string) {
        if (!this.runtime.session.isIdle || this.inputRunning)
            throw new Error('Branch switching requires an idle conversation');
        const result = await this.runtime.session.navigateTree(entry, { summarize: false });
        this.emit('refresh', { event: 'branch' });
        return result;
    }
    async close() {
        if (this.closed)
            return;
        await this.cancel();
        await this.runtime.dispose();
        this.closed = true;
        this.unsubscribe?.();
    }
}
