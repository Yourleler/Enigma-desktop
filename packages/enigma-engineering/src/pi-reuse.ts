import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { SkillDiscovery, loadNativeSkills, skillPaths } from './skill-discovery.js';
import { RecipeStore } from './recipes.js';
import { PlanStore } from './planning.js';
import { readJson, redact, safeId } from './storage.js';
import { join } from 'node:path';

const names = ['skill_discover', 'recipe_manage'];
export function createReuseExtension(options: { workspace?: Workspace; approval?: 'ask' | 'auto' | 'never' } = {}) {
  return (pi: ExtensionAPI) => {
    let workspace: Workspace, recipes: RecipeStore;
    const approval = options.approval ?? process.env.ENIGMA_APPROVAL ?? 'ask';
    if (!['ask', 'auto', 'never'].includes(approval)) throw new Error('Invalid recipe approval policy');
    const result = (data: unknown) => { const safe = JSON.parse(redact(JSON.stringify(data), workspace.secrets)); return { content: [{ type: 'text' as const, text: JSON.stringify(safe, null, 2) }], details: safe, structuredContent: safe }; };
    const allow = async (ctx: ExtensionContext, description: string) => {
      if (ctx.signal?.aborted) throw new Error('Recipe cancelled');
      if (approval === 'never' || approval === 'ask' && (!ctx.hasUI || !await ctx.ui.confirm('Run configured host procedure', redact(description, workspace.secrets)))) throw new Error('Recipe execution requires approval');
      if (ctx.signal?.aborted) throw new Error('Recipe cancelled');
    };
    pi.on('session_start', async (_event, ctx) => {
      workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd); recipes = new RecipeStore(workspace);
      pi.events.emit('enigma:managed-tools', { owner: 'reuse', names }); pi.setActiveTools([...new Set([...pi.getActiveTools(), ...names])]);
    });
    pi.on('resources_discover', async () => ({ skillPaths: await skillPaths(workspace) }));
    pi.on('session_shutdown', () => { pi.events.emit('enigma:managed-tools', { owner: 'reuse', names: [] }); });
    pi.registerTool({ name: 'skill_discover', label: 'Discover native skills', description: 'Find relevant skills by intent in the host Pi native catalogue; reads summaries and hashes, never installs or automatically invokes a skill. open requires id and version from current search. Manual-only skills are not exposed for model invocation. Paths are discovery sources, not workspace write grants.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union([Type.Literal('search'), Type.Literal('open')]), query: Type.Optional(Type.String()), id: Type.Optional(Type.String()), version: Type.Optional(Type.String()) }),
      async execute(_id, args) {
        const discovery = new SkillDiscovery(async () => {
          const commands = pi.getCommands().filter(command => command.source === 'skill');
          const loaded = await loadNativeSkills(workspace, { activePaths: commands.map(command => command.sourceInfo.path) });
          return { ...loaded, skills: loaded.skills.map(skill => ({ ...skill, sourceInfo: commands.find(command => command.sourceInfo.path === skill.filePath)?.sourceInfo ?? skill.sourceInfo })) };
        });
        if (args.action === 'search') return result(await discovery.search(args.query ?? ''));
        if (!args.id || !args.version) throw new Error('Provide selected native skill id and version');
        return result(await discovery.open(args.id, args.version));
      } });
    pi.registerTool({ name: 'recipe_manage', label: 'Task recipes', description: 'List/read/run operator-promoted task recipes, inspect own run receipts, or propose a draft from a fully verified plan. Execution uses separate argv data values, approved host commands, owned services/browser scenarios and original workspace checks. Recipe editing/promotion belongs to the operator CLI. Proposal is never automatically executable and historical evidence is not new task acceptance.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['list', 'read', 'run', 'runs', 'report', 'propose'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()), parameters: Type.Optional(Type.Record(Type.String(), Type.String())), revision: Type.Optional(Type.Integer()) }),
      async execute(_id, args, signal, _update, ctx) {
        const task = ctx.sessionManager.getSessionId();
        if (args.action === 'list') return result(await recipes.list());
        if (args.action === 'runs') return result(await recipes.runs(task));
        if (!args.id) throw new Error('Provide recipe/run/plan id');
        if (args.action === 'read') return result(await recipes.read(args.id));
        if (args.action === 'report') return result(await recipes.readRun(args.id, task));
        if (args.action === 'propose') {
          if (!args.revision) throw new Error('Provide the current plan revision');
          const state = await readJson<{ planFile?: string }>(join(workspace.data, `session-${safeId(task)}.json`));
          const plans = new PlanStore(workspace, state.planFile ?? 'active-plan.json'), plan = await plans.current();
          if (!plan || plan.id !== args.id || plan.revision !== args.revision) throw new Error('Proposal must use this session’s current plan');
          return result(await recipes.propose(plan, task));
        }
        const recipe = await recipes.read(args.id); await allow(ctx, JSON.stringify({ recipe, parameters: args.parameters ?? {} }));
        return result(await recipes.run(args.id, args.parameters ?? {}, { task, entry: ctx.sessionManager.getLeafId() ?? undefined, signal, expectedVersion: recipe.version }));
      } });
  };
}
export default createReuseExtension();
