import type { Workspace } from './workspace.js';
import { SkillDiscovery, configureSkillPaths, loadNativeSkills, skillPaths } from './skill-discovery.js';
import { RecipeStore } from './recipes.js';
import { PlanStore } from './planning.js';

export async function reuseCommand(workspace: Workspace, command: string, args: string[], signal: AbortSignal) {
  if (command === 'skills') {
    if (args[0] === 'paths' && args[1]) return await configureSkillPaths(workspace, JSON.parse(args[1]));
    if (args[0] === 'paths') return await skillPaths(workspace);
    const discovery = new SkillDiscovery(() => loadNativeSkills(workspace));
    if (args[0] === 'search') return await discovery.search(args[1] ?? '');
    if (args[0] === 'list') return await discovery.search('', { limit: 30, includeManual: true });
    if (args[0] === 'open' && args[1] && args[2]) return await discovery.open(args[1], args[2]);
    throw new Error('Use skills paths [PATHS_JSON], search INTENT, list, or open ID VERSION');
  }
  const recipes = new RecipeStore(workspace);
  if (args[0] === 'list') return await recipes.list();
  if (args[0] === 'save' && args[1]) return await recipes.save(JSON.parse(args[1]), args[2] ? Number(args[2]) : undefined);
  if (args[0] === 'read' && args[1]) return await recipes.read(args[1]);
  if (args[0] === 'run' && args[1]) { const result = await recipes.run(args[1], args[2] ? JSON.parse(args[2]) : {}, { signal }); if (result.status !== 'passed') process.exitCode = 1; return result; }
  if (args[0] === 'runs') return await recipes.runs();
  if (args[0] === 'report' && args[1]) return await recipes.readRun(args[1]);
  if (args[0] === 'reconcile' && args[1]) return await recipes.reconcileLock(args.slice(1).join(' '));
  if (args[0] === 'propose') {
    const plan = await new PlanStore(workspace).current(); if (!plan) throw new Error('No current plan');
    return await recipes.propose(plan);
  }
  throw new Error('Use recipes list, save JSON [REVISION], read ID, run ID [PARAMETERS_JSON], runs, report ID, propose, or reconcile OBSERVED_EFFECTS');
}
