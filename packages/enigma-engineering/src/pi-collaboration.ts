import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { Type } from 'typebox';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { Delegations } from './delegation.js';
import { TaskPackages, type TaskPackageInput } from './task-package.js';
import { currentUserIds, selectedPiNotes } from './pi-session.js';
import { readJson, redact, safeId } from './storage.js';
import { PlanStore } from './planning.js';

const names = ['delegate_task', 'task_package'];
export function createCollaborationExtension(options: { workspace?: Workspace; approval?: 'ask' | 'auto' | 'never'; agentDir?: string } = {}) {
  return (pi: ExtensionAPI) => {
    let workspace: Workspace, delegations: Delegations;
    const approval = options.approval ?? process.env.ENIGMA_APPROVAL ?? 'ask'; if (!['ask', 'auto', 'never'].includes(approval)) throw new Error('Invalid collaboration approval policy');
    const result = (value: unknown) => { const safe = JSON.parse(redact(JSON.stringify(value), workspace.secrets)); return { content: [{ type: 'text' as const, text: JSON.stringify(safe, null, 2) }], details: safe, structuredContent: safe }; };
    const allow = async (ctx: ExtensionContext, text: string) => {
      ctx.signal?.throwIfAborted(); if (approval === 'never' || approval === 'ask' && (!ctx.hasUI || !await ctx.ui.confirm('Isolated task / package operation', redact(text, workspace.secrets)))) throw new Error('Collaboration operation requires approval'); ctx.signal?.throwIfAborted();
    };
    const planFile = async (ctx: ExtensionContext) => { const state = await readJson<{ planFile?: string }>(join(workspace.data, `session-${safeId(ctx.sessionManager.getSessionId())}.json`)); return state.planFile ?? 'active-plan.json'; };
    const context = async (ctx: ExtensionContext, args: { goal: string; notes?: string[]; resources?: string[]; artifacts?: string[]; evidence?: string[] }): Promise<TaskPackageInput> => {
      const session = ctx.sessionManager.getSessionId(), current = currentUserIds(ctx.sessionManager), selected = [...new Set([...(args.notes ?? []), ...current.slice(-1)])];
      const state = await readJson<{ requests: number; inheritedRequests?: number; requirements?: string[] }>(join(workspace.data, `session-${safeId(session)}.json`));
      const notes = selectedPiNotes(ctx.sessionManager, selected.map(id => ({ id }))), preserved = state.requirements ?? [];
      for (const [index, text] of preserved.entries()) notes.push({ role: 'user', kind: 'requirement', text, reference: `pi:${session}:preserved-${index}` });
      return { goal: args.goal, notes, task: session, source: { agent: 'pi', session, entry: ctx.sessionManager.getLeafId() ?? undefined, requests: state.requests + (state.inheritedRequests ?? 0) },
        resources: args.resources, artifacts: args.artifacts, evidence: args.evidence, plan: await new PlanStore(workspace, await planFile(ctx)).current() ?? null };
    };
    pi.on('session_start', async (_event, ctx) => { workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd); delegations = new Delegations(workspace); pi.events.emit('enigma:managed-tools', { owner: 'collaboration', names }); pi.setActiveTools([...new Set([...pi.getActiveTools(), ...names])]); });
    pi.on('session_shutdown', () => { pi.events.emit('enigma:managed-tools', { owner: 'collaboration', names: [] }); });
    pi.registerTool({ name: 'delegate_task', label: 'Isolated child task', description: 'Start/query/wait/cancel an on-demand Pi or Codex child in a separate code workspace. start requires goal,target; writeRepos is an explicit subset of current write grants, checks optionally selects existing parent check IDs for this child scope. Parent checks are unchanged. At most four children, bounded time and Pi request budgets, no recursive delegates. wait observes for up to 30 seconds and never restarts after a timeout. Child completion/evidence is not parent acceptance. preview takes delegation id; merge takes its returned preview id, rechecks actual versions and runs all original parent checks.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['start', 'list', 'status', 'wait', 'cancel', 'preview', 'merge'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()),
        goal: Type.Optional(Type.String()), target: Type.Optional(Type.Union([Type.Literal('pi'), Type.Literal('codex')])), writeRepos: Type.Optional(Type.Array(Type.String())), checks: Type.Optional(Type.Array(Type.String())), timeoutMs: Type.Optional(Type.Integer()), maxRequests: Type.Optional(Type.Integer({ description: 'Pi only. Omit for Codex, which uses timeoutMs.' })),
        notes: Type.Optional(Type.Array(Type.String(), { description: 'Original Pi entry IDs, not summary text. Use task_requirements to find source IDs.' })), resources: Type.Optional(Type.Array(Type.String())), artifacts: Type.Optional(Type.Array(Type.String())), evidence: Type.Optional(Type.Array(Type.String())) }),
      async execute(_id, args, signal, _update, ctx) {
        const task = ctx.sessionManager.getSessionId();
        if (args.action === 'list') return result(await delegations.list(task));
        if (args.action === 'start') {
          if (!args.goal || !args.target) throw new Error('Provide the child goal and public target adapter');
          const input = await context(ctx, { ...args, goal: args.goal }); let agentDir = options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(workspace.data, 'pi-agent');
          try { await access(join(agentDir, 'models.json')); } catch { agentDir = getAgentDir(); }
          if (args.target === 'pi' && !ctx.model) throw new Error('Select a model before delegating to Pi');
          await allow(ctx, JSON.stringify({ goal: args.goal, target: args.target, writeRepos: args.writeRepos ?? [], resources: args.resources ?? [], timeoutMs: args.timeoutMs, maxRequests: args.maxRequests }));
          return result(await delegations.start({ ...input, target: args.target, writeRepos: args.writeRepos, checks: args.checks, timeoutMs: args.timeoutMs, maxRequests: args.maxRequests,
            provider: args.target === 'pi' ? ctx.model!.provider : undefined, model: args.target === 'pi' ? ctx.model!.id : undefined, agentDir }));
        }
        if (!args.id) throw new Error('Provide delegation id, or the preview id for merge');
        if (args.action === 'status') return result(await delegations.status(args.id, task));
        if (args.action === 'wait') return result(await delegations.wait(args.id, { task, signal, timeoutMs: Math.min(args.timeoutMs ?? 15000, 30000) }));
        if (args.action === 'preview') return result(await delegations.preview(args.id, task, { planFile: await planFile(ctx) }));
        await allow(ctx, `${args.action} isolated task/preview ${args.id}`);
        return result(args.action === 'cancel' ? await delegations.cancel(args.id, task) : await delegations.merge(args.id, { task, signal, planFile: await planFile(ctx) }));
      } });
    pi.registerTool({ name: 'task_package', label: 'Reproducible task package', description: 'Export an owned task package with exact multi-repo code, selected source materials/artifacts/evidence, original goal/notes, runtime definitions and environment provenance; inspect an owned package by id. Restoring/activating in a new workspace is an operator CLI action. Historical evidence, private memory and permissions never become target success or automatic grants.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union([Type.Literal('export'), Type.Literal('inspect')]), id: Type.Optional(Type.String()), goal: Type.Optional(Type.String()), notes: Type.Optional(Type.Array(Type.String(), { description: 'Existing Pi message entry IDs to carry as source context; not a summary string.' })), resources: Type.Optional(Type.Array(Type.String())), artifacts: Type.Optional(Type.Array(Type.String())), evidence: Type.Optional(Type.Array(Type.String())) }),
      async execute(_id, args, signal, _update, ctx) {
        if (args.action === 'inspect') { if (!args.id) throw new Error('Provide owned task package id'); return result((await TaskPackages.inspect(join(workspace.data, 'packages', safeId(args.id)))).manifest); }
        if (!args.goal) throw new Error('Provide the task goal'); const input = await context(ctx, { ...args, goal: args.goal }); await allow(ctx, `Export selected task package: ${JSON.stringify({ goal: args.goal, resources: args.resources, artifacts: args.artifacts })}`);
        return result(await new TaskPackages(workspace).export(input, { signal }));
      } });
  };
}
export default createCollaborationExtension();
