import { join } from 'node:path';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { Experiments } from './experiments.js';
import { ProjectKnowledge } from './project-knowledge.js';
import { MemoryStore } from './memory.js';
import { readJson, redact, safeId } from './storage.js';

export function createLearningExtension(options: { workspace?: Workspace; knowledge?: boolean; approval?: 'ask' | 'auto' | 'never' } = {}) {
  return (pi: ExtensionAPI) => {
    let workspace: Workspace, experiments: Experiments, knowledge: ProjectKnowledge, enabled = false;
    const approval = options.approval ?? process.env.ENIGMA_APPROVAL ?? 'ask'; if (!['ask', 'auto', 'never'].includes(approval)) throw new Error('Invalid experiment approval policy');
    pi.registerFlag('enigma-knowledge', { description: 'Enable explicit project knowledge drafts and scoped recall', type: 'boolean', default: false });
    const result = (value: unknown) => { const safe = JSON.parse(redact(JSON.stringify(value), workspace.secrets)); return { content: [{ type: 'text' as const, text: JSON.stringify(safe, null, 2) }], details: safe, structuredContent: safe }; };
    const access = (ctx: ExtensionContext) => ({ session: ctx.sessionManager.getSessionId(), entries: ctx.sessionManager.getBranch().map(entry => entry.id) });
    const allow = async (ctx: ExtensionContext, text: string) => { ctx.signal?.throwIfAborted(); if (approval === 'never' || approval === 'ask' && (!ctx.hasUI || !await ctx.ui.confirm('Evaluate isolated branches', text))) throw new Error('Experiment check execution requires approval'); ctx.signal?.throwIfAborted(); };
    pi.on('session_start', async (_event, ctx) => {
      workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd); experiments = new Experiments(workspace); knowledge = new ProjectKnowledge(workspace);
      enabled = options.knowledge ?? (pi.getFlag('enigma-knowledge') === true || process.env.ENIGMA_MEMORY === '1');
      const names = ['solution_experiment', ...(enabled ? ['project_knowledge'] : [])]; pi.events.emit('enigma:managed-tools', { owner: 'learning', names }); pi.setActiveTools([...new Set([...pi.getActiveTools(), ...names])]);
    });
    pi.on('session_shutdown', () => { pi.events.emit('enigma:managed-tools', { owner: 'learning', names: [] }); });
    pi.on('context', async (event, ctx) => ({ messages: await Promise.all(event.messages.map(async message => {
      if (!enabled || message.role !== 'toolResult' || message.toolName !== 'project_knowledge') return message;
      const data = message.details as { items?: { id: string }[] } | undefined; if (!Array.isArray(data?.items)) return message;
      const store = await MemoryStore.open(workspace), items = [];
      for (const item of data.items) try { if (await store.visible(item.id, access(ctx))) items.push(item); } catch { /* A removed/changed source is not permission to reuse its old summary. */ }
      const { details: _details, ...base } = message; void _details;
      return { ...base, content: [{ type: 'text' as const, text: JSON.stringify({ ...data, items, note: 'Current material version, removal and task scope rechecked.' }) }] };
    })) }));
    pi.registerTool({ name: 'solution_experiment', label: 'Compare isolated approaches', description: 'Create a comparison of two to eight existing isolated delegation variants from identical source code and original check definitions. Candidates must select the same checks. Evaluate actual implementations, report source/check freshness and known SDK calls, then select a current passing candidate to prepare a merge preview. Selection alone never applies code or verifies the parent goal.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['create', 'list', 'evaluate', 'report', 'select'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()), candidate: Type.Optional(Type.String()), goal: Type.Optional(Type.String()), checks: Type.Optional(Type.Array(Type.String())), candidates: Type.Optional(Type.Array(Type.Object({ id: Type.String(), delegation: Type.String() }))) }),
      async execute(_id, args, signal, _update, ctx) {
        const task = ctx.sessionManager.getSessionId();
        if (args.action === 'list') return result(await experiments.list(task));
        if (args.action === 'create') { if (!args.goal || !args.checks || !args.candidates) throw new Error('Provide the common goal, check IDs and named delegation variants'); return result(await experiments.create({ goal: args.goal, checks: args.checks, candidates: args.candidates, task })); }
        if (!args.id) throw new Error('Provide experiment id');
        if (args.action === 'report') return result(await experiments.report(args.id, task));
        if (args.action === 'evaluate') { await allow(ctx, `Run original common checks for experiment ${args.id}`); return result(await experiments.evaluate(args.id, { task, signal })); }
        if (!args.candidate) throw new Error('Provide candidate id');
        const state = await readJson<{ planFile?: string }>(join(workspace.data, `session-${safeId(task)}.json`));
        return result(await experiments.select(args.id, args.candidate, { task, planFile: state.planFile ?? 'active-plan.json' }));
      } });
    pi.registerTool({ name: 'project_knowledge', label: 'Project knowledge drafts', description: 'Explicitly draft or search scoped candidate knowledge supported by current material revisions, source files or check evidence. Private materials force task scope. Drafts are not recalled until idle consolidation; imported source snapshots never imply remote freshness or system instructions. Personal preferences are excluded.', executionMode: 'sequential', defaultActive: false,
      parameters: Type.Object({ action: Type.Union([Type.Literal('draft'), Type.Literal('search')]), query: Type.Optional(Type.String()), title: Type.Optional(Type.String()), content: Type.Optional(Type.String()), kind: Type.Optional(Type.Union(['convention', 'contract', 'decision', 'troubleshooting', 'research'].map(kind => Type.Literal(kind)))), resources: Type.Optional(Type.Array(Type.String())), sources: Type.Optional(Type.Array(Type.Object({ repo: Type.String(), file: Type.String() }))), evidence: Type.Optional(Type.Array(Type.String())), taskOnly: Type.Optional(Type.Boolean()), appliesWhen: Type.Optional(Type.String()) }),
      async execute(_id, args, _signal, _update, ctx) {
        if (!enabled) throw new Error('Enable project knowledge explicitly with --enigma-knowledge or --memory');
        if (args.action === 'search') return result(await knowledge.search(args.query ?? '', access(ctx)));
        if (!args.title || !args.content || !args.kind) throw new Error('Provide the draft title, text and candidate kind');
        return result(await knowledge.draft({ ...args, title: args.title, content: args.content, kind: args.kind, task: ctx.sessionManager.getSessionId(), entry: ctx.sessionManager.getLeafId() ?? undefined }, access(ctx)));
      } });
    pi.registerCommand('knowledge-organize', { description: 'Consolidate bounded project knowledge drafts while the main run is idle', async handler(_text, ctx) {
      if (!enabled || !ctx.isIdle() || ctx.hasPendingMessages()) throw new Error('Knowledge consolidation requires an enabled, idle session'); ctx.ui.notify(JSON.stringify(await knowledge.organize(), null, 2), 'info');
    } });
  };
}
export default createLearningExtension();
