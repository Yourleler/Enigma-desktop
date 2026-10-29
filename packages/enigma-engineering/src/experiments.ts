import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { Workspace } from './workspace.js';
import { Delegations } from './delegation.js';
import { TaskPackages, relocatePackageArgument } from './task-package.js';
import { ensureDir, hash, id, readJson, safeId, writeJson, redact } from './storage.js';
import type { Check } from './types.js';

export interface ExperimentInput { goal: string; candidates: { id: string; delegation: string }[]; checks: string[]; task?: string }
export interface Experiment extends ExperimentInput { schema: 1; id: string; createdAt: string; baseline: string; criteria: Check[]; criteriaHash: string }
export interface ExperimentReport {
  schema: 1; id: string; experiment: string; createdAt: string; criteriaHash: string;
  candidates: { id: string; delegation: string; status: 'passed' | 'failed' | 'unavailable'; evidence?: string; actual?: unknown; reason?: string; sdkCalls?: number; tools: number; durationMs: number }[];
}
const digest = (value: unknown) => hash(JSON.stringify(value));
const baseline = (repos: Awaited<ReturnType<typeof TaskPackages.inspect>>['manifest']['repos']) => digest(repos.map(repo => ({ id: repo.repo.id, head: repo.head, branch: repo.branch, files: Object.entries(repo.files).sort(([a], [b]) => a.localeCompare(b)).map(([file, value]) => [file, value.hash, value.mode]) })).sort((a, b) => a.id.localeCompare(b.id)));

