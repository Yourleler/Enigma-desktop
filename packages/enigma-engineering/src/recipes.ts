import { join } from 'node:path';
import { link, readdir, rm } from 'node:fs/promises';
import type { Workspace } from './workspace.js';
import type { TaskPlan } from './planning.js';
import { PlanStore } from './planning.js';
import { runProcess } from './process.js';
import { ServiceManager } from './services.js';
import { BrowserValidation } from './browser-validation.js';
import { processIdentity } from './observer.js';
import { ensureDir, hash, id, readJson, redact, safeId, writeJson } from './storage.js';
import type { Observation } from './types.js';

export type RecipeStep =
  | { id: string; kind: 'command'; repo: string; argv: string[]; timeoutMs?: number; envRefs?: Record<string, string> }
  | { id: string; kind: 'service'; service: string; action: 'start' | 'stop' }
  | { id: string; kind: 'browser'; scenario: string }
  | { id: string; kind: 'verify' };
export interface RecipeInput {
  id: string; label: string; timeoutMs?: number; parameters?: Record<string, { description: string; default?: string }>; steps: RecipeStep[];
}
export interface Recipe extends RecipeInput { schema: 1; revision: number; version: string; createdAt: string }
export interface RecipeProposal {
  schema: 1; id: string; task?: string; createdAt: string; origin: { plan: string; revision: number; evidence: string[] };
  input: RecipeInput; goals: { step: string; repo: string; goal: string; checks: string[] }[]; note: string;
}
export interface RecipeRun {
  schema: 1; id: string; recipe: string; revision: number; version: string; task?: string; entry?: string;
  pid: number; processIdentity?: string; createdAt: string; finishedAt?: string; parameters: Record<string, string>;
  status: 'running' | 'passed' | 'failed' | 'cancelled' | 'unknown' | 'stale'; before: Observation; after?: Observation;
  steps: { id: string; kind: RecipeStep['kind']; state: 'running' | 'passed' | 'failed' | 'cancelled' | 'unknown'; data?: unknown }[];
  evidence?: string; error?: string;
}
interface RecipeConfig { schema: 1; recipes: Recipe[] }
const placeholder = /^\{\{([a-zA-Z0-9][a-zA-Z0-9._-]*)\}\}$/;

