import { isAbsolute, join, relative, sep } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ModelRuntime as Runtime, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { DelegationSpec } from './delegation.js';
import { Workspace } from './workspace.js';
import { createEnigmaExtension } from './pi-extension.js';
import { createProjectExtension } from './pi-project.js';
import { createRuntimeExtension } from './pi-runtime.js';
import { inspectHandoff } from './handoff.js';
import { BackgroundRuns } from './background.js';
import { readJson, redact } from './storage.js';
import { withProcessCancellation } from './process.js';

/** Count public SDK model calls, including compaction, without changing the host runtime. */
export function limitModelCalls(runtime: Runtime, maximum: number, called: () => void, exhausted: () => void, signal?: AbortSignal): Runtime {
  let calls = 0; const methods = new Set<PropertyKey>(['stream', 'complete', 'streamSimple', 'completeSimple', 'streamDeferred', 'fetchDeferred', 'generateImages', 'classify']);
  return new Proxy(runtime, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof value !== 'function') return value;
    if (!methods.has(property)) return value.bind(target);
    return (...args: unknown[]) => { signal?.throwIfAborted(); if (calls >= maximum) { exhausted(); throw new Error('Child model-call budget exhausted'); } calls++; called(); return Reflect.apply(value, target, args); };
  } });
}

export async function runPiDelegation(workspace: Workspace, spec: DelegationSpec, options: { signal?: AbortSignal; runtime?: Runtime; update?: (values: { requests?: number; tools?: number; phase?: string }) => void } = {}) {
  return await withProcessCancellation(options.signal, async () => {
  options.signal?.throwIfAborted();
  options.update?.({ phase: 'model-runtime' });
  const runtime = options.runtime ?? await ModelRuntime.create({ authPath: join(spec.agentDir!, 'auth.json'), modelsPath: join(spec.agentDir!, 'models.json'), refreshOnCreate: false });
  const model = runtime.getModel(spec.provider!, spec.model!); if (!model) throw new Error('Delegation model is unavailable in the existing provider configuration');
  const settings = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } }), manager = SessionManager.create(workspace.root, join(workspace.data, 'sessions'));
  let scopeDenied = false;
  const readingTools = new Set(['workspace_repos', 'repo_files', 'repo_read', 'code_trace', 'reading_open', 'workspace_graph', 'workspace_contracts', 'source_index', 'schema_reading', 'project_context']);
  const scopeGuard = (pi: ExtensionAPI) => { pi.on('tool_call', async event => {
    if (options.signal?.aborted) return { block: true, terminate: true, reason: 'Child cancelled before tool dispatch.' };
    await workspace.reload();
    if (event.toolName === 'repo_add' || workspace.config.repos.some(repo => { const path = relative(join(workspace.root, 'repos'), repo.root); return isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`) || repo.access === 'write' && !spec.writeRepos.includes(repo.id); })) {
      scopeDenied = true; return { block: true, terminate: true, reason: 'Child repository registrations cannot expand outside its isolated snapshot.' };
    }
    return !spec.writeRepos.length && (!readingTools.has(event.toolName) || event.toolName === 'project_context' && !['search', 'read', 'bundle', 'raw'].includes(String((event.input as { action?: string }).action)))
      ? { block: true, terminate: true, reason: 'This child task has read-only tools; writing, execution and resource mutation are outside its scope.' } : undefined;
  }); };
  const loader = new DefaultResourceLoader({ cwd: workspace.root, agentDir: spec.agentDir!, settingsManager: settings, noExtensions: true, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [createEnigmaExtension({ workspace, managed: true, approval: 'auto' }), createProjectExtension({ workspace, taskScope: spec.id }), ...(spec.writeRepos.length ? [createRuntimeExtension({ workspace, approval: 'auto' })] : []), scopeGuard] });
  options.update?.({ phase: 'extensions' }); await loader.reload(); if (loader.getExtensions().errors.length) throw new Error('Delegation extensions did not load');
  let requests = 0, tools = 0, budget = false;
  const boundedRuntime = limitModelCalls(runtime, spec.maxRequests ?? 24, () => { requests++; options.update?.({ requests, tools }); }, () => { budget = true; }, options.signal);
  const { session } = await createAgentSession({ cwd: workspace.root, agentDir: spec.agentDir, modelRuntime: boundedRuntime, model, settingsManager: settings, sessionManager: manager, resourceLoader: loader, noTools: 'builtin' });
  const errors: unknown[] = []; await session.bindExtensions({ onError: error => errors.push(error) });
  session.subscribe(event => { if (event.type === 'tool_execution_end') { tools++; options.update?.({ requests, tools }); } });
  const abort = () => { void session.abort(); }; options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    options.update?.({ phase: 'handoff' });
    const handoff = await inspectHandoff(workspace, spec.handoff);
    options.signal?.throwIfAborted();
    options.update?.({ phase: 'agent' }); await session.prompt(`${handoff.prompt}\n\nChild task ${spec.id}. Work only in this isolated workspace. Writable repositories: ${JSON.stringify(spec.writeRepos)}. Do not start recursive child tasks or change acceptance commands. This child result does not complete the parent goal. Preserve selected requirements, cite actual source and report remaining uncertainty.\n${spec.goal}`, { expandPromptTemplates: false });
    const state = await readJson<{ lastVerification?: string; lastCheckEvidence?: string }>(join(workspace.data, `session-${manager.getSessionId()}.json`));
    const unresolved = (await workspace.operations()).some(operation => ['pending', 'unknown'].includes(operation.status)) || (await new BackgroundRuns(workspace).unresolved()).length > 0;
    const last = manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
    const completed = last?.type === 'message' && last.message.role === 'assistant' && last.message.stopReason === 'stop';
    return { status: unresolved ? 'unknown' : scopeDenied ? 'failed' : budget ? 'budget' : options.signal?.aborted ? 'cancelled' : completed ? 'completed' : 'failed', requests, tools,
      answer: redact(session.getLastAssistantText() ?? '', workspace.secrets).slice(0, 24000), session: manager.getSessionFile(), errors,
      verification: { status: state.lastVerification ?? 'unverified', evidence: state.lastCheckEvidence }, observation: await workspace.observe() };
  } catch (error) { return { status: budget ? 'budget' : options.signal?.aborted ? 'cancelled' : 'failed', requests, tools, error: redact(String(error), workspace.secrets), session: manager.getSessionFile(), errors }; }
  finally { options.signal?.removeEventListener('abort', abort); await session.abort(); session.dispose(); }
  });
}
