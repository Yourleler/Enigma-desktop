import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Workspace } from './workspace.js';
import { ensureDir, id, readJson, redact, safeId, writeJson } from './storage.js';
import { repoGraph } from './reading.js';
import { emitActivity } from './telemetry.js';

export interface PlanStep {
  id: string;
  repo: string;
  goal: string;
  requires: string[];
  checks: string[];
  phase: 'pending' | 'running' | 'failed' | 'verified';
  evidence?: string;
  note?: string;
}
export interface TaskPlan {
  schema: 1;
  id: string;
  revision: number;
  goal: string;
  createdAt: string;
  steps: PlanStep[];
}
export interface PlanInput {
  goal: string;
  steps: { id: string; repo: string; goal: string; requires?: string[]; checks: string[] }[];
}
export interface PlanView {
  plan: TaskPlan;
  steps: (PlanStep & { state: 'ready' | 'blocked' | 'running' | 'failed' | 'verified' | 'stale'; blockedBy: string[] })[];
  completed: number;
  total: number;
  ready: string[];
  impact: Record<string, string[]>;
  gaps: string[];
}

/** Small task ledger. Execution remains owned by the host agent loop. */
export class PlanStore {
  constructor(readonly workspace: Workspace, private readonly activeFile = 'active-plan.json') {
    if (!/^active-plan(?:-[a-zA-Z0-9._-]+)?\.json$/.test(activeFile)) throw new Error('Invalid active plan scope');
  }
  private pointerPath(): string { return join(this.workspace.data, this.activeFile); }
  private path(planId: string, revision: number): string {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid plan revision');
    return join(this.workspace.data, 'plans', `${safeId(planId)}-${revision}.json`);
  }
  private validate(plan: TaskPlan): TaskPlan {
    if (plan.schema !== 1 || !plan.goal?.trim() || !Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > 100) throw new Error('Invalid task plan');
    this.path(plan.id, plan.revision);
    const ids = new Set<string>();
    for (const step of plan.steps) {
      safeId(step.id); this.workspace.repo(step.repo);
      if (ids.has(step.id) || !step.goal?.trim() || !Array.isArray(step.requires) || !Array.isArray(step.checks)
        || !['pending', 'running', 'failed', 'verified'].includes(step.phase)) throw new Error('Invalid plan step');
      ids.add(step.id);
      for (const check of step.checks) if (!this.workspace.config.checks.some(item => item.id === check)) throw new Error(`Unknown acceptance check: ${check}`);
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (stepId: string) => {
      if (visiting.has(stepId)) throw new Error('Task step dependencies contain a cycle');
      if (visited.has(stepId)) return;
      const step = plan.steps.find(item => item.id === stepId);
      if (!step) throw new Error(`Unknown required task step: ${stepId}`);
      visiting.add(stepId); step.requires.forEach(visit); visiting.delete(stepId); visited.add(stepId);
    };
    plan.steps.forEach(step => visit(step.id));
    return plan;
  }
  private async publish(plan: TaskPlan): Promise<TaskPlan> {
    this.validate(plan);
    await ensureDir(join(this.workspace.data, 'plans'));
    // Publish immutable revision first, then advance the small active pointer.
    const safe = JSON.parse(redact(JSON.stringify(plan), this.workspace.secrets)) as TaskPlan;
    await writeJson(this.path(plan.id, plan.revision), safe);
    await writeJson(this.pointerPath(), { id: plan.id, revision: plan.revision });
    emitActivity({ kind: 'fact', stage: 'plan.advanced', reference: `${plan.id}:${plan.revision}`, fingerprint: `${plan.id}:${plan.revision}`,
      detail: 'Published a new task plan revision; step completion remains tied to check evidence.' }, this.workspace.activity);
    return safe;
  }
  async current(): Promise<TaskPlan | undefined> {
    let pointer: { id: string; revision: number };
    try {
      pointer = await readJson<{ id: string; revision: number }>(this.pointerPath());
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    return await this.load(pointer.id, pointer.revision);
  }
  async load(planId: string, revision: number): Promise<TaskPlan> {
    const plan = this.validate(await readJson<TaskPlan>(this.path(planId, revision)));
    if (plan.id !== planId || plan.revision !== revision) throw new Error('Plan identity mismatch');
    return plan;
  }
  async create(input: PlanInput): Promise<TaskPlan> {
    return await this.workspace.exclusive(async () => {
      const plan: TaskPlan = { schema: 1, id: id('plan'), revision: 1, goal: input.goal, createdAt: new Date().toISOString(),
        steps: input.steps.map(step => ({ ...step, requires: [...(step.requires ?? [])], checks: [...step.checks], phase: 'pending' })) };
      return await this.publish(plan);
    });
  }
  async view(plan?: TaskPlan): Promise<PlanView | undefined> {
    const current = plan ?? await this.current(); if (!current) return undefined;
    this.validate(current);
    const graph = await repoGraph(this.workspace);
    const stateById = new Map<string, PlanView['steps'][number]>();
    const resolveStep = async (stepId: string): Promise<PlanView['steps'][number]> => {
      const cached = stateById.get(stepId); if (cached) return cached;
      const step = current.steps.find(item => item.id === stepId)!;
      const dependencies = await Promise.all(step.requires.map(resolveStep));
      const blockedBy = dependencies.filter(item => item.state !== 'verified').map(item => item.id);
      let accepted;
      try { accepted = step.evidence ? await this.workspace.evidenceStatus(step.evidence) : undefined; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const stale = step.phase === 'verified' && !accepted?.valid;
      const state = blockedBy.length ? 'blocked' : stale ? 'stale' : step.phase === 'verified' ? 'verified'
        : step.phase === 'running' ? 'running' : step.phase === 'failed' ? 'failed' : 'ready';
      const result = { ...step, state, blockedBy } as PlanView['steps'][number]; stateById.set(stepId, result); return result;
    };
    const steps = await Promise.all(current.steps.map(step => resolveStep(step.id)));
    const gaps = current.steps.filter(step => !step.checks.length).map(step => `${step.id}: no acceptance checks; cannot be verified`);
    for (const step of current.steps) for (const upstream of graph.edges.filter(edge => edge.from === step.repo)) {
      const preceding = current.steps.filter(item => item.repo === upstream.to);
      if (preceding.length && !preceding.some(item => this.dependsOn(current, step.id, item.id))) gaps.push(`${step.id}: no task dependency on upstream repository ${upstream.to}`);
    }
    if (graph.cycles.length) gaps.push(`Repository dependency cycle or dependent blockage: ${graph.cycles.join(', ')}`);
    return { plan: current, steps, completed: steps.filter(step => step.state === 'verified').length, total: steps.length,
      ready: steps.filter(step => step.state === 'ready').map(step => step.id), impact: graph.affectedBy, gaps };
  }
  private dependsOn(plan: TaskPlan, stepId: string, target: string): boolean {
    const step = plan.steps.find(item => item.id === stepId)!;
    return step.requires.includes(target) || step.requires.some(required => this.dependsOn(plan, required, target));
  }
  async advance(stepId: string, expectedRevision: number, update: { phase: 'running' | 'failed' | 'pending' | 'verified'; evidence?: string; note?: string }, expectedPlanId?: string): Promise<TaskPlan> {
    if (!['running', 'failed', 'pending', 'verified'].includes(update.phase)) throw new Error('Invalid task step phase');
    return await this.workspace.exclusive(async () => {
      const current = await this.current();
      if (!current || current.revision !== expectedRevision || (expectedPlanId !== undefined && current.id !== expectedPlanId)) throw new Error('Task plan changed; read the current identity and revision before updating');
      const step = current.steps.find(item => item.id === stepId); if (!step) throw new Error('Unknown task step');
      const view = (await this.view(current))!;
      const observed = view.steps.find(item => item.id === stepId)!;
      if (['running', 'verified'].includes(update.phase) && observed.blockedBy.length) throw new Error(`Step blocked by: ${observed.blockedBy.join(', ')}`);
      if (update.phase === 'verified') {
        if (!step.checks.length || !update.evidence) throw new Error('Verified step requires registered checks and their evidence');
        const accepted = await this.workspace.evidenceStatus(update.evidence);
        const data = accepted.entry.data as { status?: string; results?: { check: string; status: string }[] };
        if (!accepted.valid || accepted.entry.kind !== 'check' || data.status !== 'verified'
          || !step.checks.every(check => data.results?.some(result => result.check === check && result.status === 'passed'))) throw new Error('Task acceptance evidence is stale, failed, or does not cover the required checks');
      }
      const revisions = (await readdir(join(this.workspace.data, 'plans'))).filter(name => name.startsWith(`${current.id}-`) && name.endsWith('.json'))
        .map(name => Number(name.slice(current.id.length + 1, -5))).filter(Number.isSafeInteger);
      const next = structuredClone(current); next.revision = Math.max(current.revision, ...revisions) + 1;
      Object.assign(next.steps.find(item => item.id === stepId)!, update, { evidence: update.phase === 'verified' ? update.evidence : undefined });
      return await this.publish(next);
    });
  }
  async activate(planId: string, revision: number): Promise<TaskPlan> {
    return await this.workspace.exclusive(async () => {
      const plan = await this.load(planId, revision);
      await writeJson(this.pointerPath(), { id: planId, revision });
      return plan;
    });
  }
}
