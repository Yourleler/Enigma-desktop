import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from './workspace.js';
import type { Checkpoint, Observation } from './types.js';
import { PlanStore } from './planning.js';
import { id, writeJson, redact, hash } from './storage.js';

export interface ReviewInput { baseline: string; goal: string; requirements: { text: string; reference: string }[]; evidence?: string[] }
export interface ReviewSnapshot {
  schema: 1; id: string; createdAt: string; goal: string; requirements: ReviewInput['requirements'];
  baseline: Checkpoint; target: Checkpoint; changes: { repo: string; file: string; change: string; patch?: string }[];
  observation: Observation; evidence: { id: string; kind: string; current: boolean }[];
  plan?: { id: string; revision: number };
}
export async function prepareReview(workspace: Workspace, input: ReviewInput): Promise<ReviewSnapshot> {
  if (!input.goal?.trim() || input.goal.length > 4000 || input.requirements.reduce((sum, item) => sum + item.text.length, 0) > 24000 || (input.evidence?.length ?? 0) > 30) throw new Error('Invalid review input budget');
  return await workspace.exclusive(async () => {
    if ((await workspace.operations()).some(operation => ['pending', 'unknown'].includes(operation.status))) throw new Error('Review requires resolved operation effects');
    const before = await workspace.observe();
    const baseline = await workspace.loadCheckpoint(input.baseline);
    const target = await workspace.checkpoint('review target', { references: input.evidence });
    const changes = await workspace.compare(baseline.id, target.id);
    const evidence = await Promise.all((input.evidence ?? []).map(async id => { const observed = await workspace.evidenceStatus(id); return { id, kind: observed.entry.kind, current: observed.valid }; }));
    if (JSON.stringify(before) !== JSON.stringify(await workspace.observe())) throw new Error('Code changed during review capture');
    const plan = await new PlanStore(workspace).current();
    const snapshot: ReviewSnapshot = { schema: 1, id: id('review'), createdAt: new Date().toISOString(), goal: input.goal, requirements: input.requirements,
      baseline, target, changes, evidence, observation: before, plan: plan ? { id: plan.id, revision: plan.revision } : undefined };
    const path = join(workspace.data, 'reviews', snapshot.id); await mkdir(path, { recursive: true });
    await writeJson(join(path, 'input.json'), JSON.parse(redact(JSON.stringify(snapshot), workspace.secrets)));
    return snapshot;
  });
}
export async function readReviewSource(workspace: Workspace, review: ReviewSnapshot, repo: string, file: string, start = 1, end = start + 100) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 300) throw new Error('Review source read needs a bounded line range');
  const snapshot = review.target.repos.find(snapshot => snapshot.repo.id === repo); if (!snapshot) throw new Error('Repository is outside the frozen review target');
  const version = snapshot.files[file]; if (!version) throw new Error('File is outside the frozen review target');
  const bytes = await readFile(join(workspace.data, 'blobs', version.hash));
  if (hash(bytes) !== version.hash || bytes.length > 8000000) throw new Error('Frozen review blob is corrupt or too large');
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
  if (start > lines.length) throw new Error('Review source range starts outside the file');
  return { repo, file, hash: version.hash, line: start, endLine: Math.min(end, lines.length), content: redact(lines.slice(start - 1, end).join('\n').slice(0, 24000), workspace.secrets) };
}
export async function finishReview(workspace: Workspace, review: ReviewSnapshot, result: { status: 'completed' | 'cancelled' | 'failed'; text: string; model: string; session?: string }) {
  const current = JSON.stringify(await workspace.observe()) === JSON.stringify(review.observation);
  const report = { schema: 1, id: review.id, baseline: review.baseline.id, target: review.target.id, model: result.model, session: result.session,
    status: result.status === 'completed' && !current ? 'stale' : result.status, sourceCurrent: current, text: redact(result.text, workspace.secrets),
    evidence: review.evidence, createdAt: new Date().toISOString(), limitations: ['Model review is advisory, not independent proof of test completion.', 'Source is frozen at the captured target; runtime behavior requires actual checks.'] };
  await writeJson(join(workspace.data, 'reviews', review.id, 'report.json'), report); return report;
}
