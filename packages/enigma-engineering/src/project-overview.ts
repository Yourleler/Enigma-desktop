import type { Workspace } from './workspace.js';
import { PlanStore } from './planning.js';
import { ServiceManager } from './services.js';
import { BackgroundRuns } from './background.js';
import { TaskEvents } from './task-events.js';
import { Artifacts } from './artifacts.js';
import { readJson, safeId } from './storage.js';
import { join } from 'node:path';
import { Delegations } from './delegation.js';
import { Experiments } from './experiments.js';

export async function projectOverview(workspace: Workspace, options: { task?: string; planFile?: string } = {}) {
  if (options.task) safeId(options.task);
  let planFile = options.planFile;
  if (!planFile && options.task) try { planFile = (await readJson<{ planFile?: string }>(join(workspace.data, `session-${options.task}.json`))).planFile; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const [plan, services, background, waits, events, artifacts, delegates, experiments] = await Promise.all([
    new PlanStore(workspace, planFile).view(), new ServiceManager(workspace).list(), new BackgroundRuns(workspace).list(options.task),
    new TaskEvents(workspace).list(options.task), new TaskEvents(workspace).events(options.task), new Artifacts(workspace).list(options.task),
    new Delegations(workspace).list(options.task),
    new Experiments(workspace).list(options.task),
  ]);
  const deliveries = await Promise.all(events.map(async event => ({ event, delivery: await new TaskEvents(workspace).delivery(event), sourceCurrent: JSON.stringify(event.observation) === JSON.stringify(await workspace.observe()) })));
  return { at: new Date().toISOString(), repositories: workspace.config.repos, checks: workspace.config.checks, plan: plan ?? null, services, background, waits,
    events: deliveries, artifacts, delegates, experiments, childRequests: { knownSdkCalls: delegates.filter(child => child.spec.target === 'pi').reduce((total, child) => total + child.state.requests, 0), unavailable: delegates.filter(child => child.spec.target === 'codex').map(child => child.spec.id) }, blockers: [...plan?.gaps ?? [], ...background.filter(run => run.state.status === 'unknown').map(run => `Unknown command effects: ${run.spec.id}`), ...delegates.filter(child => child.status === 'unknown').map(child => `Unknown child task execution: ${child.spec.id}`)],
    note: 'This is an observation snapshot, not an automatic completion verdict. Ready services, finished jobs and passing checks remain distinct.' };
}
