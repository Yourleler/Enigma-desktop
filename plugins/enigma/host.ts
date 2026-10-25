import { withNativeEngineeringExecution, nativeEngineeringPolicy } from './execution-policy.ts';
import { isReadOnlyPermissionMode } from '../../core/session-permission-mode.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '../../lib/pi-sdk/index.ts';
import { Workspace, projectOverview, Artifacts, ProjectContext } from 'enigma-next';
import { readJson, writeJson, safeId, redact, hash } from 'enigma-next/storage';
import { WorkbenchSession, type Dialog } from 'enigma-next/workbench-session';
import { domainAction, domainData, uiActions } from 'enigma-next/workbench-domain';
import { createEnigmaExtension } from 'enigma-next/pi-extension';
import { createProjectExtension } from 'enigma-next/pi-project';
import { createRuntimeExtension } from 'enigma-next/pi-runtime';
import { createDeliveryExtension } from 'enigma-next/pi-delivery';
import { createReuseExtension } from 'enigma-next/pi-reuse';
import { createCollaborationExtension } from 'enigma-next/pi-collaboration';
import { createLearningExtension } from 'enigma-next/pi-learning';
import { createMemoryExtension } from 'enigma-next/pi-memory';
import { createObserverExtension } from 'enigma-next/pi-observer';
import { createHandoffExtension } from 'enigma-next/pi-handoff';
import { createReviewExtension } from 'enigma-next/pi-review';
import { collectUserNotes } from 'enigma-next/pi-session';
import { PlanStore } from 'enigma-next';
import type { ExtensionAPI, ExtensionContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';

type Binding = { root: string; memory: boolean; sessionPath: string; sessionId?: string };
const hosts = new WeakMap<object, EngineeringHost>();

/** The only Hana-facing adapter. Engineering code never owns a second main session. */
export function engineeringHost(engine: any): EngineeringHost {
  let host = hosts.get(engine);
  if (!host) { host = new EngineeringHost(engine); hosts.set(engine, host); }
  return host;
}

function scopedFactory(factory: (pi: ExtensionAPI) => void | Promise<void>, workspace: Workspace, engine: any, sessionPath: string) {
  return (pi: ExtensionAPI) => {
    const scope = (ctx: ExtensionContext) => Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, { cwd: workspace.root });
    const proxy = new Proxy(pi, { get(target, key) {
      if (key === 'on') return (name: any, handler: any) => target.on(name, (async (event: any, ctx: ExtensionContext) => {
        const result = await withNativeEngineeringExecution(engine, workspace, sessionPath, async () => handler(event, scope(ctx)));
        if (name === 'before_agent_start' && typeof result?.systemPrompt === 'string' && result.systemPrompt.startsWith(event.systemPrompt)) {
          // Keep the host's signed/cacheable prefix stable. Dynamic repository facts remain turn context.
          const content = result.systemPrompt.slice(event.systemPrompt.length);
          return { ...result, systemPrompt: event.systemPrompt, message: { customType: 'enigma.engineering-context', content, display: false } };
        }
        return result;
      }) as any);
      if (key === 'registerCommand') return (name: string, definition: any) => target.registerCommand(name, { ...definition, handler: (args: string, ctx: any) => withNativeEngineeringExecution(engine, workspace, sessionPath, async () => definition.handler(args, scope(ctx))) });
      if (key === 'registerTool') return (definition: any) => target.registerTool({ ...definition, execute: (...args: any[]) => {
        if (engine.pluginManager?.getPlugin && engine.pluginManager.getPlugin('enigma')?.status !== 'loaded') throw new Error('Engineering plugin is disabled');
        if (args[4]) args[4] = scope(args[4]);
        return withNativeEngineeringExecution(engine, workspace, sessionPath, async () => {
          const result = await definition.execute(...args);
          if (definition.name === 'artifact_manage' && args[1]?.action === 'add') {
            const files = await engineeringHost(engine).registerArtifacts(sessionPath);
            result.details = { ...result.details, mediaItems: files };
          }
          return result;
        });
      } });
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    return factory(proxy);
  };
}

export class EngineeringHost {
  private bindings?: Record<string, Binding>;
  private loading?: Promise<Record<string, Binding>>;
  private readonly sessions = new Map<string, NativeEngineeringSession>();
  private readonly overviews = new Map<string, { at: number; value: unknown }>();
  readonly dialogs = new Map<string, { dialog: Dialog; sessionPath: string }>();
  readonly engine: any;
  constructor(engine: any) { this.engine = engine; }
  isBusy(sessionPath: string) { return this.sessions.get(sessionPath)?.operation?.state === 'running'; }
  async dispose() {
    for (const id of this.dialogs.keys()) this.engine.confirmStore?.resolve(id, 'rejected');
    await Promise.all([...this.sessions.values()].map(controller => controller.detach()));
    this.sessions.clear(); this.dialogs.clear(); this.overviews.clear();
  }
  isEnabled() {
    if (!this.engine.pluginManager?.getPlugin) return true;
    return this.engine.pluginManager.getPlugin('enigma')?.status === 'loaded';
  }
  private get configPath() { return path.join(this.engine.hanakoHome, 'user', 'enigma-bindings.json'); }
  private async load() {
    if (this.bindings) return this.bindings;
    if (!this.loading) this.loading = (async () => {
      let value: { schema: number; sessions: Record<string, Binding> };
      try { value = await readJson(this.configPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; value = { schema: 1, sessions: {} }; }
      if (value.schema !== 1 || !value.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions)
        || Object.values(value.sessions).some(binding => !binding || typeof binding.root !== 'string' || !path.isAbsolute(binding.root)
          || typeof binding.memory !== 'boolean' || typeof binding.sessionPath !== 'string')) throw new Error('Invalid engineering session bindings');
      this.bindings = value.sessions;
      return this.bindings;
    })();
    try { return await this.loading; } catch (error) { this.loading = undefined; throw error; }
  }
  async binding(sessionPath: string): Promise<Binding | null> {
    const bindings = await this.load(), id = this.engine.getSessionIdForPath?.(sessionPath);
    return (id && bindings[id]) || bindings[sessionPath] || null;
  }
  async saveBinding(sessionPath: string, input: Pick<Binding, 'root' | 'memory'>) {
    const bindings = await this.load(), sessionId = this.engine.getSessionIdForPath?.(sessionPath) || undefined;
    const key = sessionId || sessionPath;
    bindings[key] = { ...input, sessionPath, sessionId };
    if (sessionId) delete bindings[sessionPath];
    await writeJson(this.configPath, { schema: 1, sessions: bindings });
  }
  async inherit(sourcePath: string, targetPath: string) {
    const binding = await this.binding(sourcePath);
    if (!binding || !this.isEnabled()) return;
    const workspace = await Workspace.open(binding.root);
    const source = this.engine.getSessionByPath(sourcePath)?.sessionManager || SessionManager.open(sourcePath);
    const target = SessionManager.open(targetPath);
    const previous = await readJson<any>(path.join(workspace.data, `session-${safeId(source.getSessionId())}.json`));
    const sourceNotes = collectUserNotes(source), targetNotes = collectUserNotes(target);
    const surviving = new Set(targetNotes.keys()), texts = new Set([...targetNotes.values()].map(note => note.text));
    const requirementEntries = [...new Set([...(previous.requirementEntries || []), ...source.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'user').map(entry => entry.id)])];
    const missing = requirementEntries.filter(id => !surviving.has(id)).map(id => {
      const note = sourceNotes.get(id); if (!note) throw new Error('Latest original user requirement is missing in the source conversation');
      return note.text;
    });
    const requirements = [...new Set([...(previous.requirements || []), ...missing])].filter(text => !texts.has(text));
    const planFile = `active-plan-${safeId(target.getSessionId())}.json`;
    const plan = await new PlanStore(workspace, previous.planFile).current();
    if (plan) await new PlanStore(workspace, planFile).create({ goal: plan.goal, steps: plan.steps.map(step => ({ id: step.id, repo: step.repo, goal: step.goal, requires: step.requires, checks: step.checks })) });
    await writeJson(path.join(workspace.data, `session-${safeId(target.getSessionId())}.json`), {
      schema: 1, mode: 'managed', requirements, requirementEntries: requirementEntries.filter(id => surviving.has(id)),
      reviewEntries: requirements.map((_text, index) => `legacy-${index}`), reviewCursor: '0:0', requests: 0,
      inheritedRequests: (previous.requests || 0) + (previous.inheritedRequests || 0), corrections: 0, evidence: [], lastVerification: 'unverified',
      sessionFile: targetPath, planFile, handoff: { mode: 'continue', sourceSession: source.getSessionId() },
    });
    await this.saveBinding(targetPath, binding);
    await this.engine.reloadSessionRuntime(targetPath, { refreshCapabilitySnapshots: true });
  }
  async prepare(sessionPath: string | null) {
    if (!sessionPath || !this.isEnabled()) return null;
    const binding = await this.binding(sessionPath);
    if (!binding) return null;
    const workspace = await Workspace.open(binding.root);
    nativeEngineeringPolicy(this.engine, workspace, sessionPath);
    const nativeManager = SessionManager.open(sessionPath);
    const statePath = path.join(workspace.data, `session-${safeId(nativeManager.getSessionId())}.json`);
    try { await fs.access(statePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeJson(statePath, { schema: 1, requirements: [], requirementEntries: [], reviewEntries: [], evidence: [],
        requests: 0, corrections: 0, mode: 'managed', lastVerification: 'unverified',
        planFile: `active-plan-${safeId(nativeManager.getSessionId())}.json` });
    }
    const agentDir = path.dirname(this.engine.modelsJsonPath);
    const approval = 'ask' as const;
    const factories = [createEnigmaExtension({ workspace, approval, managed: true }), createProjectExtension({ workspace }),
      createRuntimeExtension({ workspace, approval }), createDeliveryExtension({ workspace }), createReuseExtension({ workspace, approval }),
      createCollaborationExtension({ workspace, approval, agentDir }), createLearningExtension({ workspace, approval, knowledge: binding.memory }),
      createMemoryExtension({ workspace, enabled: binding.memory }), createObserverExtension({ enabled: true, root: workspace.root }), createHandoffExtension({ workspace }), createReviewExtension({ workspace, agentDir, modelRuntime: await this.engine.modelRegistry.ready() })];
    return { workspace, binding, factories: factories.map(factory => scopedFactory(factory, workspace, this.engine, sessionPath)) };
  }
  async attach(sessionPath: string, session: any) {
    const binding = await this.binding(sessionPath);
    if (!binding) return null;
    const previous = this.sessions.get(sessionPath);
    if (previous?.runtime.session === session) return previous;
    await previous?.detach();
    const workspace = await Workspace.open(binding.root);
    nativeEngineeringPolicy(this.engine, workspace, sessionPath);
    const models = await this.engine.modelRegistry.ready();
    const controller = new NativeEngineeringSession(this, sessionPath, session, workspace, models, binding);
    this.sessions.set(sessionPath, controller);
    try { await controller.open(); return controller; }
    catch (error) { this.sessions.delete(sessionPath); throw error; }
  }
  async controller(sessionPath: string) {
    if (!this.isEnabled()) throw new Error('Engineering plugin is disabled');
    const session = this.engine.getSessionByPath(sessionPath) || await this.engine.ensureSessionLoaded(sessionPath);
    if (!session) throw new Error('Native session unavailable');
    const controller = await this.attach(sessionPath, session);
    if (!controller) throw new Error('Select an engineering workspace for this conversation first');
    controller.chat.provider = session.model?.provider || '';
    controller.chat.model = session.model?.id || '';
    return controller;
  }
  async connect(sessionPath: string, root: string, memory = false) {
    if (!this.isEnabled()) throw new Error('Engineering plugin is disabled');
    const session = this.engine.getSessionByPath(sessionPath) || await this.engine.ensureSessionLoaded(sessionPath);
    if (!session?.isIdle) throw new Error('Wait for or cancel active work before changing the engineering workspace');
    const workspace = await Workspace.open(root);
    if (!workspace.config.repos.length) {
      const isGitRoot = await fs.access(path.join(workspace.root, '.git')).then(() => true, error => {
        if (error.code !== 'ENOENT') throw error;
        return false;
      });
      if (isGitRoot) await workspace.exclusive(() => workspace.addRepo('main', workspace.root, { role: '主要工程仓库', access: 'write' }));
    }
    const previous = await this.binding(sessionPath);
    await this.saveBinding(sessionPath, { root: workspace.root, memory });
    try { await this.engine.reloadSessionRuntime(sessionPath, { refreshCapabilitySnapshots: true }); }
    catch (error) {
      if (previous) await this.saveBinding(sessionPath, previous);
      else {
        const bindings = await this.load(), id = this.engine.getSessionIdForPath?.(sessionPath);
        if (id) delete bindings[id]; delete bindings[sessionPath];
        await writeJson(this.configPath, { schema: 1, sessions: bindings });
      }
      throw new Error(`Engineering workspace was not switched: ${String(error)}`);
    }
    this.overviews.delete(sessionPath);
    return this.snapshot(sessionPath);
  }
  async snapshot(sessionPath: string) {
    if (!this.isEnabled()) return { connected: false, disabled: true, groups: engineeringGroups, actions: [] };
    const binding = await this.binding(sessionPath);
    if (!binding) return { connected: false, groups: engineeringGroups, actions: uiActions };
    const controller = await this.controller(sessionPath);
    const cached = this.overviews.get(sessionPath);
    const overview = cached && Date.now() - cached.at < 10000 ? cached.value : await projectOverview(controller.options.workspace, { task: controller.chat.session });
    if (!cached || cached.value !== overview) this.overviews.set(sessionPath, { at: Date.now(), value: overview });
    return controller.safeSnapshot({ connected: true, root: binding.root, memory: binding.memory, groups: engineeringGroups,
      actions: uiActions, sessionPath, sessionId: this.engine.getSessionIdForPath?.(sessionPath),
      overview,
      state: controller.snapshot(), dialogs: [...this.dialogs.values()].filter(item => item.sessionPath === sessionPath).map(item => item.dialog) });
  }
  async data(sessionPath: string, group: string, query: string) {
    const controller = await this.controller(sessionPath);
    const workspace = controller.options.workspace;
    if (group === 'project') return controller.safeSnapshot(await projectOverview(workspace, { task: controller.chat.session }));
    if (group === 'materials') return controller.safeSnapshot(await new ProjectContext(workspace).search(query, { task: controller.chat.session }, 30).then(result => result.items));
    if (group === 'artifacts') return controller.safeSnapshot((await new Artifacts(workspace).list(controller.chat.session)).map(item => ({ ...item.record, sourceCurrent: item.sourceCurrent, evidenceStatus: item.evidence })));
    if (group === 'choices') {
      const choices = await domainData(controller, group, query) as object;
      return controller.safeSnapshot({ ...choices, checkpoints: await workspace.checkpoints(),
        materials: await new ProjectContext(workspace).search(query, { task: controller.chat.session }, 30).then(result => result.items), entries: controller.snapshot().messages });
    }
    return controller.safeSnapshot(await domainData(controller, group, query));
  }
  async registerArtifacts(sessionPath: string) {
    const controller = this.sessions.get(sessionPath);
    if (!controller) return [];
    const artifacts = new Artifacts(controller.options.workspace), files = [];
    for (const artifact of await artifacts.list(controller.chat.session)) {
      const record = artifact.record;
      const file = this.engine.registerSessionFile({ sessionPath, sessionId: this.engine.getSessionIdForPath(sessionPath),
        filePath: artifact.path, label: record.title + record.extension, origin: 'plugin_output', storageKind: 'external' });
      files.push({ type: 'session_file', fileId: file.fileId || file.id, sessionId: this.engine.getSessionIdForPath(sessionPath),
        sessionPath, filePath: artifact.path, label: record.title + record.extension });
    }
    return files;
  }
  async action(sessionPath: string, action: string, args: Record<string, unknown>) {
    const definition = uiActions.find(item => item.id === action);
    if (!definition) throw new Error('Unknown engineering action');
    const controller = await this.controller(sessionPath);
    if (definition.effect && isReadOnlyPermissionMode(this.engine.getSessionPermissionMode(sessionPath))) throw new Error('Current session is read-only');
    if (!controller.snapshot().idle) throw new Error('Wait for or cancel current work before starting another operation');
    void controller.perform(definition.title, signal => withNativeEngineeringExecution(this.engine, controller.options.workspace, sessionPath, async () => {
      const result = await domainAction(controller, action, args, signal);
      if (action !== 'artifact-add') return result;
      return { ...result as object, sessionFiles: await this.registerArtifacts(sessionPath) };
    }), { action, args })
      .catch(error => this.publish(sessionPath, 'operation_error', { error: String(error) }))
      .finally(() => this.overviews.delete(sessionPath));
    // Polling keeps approval/cancellation available while long operations are running.
    return { operation: controller.operation, sessionPath };
  }
  async cancel(sessionPath: string) {
    for (const [id, item] of this.dialogs) if (item.sessionPath === sessionPath) this.engine.confirmStore?.resolve(id, 'rejected');
    const controller = this.sessions.get(sessionPath);
    if (controller) await controller.cancel(); else await this.engine.getSessionByPath(sessionPath)?.abort();
    return { cancelled: true }; }
  async content(sessionPath: string, input: { repo?: string; file?: string; resource?: string; artifact?: string; maxBytes?: number }) {
    const controller = await this.controller(sessionPath), workspace = controller.options.workspace;
    if (input.resource) return controller.safeSnapshot(await new ProjectContext(workspace).read(input.resource, { task: controller.chat.session }));
    if (input.artifact) {
      const artifact = await new Artifacts(workspace).read(input.artifact, controller.chat.session);
      const content = artifact.record.bytes <= 1024 * 1024 && artifact.record.kind !== 'screenshot' ? await fs.readFile(artifact.path, 'utf8') : '';
      return controller.safeSnapshot({ ...artifact, content });
    }
    if (!input.repo || !input.file) throw new Error('Repository and relative file are required');
    const file = await workspace.path(input.repo, input.file);
    const stat = await fs.stat(file);
    const limit = Math.min(1024 * 1024, Math.max(1024, input.maxBytes || 256000));
    if (!stat.isFile() || stat.size > limit) throw new Error('Select a regular file within the preview size limit');
    const bytes = await fs.readFile(file);
    return controller.safeSnapshot({ repo: input.repo, file: input.file, content: bytes.toString('utf8'), version: hash(bytes), size: bytes.length, modifiedAt: stat.mtimeMs });
  }
  async confirm(sessionPath: string, dialog: Omit<Dialog, 'id'>, opts: ExtensionUIDialogOptions = {}) {
    if (isReadOnlyPermissionMode(this.engine.getSessionPermissionMode(sessionPath))) return undefined;
    const store = this.engine.confirmStore;
    if (!store) throw new Error('Native confirmation service unavailable');
    if (dialog.kind === 'confirm' && this.engine.getSessionPermissionMode(sessionPath) === 'operate') return true;
    if (dialog.kind === 'confirm' && this.engine.getSessionPermissionMode(sessionPath) === 'auto') {
      const binding = await this.binding(sessionPath);
      const manager = this.engine.getSessionByPath(sessionPath)?.sessionManager;
      const visibleTranscript = (manager?.getBranch() || []).filter(entry => entry.type === 'message' && ['user','assistant'].includes(entry.message.role)).slice(-12).map(entry => {
        const content = entry.message.content;
        const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        return { role: entry.message.role, text: text.length > 2000 ? text.slice(0,2000) + '…[truncated]' : text };
      });
      const userIntentSummary = visibleTranscript.filter(entry => entry.role === 'user').at(-1)?.text || '';
      const workspace = await Workspace.open(binding.root);
      const sessionState = await readJson<{ requirements?: string[]; requirementEntries?: string[] }>(path.join(workspace.data, `session-${safeId(manager.getSessionId())}.json`));
      const notes = collectUserNotes(manager), preserved = (sessionState.requirementEntries || []).map(id => notes.get(id)).filter(Boolean)
        .map(note => ({ role: 'user', text: note.text.length > 2000 ? note.text.slice(0,2000) + '…[truncated]' : note.text }));
      for (const text of sessionState.requirements || []) preserved.push({ role: 'user', text: text.slice(0,2000) });
      const currentTexts = new Set(visibleTranscript.map(item => item.text));
      for (const item of preserved.slice(-8)) if (!currentTexts.has(item.text)) visibleTranscript.push(item);
      const registeredChecks = JSON.stringify(workspace.config.checks.map(check => ({ id: check.id, repo: check.repo,
        cwd: workspace.repo(check.repo).root, argv: check.argv, joint: check.joint === true })));
      const registeredRepositories = JSON.stringify(workspace.config.repos.map(repo => ({ id: repo.id, root: repo.root, access: repo.access })));
      const decision = await this.engine.approvalGateway.review({ toolName: 'enigma_engineering', sessionPath,
        sideEffect: { summary: dialog.message, kind: 'engineering_operation', registeredChecks, registeredRepositories } }, {
        cwd: binding?.root, workspaceFolders: binding ? [binding.root] : [], authorizedFolders: this.engine.getSessionAuthorizedFolders(sessionPath),
        userIntentSummary: userIntentSummary || preserved.at(-1)?.text || '', visibleTranscript: visibleTranscript.slice(-20), sessionPath });
      this.publish(sessionPath, 'approval', decision);
      if (decision.action !== 'allow') throw new Error(`Automatic approval review rejected the engineering action: ${decision.reason}`);
      return true;
    }
    const { confirmId, promise } = store.create('engineering', dialog, { sessionPath, sessionId: this.engine.getSessionIdForPath?.(sessionPath) }, opts.timeout);
    this.dialogs.set(confirmId, { dialog: { ...dialog, id: confirmId }, sessionPath });
    const abort = () => store.resolve(confirmId, 'rejected');
    opts.signal?.addEventListener('abort', abort, { once: true });
    if (opts.signal?.aborted) abort();
    this.publish(sessionPath, 'dialog', { ...dialog, id: confirmId });
    try {
      const result = await promise;
      if (isReadOnlyPermissionMode(this.engine.getSessionPermissionMode(sessionPath)) || opts.signal?.aborted) return undefined;
      return result.action === 'confirmed' ? dialog.kind === 'confirm' ? true : result.value : undefined;
    }
    finally { opts.signal?.removeEventListener('abort', abort); this.dialogs.delete(confirmId); this.publish(sessionPath, 'refresh', {}); }
  }
  publish(sessionPath: string, type: string, data: unknown) {
    this.engine.emitBoundSessionEvent({ type: 'enigma_event', sessionPath, event: type, data }, sessionPath);
  }
}

class NativeEngineeringSession extends WorkbenchSession {
  readonly host: EngineeringHost;
  readonly nativePath: string;
  readonly nativeSession: any;
  private createdContext?: { sessionPath: string; sessionId: string };
  constructor(host: EngineeringHost, nativePath: string, nativeSession: any, workspace: Workspace, models: any, binding: Binding) {
    super({ id: host.engine.getSessionIdForPath?.(nativePath) || nativeSession.sessionManager.getSessionId(),
      session: nativeSession.sessionManager.getSessionId(), sessionFile: nativePath, title: '工程任务',
      provider: nativeSession.model?.provider || '', model: nativeSession.model?.id || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), memory: binding.memory },
    { workspace, models, agentDir: path.dirname(host.engine.modelsJsonPath), memory: binding.memory, approval: 'ask',
      emit: (type, _chat, data) => host.publish(nativePath, type, data), persist: async () => {} });
    this.host = host; this.nativePath = nativePath; this.nativeSession = nativeSession;
  }
  safeSnapshot(value: unknown) { return value === undefined ? null : JSON.parse(redact(JSON.stringify(value), this.options.workspace.secrets)); }
  async open() {
    // The facade delegates lifecycle changes to Hana; it does not construct a Pi runtime.
    this.runtime = { session: this.nativeSession, dispose: async () => {}, newSession: async (options: any = {}) => {
      const manager = SessionManager.create(this.options.workspace.root, path.dirname(this.nativePath), { parentSession: this.nativePath });
      await options.setup?.(manager);
      const targetPath = manager.getSessionFile();
      await this.host.saveBinding(targetPath, { root: this.options.workspace.root, memory: this.chat.memory === true });
      const result = await this.host.engine.createSession(manager, this.options.workspace.root, false, this.nativeSession.model, { visibleInSessionList: true, thinkingLevel: this.nativeSession.thinkingLevel });
      this.createdContext = { sessionPath: result.sessionPath, sessionId: result.sessionId };
      this.host.publish(this.nativePath, 'new_context', { sessionPath: result.sessionPath, sessionId: result.sessionId });
      return { cancelled: false };
    }, fork: async (entry: string) => {
      const result = await this.host.engine.forkSessionAtNode({ sessionPath: this.nativePath, target: { role: 'user', entryId: entry } });
      return { cancelled: false, ...result };
    }, switchSession: async (targetPath: string) => {
      const binding = await this.host.binding(targetPath);
      if (binding?.root !== this.options.workspace.root) throw new Error('Conversation switch belongs to another engineering workspace');
      await this.host.engine.switchSession(targetPath);
      return { cancelled: false };
    } } as any;
    await this.bind(this.nativeSession);
    return this;
  }
  protected async adopt() { /* Hana owns the session identity and lifecycle sidecars. */ }
  protected operationRequestText(title: string, request: any) {
    this.nativeSession.sessionManager.appendCustomEntry('enigma.operation-request', this.safeSnapshot({ title, request }));
    const args = request?.args || {};
    const details = [args.goal && `目标：${args.goal}`, args.repo && `仓库：${args.repo}`, args.file && `文件：${args.file}`, args.title && `名称：${args.title}`].filter(Boolean);
    return `请执行工作台操作：${title}。${details.length ? '\n' + details.join('\n') : ''}`;
  }
  protected dialog(input: Omit<Dialog, 'id'>, opts: ExtensionUIDialogOptions = {}) {
    return this.host.confirm(this.nativePath, input, opts);
  }
  async detach() {
    // Closing the UI adapter must not dispose Hana's native session.
    this.operationAbort?.abort();
    await this.inflight;
    this.closed = true;
    this.unsubscribe?.();
  }
  async runCommand(name: string, args: string) {
    if (name === 'new-context') this.createdContext = undefined;
    const result = await super.runCommand(name, args);
    let createdSession: any;
    if (name === 'new-context') createdSession = this.createdContext;
    if (name === 'branch-code') {
      const input = JSON.parse(args), fork = await Workspace.open(path.resolve(this.options.workspace.root, input.destination));
      const start = await readJson<{ sessionFile: string; sessionId: string }>(path.join(fork.data, 'session-start.json'));
      const manager = SessionManager.forkFrom(start.sessionFile, fork.root, path.dirname(this.nativePath));
      const targetPath = manager.getSessionFile();
      const previous = await readJson<any>(path.join(fork.data, `session-${safeId(start.sessionId)}.json`));
      await writeJson(path.join(fork.data, `session-${safeId(manager.getSessionId())}.json`), { ...previous, sessionFile: targetPath });
      await this.host.saveBinding(targetPath, { root: fork.root, memory: this.chat.memory === true });
      createdSession = await this.host.engine.createSession(manager, fork.root, false, this.nativeSession.model, { visibleInSessionList: true, thinkingLevel: this.nativeSession.thinkingLevel });
      this.host.publish(this.nativePath, 'code_fork', { sessionPath: createdSession.sessionPath, sessionId: createdSession.sessionId, root: fork.root });
    }
    this.host.engine.syncSessionBranchHead(this.nativePath, this.nativeSession.sessionManager, 'engineering_command');
    this.host.publish(this.nativePath, 'workspace_changed', { repos: this.options.workspace.config.repos.map(repo => repo.id) });
    return createdSession ? { ...result, createdSession: { sessionPath: createdSession.sessionPath, sessionId: createdSession.sessionId } } : result;
  }
}

export const engineeringGroups = [
  { id: 'project', label: '项目与仓库', placement: 'sidebar' }, { id: 'plan', label: '计划', placement: 'task' },
  { id: 'collaboration', label: '协作', placement: 'task' }, { id: 'timeline', label: '时光机', placement: 'task' },
  { id: 'observer', label: '运行状态', placement: 'task' }, { id: 'reading', label: '代码', placement: 'content' },
  { id: 'materials', label: '资料', placement: 'content' }, { id: 'artifacts', label: '产物', placement: 'content' },
  { id: 'environment', label: '环境', placement: 'content' }, { id: 'review', label: '审查', placement: 'content' },
  { id: 'memory', label: '记忆', placement: 'sidebar' }, { id: 'skills', label: '技能', placement: 'sidebar' },
  { id: 'handoff', label: '背景交接', placement: 'task' },
];