/** Compare actual isolated implementations against the same source-defined checks. */
export class Experiments {
  constructor(readonly workspace: Workspace) {}
  private path(experiment: string) { return join(this.workspace.data, 'experiments', safeId(experiment)); }
  private criteria(checks: string[]) {
    if (!Array.isArray(checks) || !checks.length || checks.length > 100 || new Set(checks).size !== checks.length) throw new Error('Select nonempty common experiment checks');
    if (checks.some(check => !this.workspace.config.checks.some(item => item.id === check))) throw new Error('Experiment check is not a registered parent check');
    return this.workspace.config.checks.filter(check => checks.includes(check.id)).map(check => structuredClone(check));
  }
  async create(input: ExperimentInput) {
    if (!input.goal?.trim() || input.goal.length > 4000 || !Array.isArray(input.candidates) || input.candidates.length < 2 || input.candidates.length > 8 || new Set(input.candidates.map(item => item.id)).size !== input.candidates.length) throw new Error('An experiment requires two to eight named variants');
    if(new Set(input.candidates.map(item=>item.delegation)).size!==input.candidates.length)throw new Error('请选择不同的独立子任务，不能将同一份实现重复作为候选方案。');
    if (input.task) safeId(input.task); input.candidates.forEach(item => { safeId(item.id); safeId(item.delegation); });
    await this.workspace.reload(); const criteria = this.criteria(input.checks), criteriaHash = digest(criteria); let shared: string | undefined;
    for (const variant of input.candidates) {
      const child = await new Delegations(this.workspace).status(variant.delegation, input.task), source = await TaskPackages.inspect(child.spec.package);
      if (digest(source.manifest) !== child.spec.packageHash) throw new Error('Variant source package changed');
      const code = baseline(source.manifest.repos); if (shared !== undefined && code !== shared) throw new Error('Experiment variants must share the same source code baseline'); shared = code;
      const originalChecks = criteria.map(item => source.manifest.runtime.checks.find(check => check.id === item.id));
      if (digest(originalChecks) !== criteriaHash || digest([...child.spec.checks].sort()) !== digest([...input.checks].sort())) throw new Error('Variants must use the same original check definitions and selected check set');
    }
    return await this.workspace.exclusive(async () => {
      if (digest(this.criteria(input.checks)) !== criteriaHash) throw new Error('Parent criteria changed during experiment preparation');
      const experiment: Experiment = { ...structuredClone(input), schema: 1, id: id('experiment'), createdAt: new Date().toISOString(), baseline: shared!, criteria, criteriaHash };
      await ensureDir(join(this.workspace.data, 'experiments')); await ensureDir(this.path(experiment.id)); await writeJson(join(this.path(experiment.id), 'definition.json'), experiment); return experiment;
    });
  }
  async read(experimentId: string, task?: string) {
    const experiment = await readJson<Experiment>(join(this.path(experimentId), 'definition.json'));
    if (experiment.schema !== 1 || experiment.id !== experimentId || digest(experiment.criteria) !== experiment.criteriaHash || task !== undefined && experiment.task !== task) throw new Error('Invalid experiment identity, criteria or ownership'); return experiment;
  }
  async evaluate(experimentId: string, options: { task?: string; signal?: AbortSignal } = {}) {
    const experiment = await this.read(experimentId, options.task); await this.workspace.reload();
    if (digest(this.criteria(experiment.checks)) !== experiment.criteriaHash) throw new Error('Original parent criteria changed; define a new experiment');
    const report: ExperimentReport = { schema: 1, id: id('experiment-report'), experiment: experiment.id, criteriaHash: experiment.criteriaHash, createdAt: new Date().toISOString(), candidates: [] };
    for (const variant of experiment.candidates) {
      options.signal?.throwIfAborted(); const child = await new Delegations(this.workspace).status(variant.delegation, experiment.task);
      const candidate: ExperimentReport['candidates'][number] = { id: variant.id, delegation: variant.delegation, status: 'unavailable', tools: child.state.tools, sdkCalls: child.spec.target === 'pi' ? child.state.requests : undefined,
        durationMs: Math.max(0, Date.parse(child.state.updatedAt) - Date.parse(child.spec.createdAt)) }; report.candidates.push(candidate);
      if (!child.terminal || child.state.status !== 'completed') { candidate.reason = `Child execution is ${child.status}; no acceptance is inferred`; continue; }
      const workspace = await Workspace.open(child.spec.workspace);
      const source = await TaskPackages.inspect(child.spec.package); if (digest(source.manifest) !== child.spec.packageHash || baseline(source.manifest.repos) !== experiment.baseline) throw new Error('Experiment baseline changed');
      const expectedChecks = await Promise.all(experiment.criteria.map(async check => ({ ...check, argv: await Promise.all(check.argv.map(argument => relocatePackageArgument(argument, source.manifest, workspace))) })));
      const actual = await workspace.exclusive(async () => {
        if (digest(workspace.config.checks) !== digest(expectedChecks)) throw new Error('Child check commands differ from the original experiment criteria');
        return await workspace.verify(options.signal);
      }); candidate.actual = actual; candidate.evidence = actual.evidence; candidate.status = actual.status === 'verified' ? 'passed' : 'failed';
    }
    await this.workspace.reload(); if (digest(this.criteria(experiment.checks)) !== experiment.criteriaHash) throw new Error('Criteria changed while evaluating branches; results remain unselected');
    await this.workspace.exclusive(async () => { await writeJson(join(this.path(experimentId), `${report.id}.json`), JSON.parse(redact(JSON.stringify(report), this.workspace.secrets))); await writeJson(join(this.path(experimentId), 'latest.json'), { id: report.id }); });
    return await this.report(experimentId, options.task);
  }
  async report(experimentId: string, task?: string) {
    const experiment = await this.read(experimentId, task); await this.workspace.reload(); let criteriaCurrent = false;
    try { criteriaCurrent = digest(this.criteria(experiment.checks)) === experiment.criteriaHash; } catch { /* Deleted criteria leave a readable historical comparison. */ }
    let pointer: { id: string }; try { pointer = await readJson(join(this.path(experimentId), 'latest.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { experiment, report: null, criteriaCurrent, candidates: [] }; throw error; }
    const report = await readJson<ExperimentReport>(join(this.path(experimentId), `${safeId(pointer.id)}.json`));
    if (report.schema !== 1 || report.experiment !== experimentId || report.criteriaHash !== experiment.criteriaHash) throw new Error('Invalid experiment result');
    const candidates = [];
    for (const candidate of report.candidates) {
      if (!experiment.candidates.some(item => item.id === candidate.id && item.delegation === candidate.delegation)) throw new Error('Experiment result candidate differs from its definition');
      const child = await new Delegations(this.workspace).status(candidate.delegation, experiment.task); let validNow = false;
      if (candidate.evidence) try { validNow = (await (await Workspace.open(child.spec.workspace)).evidenceStatus(candidate.evidence)).valid; } catch { /* Unavailable evidence is not passing. */ }
      candidates.push({ ...candidate, validNow, selectable: criteriaCurrent && candidate.status === 'passed' && validNow && child.terminal && child.state.status === 'completed' });
    }
    return { experiment, report, criteriaCurrent, candidates, note: 'Common checks compare these implementations only. Token cost is not inferred from SDK call count, and unavailable Codex call counts remain unknown. Selection still requires parent merge and original acceptance.' };
  }
  async select(experimentId: string, variant: string, options: { task?: string; planFile?: string } = {}) {
    const current = await this.report(experimentId, options.task), chosen = current.candidates.find(candidate => candidate.id === variant);
    if (!chosen?.selectable || !current.report) throw new Error('Select a currently verified variant under the original criteria');
    const preview = await new Delegations(this.workspace).preview(chosen.delegation, options.task, { planFile: options.planFile });
    const decision = { schema: 1, id: id('selection'), experiment: experimentId, report: current.report.id, candidate: variant, preview: preview.id, at: new Date().toISOString(), note: 'Selection prepares a merge preview; no code is automatically applied.' };
    await writeJson(join(this.path(experimentId), `${decision.id}.json`), decision); return { decision, preview };
  }
  async list(task?: string) {
    let names: string[]; try { names = await readdir(join(this.workspace.data, 'experiments')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const experiments = []; for (const name of names) { const experiment = await this.read(name); if (task === undefined || experiment.task === task) experiments.push(experiment); } return experiments;
  }
}