/** Executable procedures are explicitly promoted operator configuration, not generated agent policy. */
export class RecipeStore {
  constructor(readonly workspace: Workspace) {}
  private async config(): Promise<RecipeConfig> {
    try {
      const config = await readJson<RecipeConfig>(join(this.workspace.data, 'recipes.json'));
      if (config.schema !== 1 || !Array.isArray(config.recipes) || config.recipes.length > 100) throw new Error('Invalid recipe configuration');
      const seen = new Set<string>();
      for (const recipe of config.recipes) {
        this.validate(recipe);
        if (seen.has(recipe.id) || recipe.schema !== 1 || !Number.isSafeInteger(recipe.revision) || recipe.revision < 1 || recipe.version !== hash(JSON.stringify(this.input(recipe)))) throw new Error('Invalid recipe revision');
        seen.add(recipe.id);
      }
      return config;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, recipes: [] }; throw error; }
  }
  private input(recipe: RecipeInput): RecipeInput { return { id: recipe.id, label: recipe.label, timeoutMs: recipe.timeoutMs ?? 300000, parameters: recipe.parameters ?? {}, steps: recipe.steps }; }
  private validate(input: RecipeInput) {
    safeId(input.id);
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 500 || !Array.isArray(input.steps) || !input.steps.length || input.steps.length > 100) throw new Error('Invalid recipe');
    if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 3600000)) throw new Error('Invalid recipe total timeout');
    if (input.parameters !== undefined && (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters))) throw new Error('Invalid recipe parameters');
    const parameters = Object.entries(input.parameters ?? {});
    if (parameters.length > 30) throw new Error('Recipe parameter budget exceeded');
    for (const [name, value] of parameters) {
      safeId(name);
      if (!value || typeof value.description !== 'string' || value.description.length > 1000 || value.default !== undefined && (typeof value.default !== 'string' || value.default.includes('\0') || value.default.length > 8000)) throw new Error('Invalid recipe parameter');
    }
    const ids = new Set<string>();
    for (const step of input.steps) {
      safeId(step.id); if (ids.has(step.id)) throw new Error('Duplicate recipe step'); ids.add(step.id);
      if (step.kind === 'command') {
        this.workspace.repo(step.repo);
        if (!Array.isArray(step.argv) || !step.argv[0] || step.argv.length > 200 || step.argv.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 16000)) throw new Error('Invalid recipe command');
        if (step.timeoutMs !== undefined && (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 1 || step.timeoutMs > 3600000)) throw new Error('Invalid recipe command timeout');
        step.argv.forEach((arg, index) => {
          const match = placeholder.exec(arg);
          if (arg.includes('{{') && !match) throw new Error('Recipe parameters must occupy a whole argv value; no interpolation into code');
          const previous = step.argv[index - 1]?.toLowerCase() ?? '';
          if (match && (!index || !Object.hasOwn(input.parameters ?? {}, match[1]!) || /^-[a-z]*c[a-z]*$/.test(previous)
            || ['-e', '-p', '--eval', '--print', '--command', '-command', '-commandwithargs', '-encodedcommand', '/c', '/k'].includes(previous))) throw new Error('Recipe parameters cannot select executables or inline code');
        });
        for (const [name, reference] of Object.entries(step.envRefs ?? {})) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) throw new Error('Invalid recipe environment reference');
      } else if (step.kind === 'service') { safeId(step.service); if (!['start', 'stop'].includes(step.action)) throw new Error('Invalid recipe service action'); }
      else if (step.kind === 'browser') safeId(step.scenario);
      else if (step.kind !== 'verify') throw new Error('Unknown recipe step kind');
    }
    if (input.steps.at(-1)?.kind !== 'verify') throw new Error('An accepted recipe must end with the original registered workspace checks');
    const serialized = JSON.stringify(input); if (redact(serialized, this.workspace.secrets) !== serialized) throw new Error('Use environment references instead of embedding secrets in recipes');
  }
  async list() { return (await this.config()).recipes; }
  async read(recipeId: string) { safeId(recipeId); const recipe = (await this.list()).find(recipe => recipe.id === recipeId); if (!recipe) throw new Error('Unknown recipe'); return recipe; }
  async save(input: RecipeInput, expectedRevision?: number) {
    this.validate(input);
    return await this.workspace.exclusive(async () => {
      const config = await this.config(), previous = config.recipes.find(recipe => recipe.id === input.id);
      if (previous ? previous.revision !== expectedRevision : expectedRevision !== undefined) throw new Error('Recipe changed; provide its current revision before replacing it');
      const normalized = this.input(input), recipe: Recipe = { ...structuredClone(normalized), schema: 1, revision: (previous?.revision ?? 0) + 1, version: hash(JSON.stringify(normalized)), createdAt: new Date().toISOString() };
      await ensureDir(join(this.workspace.data, 'recipes'));
      await writeJson(join(this.workspace.data, 'recipes', `${recipe.id}-${recipe.revision}.json`), recipe);
      config.recipes = [...config.recipes.filter(value => value.id !== recipe.id), recipe];
      if (config.recipes.length > 100) throw new Error('Recipe configuration budget exceeded');
      await writeJson(join(this.workspace.data, 'recipes.json'), config); return recipe;
    });
  }
  async propose(plan: TaskPlan, task?: string): Promise<RecipeProposal> {
    return await this.workspace.exclusive(async () => {
      const view = await new PlanStore(this.workspace).view(plan);
      if (!view || view.completed !== view.total || view.gaps.length) throw new Error('Recipe proposal requires a fully verified current plan without acceptance gaps');
      const proposal: RecipeProposal = { schema: 1, id: id('recipe-proposal'), task, createdAt: new Date().toISOString(),
        origin: { plan: plan.id, revision: plan.revision, evidence: [...new Set(plan.steps.map(step => step.evidence!))] },
        input: { id: id('recipe'), label: plan.goal.slice(0, 500), parameters: {}, steps: [{ id: 'acceptance', kind: 'verify' }] },
        goals: plan.steps.map(step => ({ step: step.id, repo: step.repo, goal: step.goal, checks: step.checks })),
        note: 'Draft only. The plan proves goals and checks, not how to replay edits. Add explicit parameterized command/service/browser steps, then promote using operator configuration. Historical evidence is provenance, never success of a new run.' };
      await ensureDir(join(this.workspace.data, 'recipe-proposals')); await this.persist(join(this.workspace.data, 'recipe-proposals', `${proposal.id}.json`), proposal); return proposal;
    });
  }
  private async persist(path: string, data: unknown) { await writeJson(path, JSON.parse(redact(JSON.stringify(data), this.workspace.secrets))); }
  async run(recipeId: string, supplied: Record<string, string>, options: { task?: string; entry?: string; signal?: AbortSignal; expectedVersion?: string } = {}) {
    const token = id('recipe-owner'), lock = join(this.workspace.data, 'recipe.lock'), temporary = `${lock}.${token}.tmp`, identity = await processIdentity(process.pid);
    try {
      await writeJson(temporary, { token, pid: process.pid, identity: identity.identity, createdAt: new Date().toISOString() }); await link(temporary, lock);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another recipe is active or interrupted; inspect recipe.lock before operator reconciliation'); throw error; }
    finally { await rm(temporary, { force: true }); }
    try { return await this.execute(recipeId, supplied, options); }
    finally { if ((await readJson<{ token: string }>(lock)).token === token) await rm(lock); }
  }
  async reconcileLock(observation: string) {
    if (!observation.trim()) throw new Error('Describe inspected effects before reconciling an interrupted recipe');
    const path = join(this.workspace.data, 'recipe.lock'), owner = await readJson<{ token: string; pid: number; identity?: string }>(path), state = await processIdentity(owner.pid);
    if (state.state !== 'gone' && !(state.state === 'alive' && owner.identity && state.identity && owner.identity !== state.identity)) throw new Error('Recipe owner is still alive or its identity is unknown');
    if (JSON.stringify(await readJson(path)) !== JSON.stringify(owner)) throw new Error('Recipe ownership changed during reconciliation');
    await this.persist(join(this.workspace.data, `recipe-reconciliation-${safeId(owner.token)}.json`), { owner, observation, reconciledAt: new Date().toISOString() });
    await rm(path); return { reconciled: owner.token, note: 'No execution was replayed and unresolved workspace effects remain blocked.' };
  }
  private async execute(recipeId: string, supplied: Record<string, string>, options: { task?: string; entry?: string; signal?: AbortSignal; expectedVersion?: string }) {
    const recipe = await this.read(recipeId);
    if (options.expectedVersion !== undefined && options.expectedVersion !== recipe.version) throw new Error('Recipe changed before execution');
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Invalid recipe arguments');
    for (const key of Object.keys(supplied)) if (!Object.hasOwn(recipe.parameters ?? {}, key)) throw new Error(`Unknown recipe parameter: ${key}`);
    const parameters: Record<string, string> = Object.create(null);
    for (const [name, spec] of Object.entries(recipe.parameters ?? {})) {
      const value = Object.hasOwn(supplied, name) ? supplied[name] : spec.default;
      if (typeof value !== 'string' || value.length > 8000 || value.includes('\0') || redact(value, this.workspace.secrets) !== value) throw new Error(`Missing or invalid recipe parameter: ${name}; use environment references for secrets`);
      parameters[name] = value;
    }
    if ((await this.workspace.operations()).some(operation => ['pending', 'unknown'].includes(operation.status))) throw new Error('Workspace has unresolved execution effects');
    options.signal?.throwIfAborted();
    const runId = id('recipe-run'), directory = await ensureDir(join(await ensureDir(join(this.workspace.data, 'recipe-runs')), runId));
    const identity = await processIdentity(process.pid);
    const run: RecipeRun = { schema: 1, id: runId, recipe: recipe.id, revision: recipe.revision, version: recipe.version, task: options.task, entry: options.entry,
      pid: process.pid, processIdentity: identity.identity, createdAt: new Date().toISOString(), parameters, status: 'running', before: await this.workspace.observe(), steps: [] };
    const path = join(directory, 'status.json'); await this.persist(path, run);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), recipe.timeoutMs ?? 300000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      for (const step of recipe.steps) {
        signal.throwIfAborted();
        if ((await this.read(recipeId)).version !== recipe.version) throw new Error('Recipe changed during execution; no further steps dispatched');
        const receipt: RecipeRun['steps'][number] = { id: step.id, kind: step.kind, state: 'running' }; run.steps.push(receipt); await this.persist(path, run);
        let data: unknown, status: 'passed' | 'failed' | 'cancelled' | 'unknown';
        if (step.kind === 'command') {
          const argv = step.argv.map(arg => { const match = placeholder.exec(arg); return match ? parameters[match[1]!]! : arg; });
          const env = { ...process.env };
          for (const [name, reference] of Object.entries(step.envRefs ?? {})) { if (process.env[reference] === undefined) throw new Error(`Recipe environment reference is unavailable: ${reference}`); env[name] = process.env[reference]; }
          const result = await this.workspace.exclusive(() => this.workspace.mutate(step.repo, 'command', () => runProcess(argv, this.workspace.repo(step.repo).root, { signal, timeoutMs: step.timeoutMs, env, activity: this.workspace.activity })));
          data = result; status = result.cleanup === 'unknown' || result.status === 'unknown' ? 'unknown' : result.status === 'passed' ? 'passed' : result.status === 'cancelled' ? 'cancelled' : 'failed';
        } else if (step.kind === 'service') {
          const manager = new ServiceManager(this.workspace);
          const result = step.action === 'start' ? await manager.start(step.service, { task: options.task, signal }) : await manager.stop(step.service);
          data = result; status = result.status === 'unknown' ? 'unknown' : step.action === 'start' ? result.ready ? 'passed' : 'failed' : ['passed', 'failed', 'cancelled', 'timeout', 'not-started'].includes(result.status) ? 'passed' : 'unknown';
        } else if (step.kind === 'browser') {
          const result = await new BrowserValidation(this.workspace).run(step.scenario, { signal }); data = result;
          status = result.status === 'passed' ? 'passed' : result.status === 'cancelled' ? 'cancelled' : 'failed';
        } else {
          const result = await this.workspace.exclusive(() => this.workspace.verify(signal)); data = result; run.evidence = result.evidence;
          status = result.status === 'verified' ? 'passed' : signal.aborted ? 'cancelled' : 'failed';
        }
        Object.assign(receipt, { state: status, data }); await this.persist(path, run);
        if (status !== 'passed') { run.status = status; break; }
      }
      run.after = await this.workspace.observe();
      if (run.status === 'running') run.status = run.evidence && (await this.workspace.evidenceStatus(run.evidence)).valid ? 'passed' : 'stale';
    } catch (error) {
      run.error = String(error); run.status = signal.aborted ? 'cancelled' : 'failed';
      const active = run.steps.at(-1); if (active?.state === 'running') { active.state = 'unknown'; run.status = 'unknown'; }
    }
    clearTimeout(timer); run.finishedAt = new Date().toISOString(); await this.persist(path, run); return await this.readRun(runId, options.task);
  }
  async readRun(runId: string, task?: string) {
    const run = await readJson<RecipeRun>(join(this.workspace.data, 'recipe-runs', safeId(runId), 'status.json'));
    if (run.schema !== 1 || run.id !== runId || task !== undefined && run.task !== task || !Array.isArray(run.steps)) throw new Error('Invalid recipe run or task ownership');
    const identity = await processIdentity(run.pid);
    const live = identity.state === 'alive' && !!run.processIdentity && identity.identity === run.processIdentity;
    const status = run.status === 'running' && !live ? 'unknown' : run.status;
    const current = run.after ? JSON.stringify(run.after) === JSON.stringify(await this.workspace.observe()) : false;
    return { run, status, current, sourceAlive: live, note: 'Unknown execution is never replayed automatically. Passed means this procedure and registered checks passed at that version; it is not independent proof of every task requirement.' };
  }
  async runs(task?: string) {
    let files: string[]; try { files = await readdir(join(this.workspace.data, 'recipe-runs')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const runs = [];
    for (const name of files.slice(-100)) { const result = await this.readRun(safeId(name)); if (task === undefined || result.run.task === task) runs.push(result); }
    return runs;
  }
}
