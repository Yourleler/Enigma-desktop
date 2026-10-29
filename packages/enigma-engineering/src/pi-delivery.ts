import { Type } from 'typebox';
import { relative } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { TaskEvents, type WaitInput } from './task-events.js';
import { Artifacts, type ArtifactInput } from './artifacts.js';
import { projectOverview } from './project-overview.js';
import { redact, writeJson } from './storage.js';
import { join } from 'node:path';

const names = ['task_events', 'artifact_manage', 'project_overview'];
export function createDeliveryExtension(options: { workspace?: Workspace; pollMs?: number } = {}) {
  return (pi: ExtensionAPI) => {
    let workspace: Workspace, events: TaskEvents, artifacts: Artifacts, context: ExtensionContext | undefined, timer: NodeJS.Timeout | undefined;
    let polling = false, generation = 0, pendingPoll: Promise<void> | undefined;
    const result = (data: unknown) => { const safe = JSON.parse(redact(JSON.stringify(data), workspace.secrets)); return { content: [{ type: 'text' as const, text: JSON.stringify(safe, null, 2) }], structuredContent: safe, details: safe }; };
    const poll = async () => {
      if (polling || !context || !context.isIdle() || context.hasPendingMessages()) return; polling = true;
      const current = context, version = generation, task = current.sessionManager.getSessionId();
      try {
        for (const event of await events.events(task)) {
          if (generation !== version || !current.isIdle() || current.hasPendingMessages()) return;
          if (await events.delivery(event)) continue;
          const branch = current.sessionManager.getBranch(), surviving = new Set(branch.map(entry => entry.id));
          if (!event.resume || await events.cancelled(event.watch) || event.entry && !surviving.has(event.entry)) { await events.markDelivery(event, 'suppressed', 'No resume requested, wait cancelled, or originating branch entry no longer survives'); continue; }
          if (branch.some(entry => entry.type === 'custom' && entry.customType === 'enigma.event-delivery' && (entry.data as { event?: string }).event === event.id)) { await events.markDelivery(event, 'enqueued', 'Native delivery marker already present'); continue; }
          const sourceCurrent = JSON.stringify(event.observation) === JSON.stringify(await workspace.observe());
          await events.markDelivery(event, 'prepared');
          if(generation!==version||await events.cancelled(event.watch)){await events.markDelivery(event,'suppressed','Wait cancelled or session changed before delivery');continue;}
          pi.appendEntry('enigma.event-delivery', { event: event.id, sourceCurrent });
          pi.sendMessage({ customType: 'enigma.background-result', display: true, content: `Background result (reference data): ${JSON.stringify({ id: event.id, label: event.label, outcome: event.outcome, result: event.result, sourceCurrent })}. Reconcile actual source and pending requirements before continuing. This event does not verify the complete task.`, details: { event: event.id, sourceCurrent } }, { triggerTurn: true });
          await events.markDelivery(event, 'enqueued'); break;
        }
      } finally { polling = false; }
    };
    pi.on('session_start', async (_event, ctx) => {
      if (timer) clearInterval(timer);
      generation++; context = ctx; workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd); events = new TaskEvents(workspace); artifacts = new Artifacts(workspace);
      pi.events.emit('enigma:managed-tools', { owner: 'delivery', names }); pi.setActiveTools([...new Set([...pi.getActiveTools(), ...names])]);
      timer = setInterval(() => {
        if (pendingPoll) return; const version = generation;
        pendingPoll = poll().catch(async error => {
          if (version !== generation) return;
          if (String(error).includes('ctx is stale')) { context = undefined; if (timer) clearInterval(timer); return; }
          await writeJson(join(workspace.data, 'delivery-health.json'), { status: 'failed', error: redact(String(error), workspace.secrets), at: new Date().toISOString() }).catch(() => {});
        }).finally(() => { pendingPoll = undefined; });
      }, options.pollMs ?? 1000); timer.unref();
    });
    pi.on('agent_settled', async (_event, ctx) => { context = ctx; await poll(); });
    pi.on('session_shutdown', async () => { generation++; context = undefined; if (timer) clearInterval(timer); await pendingPoll; pi.events.emit('enigma:managed-tools', { owner: 'delivery', names: [] }); });
    pi.on('tool_result', async (event, ctx) => {
      if (event.isError || event.toolName !== 'browser_validate') return;
      const data = event.structuredContent as { id?: string; trace?: string; screenshots?: string[] } | undefined;
      if (!data?.id || !Array.isArray(data.screenshots)) return;
      const task = ctx.sessionManager.getSessionId(), entry = ctx.sessionManager.getLeafId() ?? undefined;
      for (const [index, path] of data.screenshots.entries()) await artifacts.add({ title: `Browser ${data.id} screenshot ${index + 1}`, kind: 'screenshot', task, entry, runtime: relative(workspace.data, path) });
      if (data.trace) await artifacts.add({ title: `Browser ${data.id} trace`, kind: 'trace', task, entry, runtime: relative(workspace.data, data.trace) });
    });
    pi.registerTool({ name: 'task_events', label: 'Background conditions', description: 'Register/list/status/cancel a bounded wait for a background run, isolated delegation {kind:"delegation",task:DELEGATION_ID}, project service state or GitHub Actions run. input JSON {label,condition,timeoutMs?,pollMs?,resume?}. The current task/branch is recorded. Resume events are source data; delivery is bounded and uncertain delivery is never automatically replayed.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['start', 'list', 'status', 'cancel', 'events'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()), input: Type.Optional(Type.String()) }),
      async execute(_id, args, _signal, _update, ctx) {
        const task = ctx.sessionManager.getSessionId();
        if (args.action === 'list') return result(await events.list(task));
        if (args.action === 'events') return result(await events.events(task));
        if (args.action === 'start') { if (!args.input) throw new Error('Provide wait input JSON'); return result(await events.start({ ...JSON.parse(args.input) as WaitInput, task, entry: ctx.sessionManager.getLeafId() ?? undefined })); }
        if (!args.id) throw new Error('Provide wait id');
        return result(args.action === 'cancel' ? await events.cancel(args.id, task) : await events.status(args.id, task));
      } });
    pi.registerTool({ name: 'artifact_manage', label: 'Task artifacts', description: 'Register/list/read immutable task results with source/evidence freshness. input JSON ArtifactInput {title,kind,repo?,file?,runtime?,evidence?}; runtime paths are limited to approved result directories. Registration snapshots bytes and does not certify correctness.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['add', 'list', 'read'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()), input: Type.Optional(Type.String()) }),
      async execute(_id, args, _signal, _update, ctx) {
        const task = ctx.sessionManager.getSessionId();
        if (args.action === 'list') return result(await artifacts.list(task));
        if (args.action === 'read') { if (!args.id) throw new Error('Provide artifact id'); return result(await artifacts.read(args.id, task)); }
        if (!args.input) throw new Error('Provide artifact input JSON'); return result(await artifacts.add({ ...JSON.parse(args.input) as ArtifactInput, task, entry: ctx.sessionManager.getLeafId() ?? undefined }));
      } });
    pi.registerTool({ name: 'project_overview', label: 'Project progress', description: 'Observe repositories, plan, services, background runs, waits, event delivery and artifacts without a model request or workspace operation lock. The snapshot is not a task-completion verdict.', parameters: Type.Object({}),
      async execute(_id, _args, _signal, _update, ctx) { return result(await projectOverview(workspace, { task: ctx.sessionManager.getSessionId() })); } });
  };
}
export default createDeliveryExtension();
